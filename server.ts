import { config } from "dotenv";
config({ path: ".env.local" });

import { createServer, IncomingMessage, ServerResponse } from "http";
import { parse } from "url";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes, timingSafeEqual } from "crypto";
import {
  readFileSync,
  existsSync,
  appendFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "fs";
import { execSync } from "child_process";
import { hostname, homedir } from "os";
import { join, resolve } from "path";
import {
  loadConversation,
  addMessage,
  clearConversation,
  getClaudeSessionId,
  saveClaudeSessionId,
  Message,
  ToolActivity,
  OutputChunk,
  // Project support
  validateProjectId,
  listProjects,
  getProject,
  loadProjectConversation,
  addProjectMessage,
  clearProjectConversation,
  getProjectSessionId,
  saveProjectSessionId,
  // Worktree support
  listBranches,
  createWorktree,
  removeWorktree,
} from "./src/lib/store";
import { spawnClaude, ClaudeEvent } from "./src/lib/claude";
import {
  initVapid,
  getVapidPublicKey,
  addSubscription,
  removeSubscription,
  sendPushToAll,
} from "./src/lib/push";

// Track active Claude processes per connection per project
// Key format: `${connId}:${projectId}` or just `${connId}` for legacy
const activeJobs: Map<string, AbortController> = new Map();
// Track connected WebSockets by connection ID
const connectedClients: Map<string, WebSocket> = new Map();
// Track which projects have already sent the "rejoined" context note this server boot
const rejoinNoteSent: Set<string> = new Set();

// Track pending AskUserQuestion prompts waiting for user response
interface PendingQuestion {
  toolUseId: string;
  questions: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
  projectId?: string;
  sessionId: string;
}
const pendingQuestions: Map<string, PendingQuestion> = new Map();

// --- Session-based auth ---
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const sessions: Map<string, { createdAt: number }> = new Map();

function createSession(): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

function validateSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const cookies: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return cookies;
  for (const pair of header.split(";")) {
    const [key, ...rest] = pair.trim().split("=");
    if (key) cookies[key] = rest.join("=");
  }
  return cookies;
}

function getSessionFromRequest(req: IncomingMessage): string | null {
  const cookies = parseCookies(req);
  return cookies["session"] || null;
}

function isRequestAuthenticated(req: IncomingMessage): boolean {
  const token = getSessionFromRequest(req);
  return token ? validateSession(token) : false;
}

// Rate limiting for login attempts per IP
const AUTH_MAX_ATTEMPTS = 5;
const AUTH_WINDOW_MS = 60_000; // 1 minute
const authAttempts: Map<string, { count: number; resetAt: number }> = new Map();

function checkAuthRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    return true;
  }
  return entry.count < AUTH_MAX_ATTEMPTS;
}

function recordAuthFailure(ip: string): void {
  const now = Date.now();
  const entry = authAttempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + AUTH_WINDOW_MS });
  } else {
    entry.count++;
  }
}

function verifyPassword(input: string): boolean {
  const expected = Buffer.from(PIN!);
  const provided = Buffer.from(input);
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

// Broadcast reload message to all connected clients (for dev hot reload)
function broadcastReload() {
  console.log("[dev] Broadcasting reload to", connectedClients.size, "clients");
  for (const [connId, ws] of connectedClients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "reload" }));
      console.log(`[dev] Sent reload to connection ${connId}`);
    }
  }
}

// Broadcast an event to all connected clients except the sender
function broadcastToOthers(excludeConnId: string, event: object) {
  const msg = JSON.stringify(event);
  for (const [connId, connWs] of connectedClients.entries()) {
    if (connId === excludeConnId) continue;
    if (connWs.readyState !== WebSocket.OPEN) continue;
    connWs.send(msg);
  }
}

// Helper to create job key
function jobKey(connId: string, projectId?: string): string {
  return projectId ? `${connId}:${projectId}` : connId;
}

// Events file path
const configDir = join(homedir(), ".config", "claude-remote");
const eventsFile = join(configDir, "events.jsonl");

function appendEvent(connId: string, event: ClaudeEvent) {
  const line = JSON.stringify({ connId, event, ts: Date.now() }) + "\n";
  appendFileSync(eventsFile, line);
}

// Partial response persistence (survives crashes)
const partialResponseFile = join(configDir, "partial-responses.json");

interface PartialResponse {
  text: string;
  thinking: string;
  activity: ToolActivity[];
  updatedAt: number;
}

function loadPartialResponses(): Record<string, PartialResponse> {
  try {
    if (!existsSync(partialResponseFile)) return {};
    return JSON.parse(readFileSync(partialResponseFile, "utf-8"));
  } catch {
    return {};
  }
}

// Debounced partial response saving — at most once per second
const pendingPartials: Map<
  string,
  { text: string; thinking: string; activity: ToolActivity[] }
> = new Map();
let partialSaveTimer: ReturnType<typeof setTimeout> | null = null;

function flushPartialResponses() {
  if (pendingPartials.size === 0) return;
  const data = loadPartialResponses();
  for (const [key, partial] of pendingPartials) {
    data[key] = { ...partial, updatedAt: Date.now() };
  }
  pendingPartials.clear();
  writeFileSync(partialResponseFile, JSON.stringify(data, null, 2));
}

function savePartialResponse(
  key: string,
  text: string,
  thinking: string,
  activity: ToolActivity[] = [],
) {
  pendingPartials.set(key, { text, thinking, activity });
  if (!partialSaveTimer) {
    partialSaveTimer = setTimeout(() => {
      partialSaveTimer = null;
      flushPartialResponses();
    }, 1000);
  }
}

function clearPartialResponse(key: string) {
  const data = loadPartialResponses();
  delete data[key];
  writeFileSync(partialResponseFile, JSON.stringify(data, null, 2));
}

function recoverPartialResponses() {
  const partials = loadPartialResponses();
  for (const [key, partial] of Object.entries(partials)) {
    if (partial.text || partial.thinking || partial.activity.length > 0) {
      console.log(`[recovery] Found partial response for ${key}, saving...`);
      addMessage({
        role: "assistant",
        content: partial.text + "\n\n[Response interrupted - server restarted]",
        thinking: partial.thinking || undefined,
        activity: partial.activity.length > 0 ? partial.activity : undefined,
        timestamp: new Date(partial.updatedAt).toISOString(),
      });
    }
  }
  writeFileSync(partialResponseFile, "{}");
}

const port = parseInt(process.env.PORT || "6767", 10);
const clientUrl = process.env.CLIENT_URL || `http://localhost:5173`;
const serverUrl = process.env.SERVER_URL || `http://localhost:${port}`;

const PIN = process.env.CLAUDE_REMOTE_PIN;
if (!PIN) {
  console.error("CLAUDE_REMOTE_PIN environment variable is required");
  process.exit(1);
}

function json(res: ServerResponse, data: object, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

// API authentication: validate session cookie
function checkApiAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!isRequestAuthenticated(req)) {
    json(res, { error: "Unauthorized" }, 401);
    return false;
  }
  return true;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const { pathname } = parse(req.url || "", true);
  const method = req.method || "GET";

  // CORS: restrict to known origins + configurable extras for multi-server
  const extraOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .filter(Boolean);
  const allowedOrigins = [clientUrl, ...extraOrigins].filter(Boolean);
  const origin = req.headers["origin"];
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Auth gate: all /api/ routes require session cookie, except:
  // - /api/status (public info)
  // - /api/login (the login endpoint itself)
  const authExempt =
    pathname === "/api/status" || pathname === "/api/login";
  if (pathname?.startsWith("/api/") && !authExempt) {
    if (!checkApiAuth(req, res)) return;
  }

  // API: Login — validate password, set session cookie
  if (pathname === "/api/login" && method === "POST") {
    const clientIp =
      req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    if (!checkAuthRateLimit(clientIp)) {
      return json(res, { error: "Too many attempts. Try again later." }, 429);
    }

    const body = await readBody(req);
    let password: string;
    try {
      password = JSON.parse(body).password;
    } catch {
      return json(res, { error: "Invalid request body" }, 400);
    }

    if (!password || !verifyPassword(password)) {
      recordAuthFailure(clientIp);
      return json(res, { error: "Invalid password" }, 401);
    }

    const sessionToken = createSession();
    res.setHeader(
      "Set-Cookie",
      `session=${sessionToken}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    );
    return json(res, { ok: true });
  }

  // API: Status
  if (pathname === "/api/status" && method === "GET") {
    const isAuthed = isRequestAuthenticated(req);
    const serverName = process.env.SERVER_NAME || hostname();

    return json(res, {
      serverName,
      authenticated: isAuthed,
      connections: connectedClients.size,
    });
  }

  // API: Dev reload - broadcasts reload message to all connected clients
  if (pathname === "/api/dev/reload" && method === "POST") {
    broadcastReload();
    return json(res, { ok: true, clients: connectedClients.size });
  }

  // API: Dev full reload - triggers Flutter hot restart then broadcasts reload
  if (pathname === "/api/dev/full-reload" && method === "POST") {
    try {
      // Send SIGUSR2 to Flutter process for hot restart
      const pidFile = join(process.cwd(), "logs", "flutter.pid");
      if (existsSync(pidFile)) {
        const pid = readFileSync(pidFile, "utf-8").trim();
        process.kill(parseInt(pid), "SIGUSR2");
        console.log("[dev] Sent SIGUSR2 to Flutter process", pid);
      }
      // Wait for Flutter to rebuild, then broadcast reload
      setTimeout(() => {
        broadcastReload();
      }, 2000);
      return json(res, {
        ok: true,
        message: "Flutter restart triggered, reload will broadcast in 2s",
      });
    } catch (e) {
      console.error("[dev] Full reload failed:", e);
      return json(res, { ok: false, error: String(e) }, 500);
    }
  }

  // API: Get conversation history
  if (pathname === "/api/conversation" && method === "GET") {
    const conversation = loadConversation();
    console.log(
      "[api] Returning conversation with",
      conversation.messages.length,
      "messages",
    );
    return json(res, conversation);
  }

  // API: Clear conversation
  if (pathname === "/api/conversation" && method === "DELETE") {
    clearConversation();
    console.log("[api] Conversation cleared");
    return json(res, { success: true });
  }

  // API: List available projects
  if (pathname === "/api/projects" && method === "GET") {
    const projects = listProjects();
    console.log("[api] Returning", projects.length, "projects");
    return json(res, { projects });
  }

  // API: Get project conversation history
  if (
    pathname?.startsWith("/api/projects/") &&
    pathname.endsWith("/conversation") &&
    method === "GET"
  ) {
    const projectId = decodeURIComponent(
      pathname.split("/api/projects/")[1].replace("/conversation", ""),
    );
    if (!validateProjectId(projectId))
      return json(res, { error: "Invalid project ID" }, 400);
    const project = getProject(projectId);
    if (!project) {
      return json(res, { error: "Project not found" }, 404);
    }
    const conversation = loadProjectConversation(projectId);
    console.log(
      `[api] Returning project ${projectId} conversation with`,
      conversation.messages.length,
      "messages",
    );
    return json(res, conversation);
  }

  // API: Clear project conversation
  if (
    pathname?.startsWith("/api/projects/") &&
    pathname.endsWith("/conversation") &&
    method === "DELETE"
  ) {
    const projectId = decodeURIComponent(
      pathname.split("/api/projects/")[1].replace("/conversation", ""),
    );
    if (!validateProjectId(projectId))
      return json(res, { error: "Invalid project ID" }, 400);
    const project = getProject(projectId);
    if (!project) {
      return json(res, { error: "Project not found" }, 404);
    }
    clearProjectConversation(projectId);
    console.log(`[api] Project ${projectId} conversation cleared`);
    return json(res, { success: true });
  }

  // API: Get streaming state for a project (used on reconnect to restore UI state)
  if (
    pathname?.startsWith("/api/projects/") &&
    pathname.endsWith("/streaming") &&
    method === "GET"
  ) {
    const projectId = decodeURIComponent(
      pathname.split("/api/projects/")[1].replace("/streaming", ""),
    );
    if (!validateProjectId(projectId))
      return json(res, { error: "Invalid project ID" }, 400);

    // Check if there's an active job for any device on this project
    let isStreaming = false;
    let streamingDeviceKey: string | null = null;
    for (const key of activeJobs.keys()) {
      if (key.endsWith(`:${projectId}`)) {
        isStreaming = true;
        streamingDeviceKey = key;
        break;
      }
    }

    // Get partial response if streaming
    let partialResponse: PartialResponse | null = null;
    if (streamingDeviceKey) {
      const partials = loadPartialResponses();
      partialResponse = partials[streamingDeviceKey] || null;
    }

    console.log(
      `[api] Streaming state for ${projectId}: isStreaming=${isStreaming}`,
    );
    return json(res, {
      isStreaming,
      partial: partialResponse
        ? {
            text: partialResponse.text,
            thinking: partialResponse.thinking,
            activity: partialResponse.activity,
          }
        : null,
    });
  }

  // API: Cancel task for a project (HTTP fallback for unreliable WebSocket)
  if (
    pathname?.startsWith("/api/projects/") &&
    pathname.endsWith("/cancel") &&
    method === "POST"
  ) {
    const projectId = decodeURIComponent(
      pathname.split("/api/projects/")[1].replace("/cancel", ""),
    );
    if (!validateProjectId(projectId))
      return json(res, { error: "Invalid project ID" }, 400);
    console.log(`[api] HTTP cancel requested for project: ${projectId}`);

    // Find and abort all active jobs for this project (any device)
    let cancelled = 0;
    for (const [key, controller] of activeJobs.entries()) {
      if (key.endsWith(`:${projectId}`)) {
        console.log(`[api] Aborting job: ${key}`);
        controller.abort();
        activeJobs.delete(key);
        cancelled++;
      }
    }

    return json(res, { ok: true, cancelled });
  }

  // API: Get git status for a project
  if (
    pathname?.startsWith("/api/projects/") &&
    pathname.endsWith("/git") &&
    method === "GET"
  ) {
    const projectId = decodeURIComponent(
      pathname.split("/api/projects/")[1].replace("/git", ""),
    );
    if (!validateProjectId(projectId))
      return json(res, { error: "Invalid project ID" }, 400);
    const project = getProject(projectId);
    if (!project) {
      return json(res, { error: "Project not found" }, 404);
    }

    try {
      // Get current branch
      const branch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: project.path,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();

      // Check if working directory is dirty
      const status = execSync("git status --porcelain", {
        cwd: project.path,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      const isDirty = status.length > 0;

      // Parse changed files
      const changedFiles = status ? status.split("\n").length : 0;
      const files = status
        ? status.split("\n").map((line) => {
            // Porcelain format: XY PATH (2 status chars + space + path)
            const match = line.match(/^(..) (.+)$/);
            return match
              ? { status: match[1].trim(), path: match[2] }
              : { status: "?", path: line.trim() };
          })
        : [];

      // Get ahead/behind counts (may fail if no upstream)
      let ahead = 0;
      let behind = 0;
      try {
        const counts = execSync(
          "git rev-list --left-right --count HEAD...@{upstream}",
          {
            cwd: project.path,
            encoding: "utf-8",
            timeout: 5000,
          },
        )
          .trim()
          .split("\t");
        ahead = parseInt(counts[0], 10) || 0;
        behind = parseInt(counts[1], 10) || 0;
      } catch {
        // No upstream configured, ignore
      }

      // Worktree info + branches for worktree creation UI
      const isWorktree = !!project.worktree;
      const parentRepoId = project.worktree?.parentRepoId || null;
      let branches: string[] = [];
      try {
        branches = listBranches(projectId);
      } catch {
        // Not critical
      }

      console.log(
        `[api] Git status for ${projectId}: ${branch} ${isDirty ? "(dirty)" : "(clean)"}`,
      );
      return json(res, {
        branch,
        isDirty,
        changedFiles,
        files,
        ahead,
        behind,
        isWorktree,
        parentRepoId,
        branches,
      });
    } catch (err) {
      // Not a git repo or git not available
      console.log(`[api] Git status failed for ${projectId}:`, err);
      return json(res, { error: "Not a git repository" }, 400);
    }
  }

  // API: Get PR info for a project's current branch
  if (
    pathname?.startsWith("/api/projects/") &&
    pathname.endsWith("/pr") &&
    method === "GET"
  ) {
    const projectId = decodeURIComponent(
      pathname.split("/api/projects/")[1].replace("/pr", ""),
    );
    if (!validateProjectId(projectId))
      return json(res, { error: "Invalid project ID" }, 400);
    const project = getProject(projectId);
    if (!project) {
      return json(res, { error: "Project not found" }, 404);
    }

    try {
      const prJson = execSync("gh pr view --json url,number,title,state", {
        cwd: project.path,
        encoding: "utf-8",
        timeout: 10000,
      }).trim();
      const pr = JSON.parse(prJson);
      console.log(
        `[api] PR info for ${projectId}: #${pr.number} (${pr.state})`,
      );
      return json(res, pr);
    } catch {
      console.log(`[api] No PR found for ${projectId}`);
      return json(res, { error: "No PR found" }, 404);
    }
  }

  // API: Worktree management
  if (
    pathname?.startsWith("/api/projects/") &&
    pathname.endsWith("/worktrees")
  ) {
    const projectId = decodeURIComponent(
      pathname.split("/api/projects/")[1].replace("/worktrees", ""),
    );
    if (!validateProjectId(projectId))
      return json(res, { error: "Invalid project ID" }, 400);
    const project = getProject(projectId);
    if (!project) {
      return json(res, { error: "Project not found" }, 404);
    }

    // GET: List worktrees
    if (method === "GET") {
      try {
        // Use listProjects and filter to worktrees of this repo
        const mainRepoId = project.worktree
          ? project.worktree.parentRepoId
          : project.id;
        const allProjects = listProjects();
        const worktrees = allProjects.filter(
          (p) => p.worktree?.parentRepoId === mainRepoId || p.id === mainRepoId,
        );
        console.log(
          `[api] Listed ${worktrees.length} worktrees for ${projectId}`,
        );
        return json(res, { worktrees });
      } catch (err) {
        console.error(`[api] Failed to list worktrees for ${projectId}:`, err);
        return json(res, { error: String(err) }, 500);
      }
    }

    // POST: Create worktree
    if (method === "POST") {
      try {
        const body = await readBody(req);
        const { branch } = JSON.parse(body);
        if (!branch || typeof branch !== "string") {
          return json(res, { error: "Missing or invalid branch name" }, 400);
        }

        // Basic git ref validation
        const hasBadChars = branch.split("").some((ch) => {
          const code = ch.charCodeAt(0);
          return code <= 0x1f || code === 0x7f || "~^:?*[]\\".includes(ch);
        });
        if (hasBadChars || branch.includes("..")) {
          return json(res, { error: "Invalid branch name" }, 400);
        }

        const newProject = createWorktree(projectId, branch);
        console.log(
          `[api] Created worktree ${newProject.id} for branch ${branch}`,
        );
        return json(res, { project: newProject }, 201);
      } catch (err) {
        console.error(`[api] Failed to create worktree for ${projectId}:`, err);
        return json(res, { error: String(err) }, 500);
      }
    }

    // DELETE: Remove worktree
    if (method === "DELETE") {
      if (!project.worktree) {
        return json(res, { error: "Not a worktree" }, 400);
      }

      try {
        removeWorktree(projectId);
        console.log(`[api] Removed worktree ${projectId}`);
        return json(res, { success: true });
      } catch (err) {
        console.error(`[api] Failed to remove worktree ${projectId}:`, err);
        return json(res, { error: String(err) }, 500);
      }
    }
  }

  // API: File tree - browse project files
  // Pattern: /api/projects/:id/tree or /api/projects/:id/tree/subdir/path
  if (
    pathname?.startsWith("/api/projects/") &&
    pathname.match(/\/tree(\/|$)/) &&
    method === "GET"
  ) {
    const afterProjects = pathname.split("/api/projects/")[1];
    const treeIdx = afterProjects.indexOf("/tree");
    const projectId = decodeURIComponent(afterProjects.substring(0, treeIdx));
    const subPath = decodeURIComponent(
      afterProjects.substring(treeIdx + "/tree".length).replace(/^\//, ""),
    );

    if (!validateProjectId(projectId))
      return json(res, { error: "Invalid project ID" }, 400);
    const project = getProject(projectId);
    if (!project) return json(res, { error: "Project not found" }, 404);

    const targetDir = resolve(project.path, subPath || ".");
    if (!targetDir.startsWith(project.path)) {
      return json(res, { error: "Path traversal not allowed" }, 400);
    }

    try {
      const names = readdirSync(targetDir);
      const entries: Array<{
        name: string;
        type: "file" | "dir";
        size?: number;
        modified?: string;
      }> = [];

      for (const name of names) {
        if (name.startsWith(".") || name === "node_modules") continue;
        try {
          const stat = statSync(join(targetDir, name));
          entries.push({
            name,
            type: stat.isDirectory() ? "dir" : "file",
            size: stat.isDirectory() ? undefined : stat.size,
            modified: stat.mtime.toISOString(),
          });
        } catch {
          // Skip entries we can't stat
        }
      }

      // Directories first, then alphabetical
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return json(res, { entries, path: subPath || "" });
    } catch (err) {
      console.log(`[api] File tree failed for ${projectId}/${subPath}:`, err);
      return json(res, { error: "Directory not found" }, 404);
    }
  }

  // API: File content - read a file
  // Pattern: /api/projects/:id/blob/path/to/file
  if (
    pathname?.startsWith("/api/projects/") &&
    pathname.match(/\/blob\//) &&
    method === "GET"
  ) {
    const afterProjects = pathname.split("/api/projects/")[1];
    const blobIdx = afterProjects.indexOf("/blob/");
    const projectId = decodeURIComponent(afterProjects.substring(0, blobIdx));
    const filePath = decodeURIComponent(
      afterProjects.substring(blobIdx + "/blob/".length),
    );

    if (!validateProjectId(projectId))
      return json(res, { error: "Invalid project ID" }, 400);
    if (!filePath) return json(res, { error: "No file path specified" }, 400);
    const project = getProject(projectId);
    if (!project) return json(res, { error: "Project not found" }, 404);

    const fullPath = resolve(project.path, filePath);
    if (!fullPath.startsWith(project.path)) {
      return json(res, { error: "Path traversal not allowed" }, 400);
    }

    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory())
        return json(res, { error: "Path is a directory" }, 400);

      // Limit file size to 1MB
      if (stat.size > 1024 * 1024) {
        return json(
          res,
          { error: "File too large (>1MB)", size: stat.size },
          400,
        );
      }

      const content = readFileSync(fullPath, "utf-8");
      return json(res, { content, path: filePath, size: stat.size });
    } catch (err) {
      console.log(`[api] File read failed for ${projectId}/${filePath}:`, err);
      return json(res, { error: "File not found" }, 404);
    }
  }

  // API: Diff - list changed files or get diff for a specific file
  // Pattern: /api/projects/:id/diff or /api/projects/:id/diff/path/to/file
  if (
    pathname?.startsWith("/api/projects/") &&
    pathname.match(/\/diff(\/|$)/) &&
    method === "GET"
  ) {
    const afterProjects = pathname.split("/api/projects/")[1];
    const diffIdx = afterProjects.indexOf("/diff");
    const projectId = decodeURIComponent(afterProjects.substring(0, diffIdx));
    const filePath = decodeURIComponent(
      afterProjects.substring(diffIdx + "/diff".length).replace(/^\//, ""),
    );

    if (!validateProjectId(projectId))
      return json(res, { error: "Invalid project ID" }, 400);
    const project = getProject(projectId);
    if (!project) return json(res, { error: "Project not found" }, 404);

    try {
      if (!filePath) {
        // List all changed files
        const status = execSync("git status --porcelain", {
          cwd: project.path,
          encoding: "utf-8",
          timeout: 5000,
        }).trim();

        if (!status) return json(res, { files: [] });

        const files = status.split("\n").map((line) => {
          const match = line.match(/^(..) (.+)$/);
          const st = match ? match[1].trim() : "?";
          const path = match ? match[2] : line.trim();
          return { path, status: st };
        });

        return json(res, { files });
      } else {
        // Get diff for a specific file
        const fullPath = resolve(project.path, filePath);
        if (!fullPath.startsWith(project.path)) {
          return json(res, { error: "Path traversal not allowed" }, 400);
        }

        // Check if it's an untracked file
        const status = execSync(
          `git status --porcelain -- ${JSON.stringify(filePath)}`,
          {
            cwd: project.path,
            encoding: "utf-8",
            timeout: 5000,
          },
        ).trim();

        const isNew = status.startsWith("??");

        if (isNew) {
          // Untracked file — show full contents as new
          const content = readFileSync(fullPath, "utf-8");
          const diffLines = content
            .split("\n")
            .map((l) => `+${l}`)
            .join("\n");
          return json(res, { diff: diffLines, path: filePath, isNew: true });
        }

        // Get unified diff (staged + unstaged vs HEAD)
        let diff = "";
        try {
          diff = execSync(`git diff HEAD -- ${JSON.stringify(filePath)}`, {
            cwd: project.path,
            encoding: "utf-8",
            timeout: 10000,
          });
        } catch {
          // May fail if file is staged but not committed yet (new file added)
          try {
            diff = execSync(
              `git diff --cached -- ${JSON.stringify(filePath)}`,
              {
                cwd: project.path,
                encoding: "utf-8",
                timeout: 10000,
              },
            );
          } catch {
            diff = "";
          }
        }

        return json(res, { diff, path: filePath, isNew: false });
      }
    } catch (err) {
      console.log(`[api] Diff failed for ${projectId}/${filePath}:`, err);
      return json(res, { error: "Failed to get diff" }, 500);
    }
  }

  // API: Push notifications - VAPID public key
  if (pathname === "/api/push/vapid" && method === "GET") {
    const publicKey = getVapidPublicKey();
    if (!publicKey) return json(res, { error: "Push not initialized" }, 500);
    return json(res, { publicKey });
  }

  // API: Push notifications - subscribe
  if (pathname === "/api/push/subscribe" && method === "POST") {
    const body = await readBody(req);
    const { subscription, deviceId } = JSON.parse(body);
    if (!subscription || !deviceId) {
      return json(res, { error: "Missing subscription or deviceId" }, 400);
    }
    addSubscription(deviceId, subscription);
    return json(res, { ok: true });
  }

  // API: Push notifications - unsubscribe
  if (pathname === "/api/push/subscribe" && method === "DELETE") {
    const body = await readBody(req);
    const { deviceId } = JSON.parse(body);
    if (!deviceId) return json(res, { error: "Missing deviceId" }, 400);
    removeSubscription(deviceId);
    return json(res, { ok: true });
  }

  // Static files (production)
  const distPath = join(process.cwd(), "dist", "client");
  if (existsSync(distPath)) {
    const requestedPath =
      pathname === "/" ? "index.html" : (pathname || "").replace(/^\//, "");
    let filePath = resolve(distPath, requestedPath);

    // Path traversal protection: resolved path must be within distPath
    if (!filePath.startsWith(distPath + "/") && filePath !== distPath) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    // SPA fallback
    if (!existsSync(filePath) || !filePath.includes(".")) {
      filePath = join(distPath, "index.html");
    }

    if (existsSync(filePath)) {
      const ext = filePath.split(".").pop() || "";
      const contentTypes: Record<string, string> = {
        html: "text/html",
        js: "application/javascript",
        css: "text/css",
        json: "application/json",
        png: "image/png",
        svg: "image/svg+xml",
      };

      res.writeHead(200, { "Content-Type": contentTypes[ext] || "text/plain" });
      res.end(readFileSync(filePath));
      return;
    }
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
}

// Helper: broadcast a Claude event to all connected clients as plain JSON
function broadcastEvent(event: object, fallbackConnId?: string) {
  const eventJson = JSON.stringify(event);
  let sentToAny = false;
  for (const [, connWs] of connectedClients.entries()) {
    if (connWs.readyState === WebSocket.OPEN) {
      connWs.send(eventJson);
      sentToAny = true;
    }
  }
  if (!sentToAny && fallbackConnId) {
    appendEvent(fallbackConnId, event as ClaudeEvent);
    console.log(`[${fallbackConnId}] Event written to disk (no clients connected)`);
  }
}

// Helper: handle a Claude event callback (shared between message and tool_answer flows)
function makeClaudeEventHandler(opts: {
  connId: string;
  projectId?: string;
  jKey: string;
  userText: string;
  state: {
    thinking: string;
    text: string;
    activity: ToolActivity[];
    chunks: OutputChunk[];
    lastToolName: string | null;
    currentChunkText: string;
    taskStartedAt: string;
  };
}) {
  const { connId, projectId, jKey, userText, state } = opts;

  const isNewChunkStart = (text: string): boolean => {
    const trimmed = text.trim();
    if (state.lastToolName !== null) return true;
    if (text.startsWith("\n\n")) return true;
    if (
      /^(Now|Next|Let me|I'll|First|Finally|Done|After|Moving|Continuing|Great|Perfect|Looking|Based on|The |This |I |Here)/i.test(
        trimmed,
      )
    )
      return true;
    return false;
  };

  const flushChunk = (afterTool?: string) => {
    if (state.currentChunkText.trim()) {
      state.chunks.push({
        text: state.currentChunkText.trim(),
        timestamp: Date.now(),
        afterTool,
      });
      state.currentChunkText = "";
    }
  };

  return (event: ClaudeEvent) => {
    console.log(
      "[ws] Claude event:",
      event.type,
      event.sessionId ? `sessionId=${event.sessionId}` : "",
      projectId ? `[project: ${projectId}]` : "",
    );

    if (event.type === "session_init" && event.sessionId) {
      console.log(
        "[ws] Saving session ID:",
        event.sessionId,
        projectId ? `[project: ${projectId}]` : "",
      );
      if (projectId) {
        saveProjectSessionId(projectId, event.sessionId);
      } else {
        saveClaudeSessionId(event.sessionId);
      }
      return;
    }

    let transformedEvent: object = event;
    if (event.type === "error" && event.text && !("error" in event)) {
      transformedEvent = { ...event, error: event.text };
    }

    const eventWithProject = projectId
      ? { ...transformedEvent, projectId }
      : transformedEvent;

    broadcastEvent(eventWithProject, connId);

    if (event.type === "thinking" && event.text) {
      state.thinking += event.text;
      savePartialResponse(jKey, state.text, state.thinking, state.activity);
    } else if (event.type === "text" && event.text) {
      if (isNewChunkStart(event.text) && state.currentChunkText.trim()) {
        flushChunk(state.lastToolName || undefined);
        state.lastToolName = null;
      }
      state.currentChunkText += event.text;
      state.text += event.text;
      savePartialResponse(jKey, state.text, state.thinking, state.activity);
    } else if (event.type === "tool_use" && event.toolUse) {
      flushChunk();
      state.lastToolName = event.toolUse.tool;
      state.activity.push({
        type: "tool_use",
        tool: event.toolUse.tool,
        id: event.toolUse.id,
        input: event.toolUse.input,
        timestamp: Date.now(),
      });
      savePartialResponse(jKey, state.text, state.thinking, state.activity);

      if (event.toolUse.tool === "AskUserQuestion" && event.toolUse.id) {
        const currentSessionId = projectId
          ? getProjectSessionId(projectId)
          : getClaudeSessionId();
        pendingQuestions.set(jKey, {
          toolUseId: event.toolUse.id,
          questions: (event.toolUse.input.questions ||
            []) as PendingQuestion["questions"],
          projectId,
          sessionId: currentSessionId || "",
        });
        console.log(`[${connId}] AskUserQuestion detected, stored pending question`);
        const questionText =
          (event.toolUse.input.questions as Array<{ question: string }>)?.[0]
            ?.question || "Claude has a question";
        sendPushToAll("Question from Claude", questionText, "/").catch((err) =>
          console.error("[push] Failed to send AskUserQuestion push:", err),
        );
      }
    } else if (event.type === "tool_result" && event.toolResult) {
      state.activity.push({
        type: "tool_result",
        tool: event.toolResult.tool,
        output: event.toolResult.output,
        error: event.toolResult.error,
        timestamp: Date.now(),
      });
      savePartialResponse(jKey, state.text, state.thinking, state.activity);
    } else if (event.type === "done") {
      flushChunk(state.lastToolName || undefined);

      if (state.text || state.thinking || state.activity.length > 0) {
        const assistantMsg: Message = {
          role: "assistant",
          content: state.text,
          task: userText,
          chunks: state.chunks.length > 0 ? state.chunks : undefined,
          thinking: state.thinking || undefined,
          activity: state.activity.length > 0 ? state.activity : undefined,
          startedAt: state.taskStartedAt,
          completedAt: new Date().toISOString(),
          timestamp: new Date().toISOString(),
        };
        if (projectId) {
          addProjectMessage(projectId, assistantMsg);
        } else {
          addMessage(assistantMsg);
        }
      }
      const snippet = state.text.slice(0, 100) || "Task finished";
      sendPushToAll("Task complete", snippet, "/").catch((err) =>
        console.error("[push] Failed to send done push:", err),
      );
      pendingPartials.delete(jKey);
      clearPartialResponse(jKey);
      activeJobs.delete(jKey);
      console.log(
        `[${connId}] Job complete for ${projectId || "global"}, cleared from active jobs`,
      );
    }
  };
}

async function main() {
  recoverPartialResponses();
  initVapid();

  const server = createServer(handleRequest);
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "", true);

    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const connId = randomBytes(8).toString("hex");
    // Check if already authenticated via session cookie on upgrade
    let authenticated = isRequestAuthenticated(req);
    const clientIp =
      req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    const sendJson = (data: object) => {
      if (ws.readyState !== WebSocket.OPEN) {
        appendEvent(connId, data as ClaudeEvent);
        console.log(`[${connId}] Event written to disk (ws not open)`);
        return;
      }
      ws.send(JSON.stringify(data));
    };

    if (authenticated) {
      connectedClients.set(connId, ws);
      console.log(`[${connId}] Authenticated via cookie on connect`);

      // Find all active jobs (across all projects)
      const activeProjectIds: string[] = [];
      for (const key of activeJobs.keys()) {
        const colonIdx = key.indexOf(":");
        if (colonIdx !== -1) {
          activeProjectIds.push(key.substring(colonIdx + 1));
        }
      }
      sendJson({ type: "auth_ok", activeProjectIds });

      // Send partial responses for active streaming sessions
      if (activeProjectIds.length > 0) {
        const partials = loadPartialResponses();
        for (const projectId of activeProjectIds) {
          // Find the matching partial by checking all keys ending with this projectId
          for (const [pKey, partial] of Object.entries(partials)) {
            if (pKey.endsWith(`:${projectId}`) && partial) {
              sendJson({
                type: "streaming_restore",
                projectId,
                thinking: partial.thinking,
                text: partial.text,
                activity: partial.activity,
              });
              console.log(`[${connId}] Sent streaming restore for ${projectId}`);
              break;
            }
          }
        }
      }
    }

    ws.on("message", async (raw: Buffer) => {
      let msg: {
        type: string;
        password?: string;
        text?: string;
        projectId?: string;
        answers?: Array<{ header: string; answer: string }>;
      };
      try {
        msg = JSON.parse(raw.toString());
      } catch (err) {
        console.error("Failed to parse WebSocket message as JSON:", err);
        ws.close(4002, "Invalid JSON");
        return;
      }

      console.log(`[${connId}] Received message type:`, msg.type);

      // Handle auth via WebSocket (fallback if cookie not set yet)
      if (msg.type === "auth") {
        if (!checkAuthRateLimit(clientIp)) {
          console.log(`Auth rate limited for IP: ${clientIp}`);
          sendJson({ type: "auth_error", error: "Too many attempts. Try again later." });
          return;
        }

        if (!msg.password || !verifyPassword(msg.password)) {
          console.log("Auth failed - invalid password");
          recordAuthFailure(clientIp);
          sendJson({ type: "auth_error", error: "Invalid password" });
          return;
        }

        authenticated = true;
        connectedClients.set(connId, ws);
        console.log("Auth successful via WebSocket");

        const activeProjectIds: string[] = [];
        for (const key of activeJobs.keys()) {
          const colonIdx = key.indexOf(":");
          if (colonIdx !== -1) {
            activeProjectIds.push(key.substring(colonIdx + 1));
          }
        }
        sendJson({ type: "auth_ok", activeProjectIds });

        if (activeProjectIds.length > 0) {
          const partials = loadPartialResponses();
          for (const projectId of activeProjectIds) {
            for (const [pKey, partial] of Object.entries(partials)) {
              if (pKey.endsWith(`:${projectId}`) && partial) {
                sendJson({
                  type: "streaming_restore",
                  projectId,
                  thinking: partial.thinking,
                  text: partial.text,
                  activity: partial.activity,
                });
                console.log(`[${connId}] Sent streaming restore for ${projectId}`);
                break;
              }
            }
          }
        }
        return;
      }

      if (!authenticated) {
        sendJson({ type: "error", error: "Not authenticated" });
        return;
      }

      if (msg.type === "list_projects") {
        const projects = listProjects();
        sendJson({ type: "projects_list", projects });
      } else if (msg.type === "message") {
        const userText = msg.text || "";
        const projectId = msg.projectId;
        console.log(
          "Processing message:",
          userText.substring(0, 50),
          projectId ? `[project: ${projectId}]` : "[global]",
        );

        let projectPath: string | undefined;
        if (projectId) {
          if (!validateProjectId(projectId)) {
            sendJson({ type: "error", error: `Invalid project ID: ${projectId}`, projectId });
            return;
          }
          const project = getProject(projectId);
          if (!project) {
            sendJson({ type: "error", error: `Project not found: ${projectId}`, projectId });
            return;
          }
          projectPath = project.path;
        }

        if (projectId) {
          addProjectMessage(projectId, { role: "user", content: userText, timestamp: new Date().toISOString() });
        } else {
          addMessage({ role: "user", content: userText, timestamp: new Date().toISOString() });
        }

        broadcastToOthers(connId, { type: "sync_user_message", projectId, text: userText });

        const jKey = jobKey(connId, projectId);
        const abortController = new AbortController();
        activeJobs.set(jKey, abortController);

        const sessionId = projectId ? getProjectSessionId(projectId) : getClaudeSessionId();
        console.log("Using Claude session:", sessionId || "new session", projectId ? `[project: ${projectId}]` : "");

        const rejoinKey = projectId || "__global__";
        let messageToSend = userText;
        if (sessionId && !rejoinNoteSent.has(rejoinKey)) {
          rejoinNoteSent.add(rejoinKey);
          messageToSend = `[System: This is the first message from the user since the server rebooted.]\n\n${userText}`;
        }

        const handler = makeClaudeEventHandler({
          connId,
          projectId,
          jKey,
          userText,
          state: {
            thinking: "",
            text: "",
            activity: [],
            chunks: [],
            lastToolName: null,
            currentChunkText: "",
            taskStartedAt: new Date().toISOString(),
          },
        });

        spawnClaude(messageToSend, handler, abortController.signal, sessionId, projectPath);
      } else if (msg.type === "tool_answer") {
        const projectId = msg.projectId;
        if (projectId && !validateProjectId(projectId)) {
          sendJson({ type: "error", error: "Invalid project ID", projectId });
          return;
        }

        const jKey = jobKey(connId, projectId);
        const pending = pendingQuestions.get(jKey);

        if (!pending) {
          sendJson({ type: "error", error: "No pending question found", projectId });
          return;
        }

        console.log(`[${connId}] Received tool answer for ${projectId || "global"}`);
        pendingQuestions.delete(jKey);

        const answerText = msg.answers
          ? msg.answers.map((a) => `${a.header}: ${a.answer}`).join("\n")
          : msg.text || "";
        const formattedAnswer = `[User answered your question]\n${answerText}`;

        if (projectId) {
          addProjectMessage(projectId, { role: "user", content: formattedAnswer, timestamp: new Date().toISOString() });
        } else {
          addMessage({ role: "user", content: formattedAnswer, timestamp: new Date().toISOString() });
        }

        const answerAbortController = new AbortController();
        activeJobs.set(jKey, answerAbortController);

        let ansProjectPath: string | undefined;
        if (projectId) {
          const project = getProject(projectId);
          if (project) ansProjectPath = project.path;
        }

        const handler = makeClaudeEventHandler({
          connId,
          projectId,
          jKey,
          userText: formattedAnswer,
          state: {
            thinking: "",
            text: "",
            activity: [],
            chunks: [],
            lastToolName: null,
            currentChunkText: "",
            taskStartedAt: new Date().toISOString(),
          },
        });

        spawnClaude(formattedAnswer, handler, answerAbortController.signal, pending.sessionId, ansProjectPath);
      } else if (msg.type === "cancel") {
        if (msg.projectId && !validateProjectId(msg.projectId)) {
          sendJson({ type: "error", error: "Invalid project ID" });
          return;
        }
        console.log("Cancel requested", msg.projectId ? `[project: ${msg.projectId}]` : "[global]");
        const jKey = jobKey(connId, msg.projectId);
        const abortController = activeJobs.get(jKey);
        if (abortController) {
          abortController.abort();
          activeJobs.delete(jKey);
        }
        broadcastToOthers(connId, { type: "sync_cancel", projectId: msg.projectId });
      } else {
        console.log("Unknown message type:", msg.type);
      }
    });

    ws.on("close", () => {
      connectedClients.delete(connId);
      console.log(`[${connId}] Client disconnected, Claude will continue running`);
    });
  });

  server.listen(port, () => {
    console.log(`> Server ready on ${serverUrl}`);
    console.log(`> Client URL: ${clientUrl}`);
  });
}

main();
