import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "fs";
import { join, basename, resolve } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import argon2 from "argon2";

const CONFIG_DIR = join(homedir(), ".config", "claude-remote");
const PROJECTS_DIR = join(CONFIG_DIR, "projects");
const DEFAULT_PROJECTS_BASE = join(homedir(), "projects");

export interface Device {
  id: string;
  publicKey: string;
  sharedSecret: string;
  createdAt: string;
}

export interface ServerState {
  privateKey: string;
  publicKey: string;
  pairingToken: string | null;
}

export interface Config {
  pinHash: string | null;
}

export interface ToolActivity {
  type: "tool_use" | "tool_result";
  tool: string;
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
  timestamp: number;
}

export interface OutputChunk {
  text: string;
  timestamp: number;
  afterTool?: string; // which tool triggered this chunk (if any)
}

export interface Message {
  role: "user" | "assistant";
  content: string; // full text (for backwards compat and search)
  task?: string; // user's original prompt (for assistant messages)
  chunks?: OutputChunk[]; // structured output chunks
  thinking?: string;
  activity?: ToolActivity[];
  startedAt?: string; // when task started
  completedAt?: string; // when task completed
  timestamp: string; // legacy, use startedAt/completedAt
}

export interface Conversation {
  messages: Message[];
  claudeSessionId: string | null;
  updatedAt: string;
}

// Project-related interfaces
export interface WorktreeInfo {
  isWorktree: true;
  parentRepoId: string; // e.g. "remote-claude-real"
  branch: string; // e.g. "feature/dark-mode"
  mainWorktreePath: string; // e.g. "/home/user/projects/my-project"
}

export interface Project {
  id: string; // folder name e.g. "remote-claude-real"
  path: string; // full path e.g. "/home/user/projects/my-project"
  name: string; // display name (from package.json or folder)
  lastAccessed?: string;
  worktree?: WorktreeInfo;
}

export interface ProjectConversation {
  projectId: string;
  messages: Message[];
  claudeSessionId: string | null;
  updatedAt: string;
}

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadDevices(): Device[] {
  try {
    const path = join(CONFIG_DIR, "devices.json");
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

export function saveDevices(devices: Device[]): void {
  ensureConfigDir();
  writeFileSync(
    join(CONFIG_DIR, "devices.json"),
    JSON.stringify(devices, null, 2),
  );
}

export function addDevice(device: Device): void {
  const devices = loadDevices();
  devices.push(device);
  saveDevices(devices);
}

export function removeDevice(deviceId: string): void {
  const devices = loadDevices();
  const filtered = devices.filter((d) => d.id !== deviceId);
  saveDevices(filtered);
}

export function getDeviceById(deviceId: string): Device | null {
  const devices = loadDevices();
  return devices.find((d) => d.id === deviceId) || null;
}

// Legacy single device support (deprecated)
export function loadDevice(): Device | null {
  try {
    const path = join(CONFIG_DIR, "device.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function saveDevice(device: Device): void {
  ensureConfigDir();
  writeFileSync(
    join(CONFIG_DIR, "device.json"),
    JSON.stringify(device, null, 2),
  );
}

export function loadServerState(): ServerState | null {
  try {
    const path = join(CONFIG_DIR, "server.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function saveServerState(state: ServerState): void {
  ensureConfigDir();
  writeFileSync(
    join(CONFIG_DIR, "server.json"),
    JSON.stringify(state, null, 2),
  );
}

export function loadConfig(): Config {
  try {
    const path = join(CONFIG_DIR, "config.json");
    if (!existsSync(path)) return { pinHash: null };
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { pinHash: null };
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  writeFileSync(
    join(CONFIG_DIR, "config.json"),
    JSON.stringify(config, null, 2),
  );
}

export async function hashPin(pin: string): Promise<string> {
  return argon2.hash(pin, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, pin);
  } catch {
    return false;
  }
}

export function loadConversation(): Conversation {
  try {
    const path = join(CONFIG_DIR, "conversation.json");
    if (!existsSync(path))
      return {
        messages: [],
        claudeSessionId: null,
        updatedAt: new Date().toISOString(),
      };
    const data = JSON.parse(readFileSync(path, "utf8"));
    // Ensure claudeSessionId exists for backwards compatibility
    if (!("claudeSessionId" in data)) {
      data.claudeSessionId = null;
    }
    return data;
  } catch (err) {
    console.error("[store] Failed to load conversation:", err);
    return {
      messages: [],
      claudeSessionId: null,
      updatedAt: new Date().toISOString(),
    };
  }
}

export function saveClaudeSessionId(sessionId: string): void {
  const conversation = loadConversation();
  conversation.claudeSessionId = sessionId;
  saveConversation(conversation);
  console.log("[store] Claude session ID saved:", sessionId);
}

export function getClaudeSessionId(): string | null {
  const conversation = loadConversation();
  return conversation.claudeSessionId;
}

export function saveConversation(conversation: Conversation): void {
  ensureConfigDir();
  conversation.updatedAt = new Date().toISOString();
  writeFileSync(
    join(CONFIG_DIR, "conversation.json"),
    JSON.stringify(conversation, null, 2),
  );
  console.log(
    "[store] Conversation saved, messages:",
    conversation.messages.length,
  );
}

export function addMessage(message: Message): Conversation {
  const conversation = loadConversation();
  conversation.messages.push(message);
  saveConversation(conversation);
  return conversation;
}

export function clearConversation(): void {
  ensureConfigDir();
  const empty: Conversation = {
    messages: [],
    claudeSessionId: null,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(
    join(CONFIG_DIR, "conversation.json"),
    JSON.stringify(empty, null, 2),
  );
  console.log("[store] Conversation and session cleared");
}

// ============================================
// Project-related functions
// ============================================

export function validateProjectId(projectId: string): boolean {
  if (!projectId) return false;
  // Reject path traversal attempts, slashes, backslashes, null bytes
  if (
    projectId.includes("..") ||
    projectId.includes("/") ||
    projectId.includes("\\") ||
    projectId.includes("\0")
  ) {
    return false;
  }
  return true;
}

function ensureProjectsDir() {
  if (!existsSync(PROJECTS_DIR)) {
    mkdirSync(PROJECTS_DIR, { recursive: true });
  }
}

function getProjectConfigDir(projectId: string): string {
  if (!validateProjectId(projectId)) {
    throw new Error(`Invalid project ID: ${projectId}`);
  }
  return join(PROJECTS_DIR, projectId);
}

function ensureProjectConfigDir(projectId: string): void {
  const dir = getProjectConfigDir(projectId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// Check if a directory looks like a project
function hasProjectMarkers(dir: string): boolean {
  const markers = [
    "package.json",
    "Cargo.toml",
    "go.mod",
    "pyproject.toml",
    "setup.py",
    ".git",
    "Makefile",
    "CMakeLists.txt",
    "pom.xml",
    "build.gradle",
  ];
  return markers.some((marker) => existsSync(join(dir, marker)));
}

// Get project name from package.json or folder name
function getProjectName(projectPath: string): string {
  try {
    const pkgPath = join(projectPath, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      if (pkg.name) return pkg.name;
    }
  } catch {
    // Ignore errors
  }

  try {
    const cargoPath = join(projectPath, "Cargo.toml");
    if (existsSync(cargoPath)) {
      const content = readFileSync(cargoPath, "utf8");
      const match = content.match(/name\s*=\s*"([^"]+)"/);
      if (match) return match[1];
    }
  } catch {
    // Ignore errors
  }

  return basename(projectPath);
}

// Detect if a directory is a git worktree (linked .git file vs .git directory)
function detectWorktree(dirPath: string): WorktreeInfo | null {
  try {
    const gitPath = join(dirPath, ".git");
    if (!existsSync(gitPath)) return null;

    const stat = statSync(gitPath);
    if (!stat.isFile()) return null; // Regular .git directory = main repo

    // .git file = linked worktree. Format: "gitdir: /path/to/.git/worktrees/name"
    const content = readFileSync(gitPath, "utf8").trim();
    const match = content.match(/^gitdir:\s*(.+)$/);
    if (!match) return null;

    const gitdir = match[1];
    // Navigate from .git/worktrees/<name> up to the main .git dir
    const gitMainDir = gitdir.replace(/\/worktrees\/[^/]+$/, "");
    // The main repo path is the parent of the .git dir
    const mainWorktreePath = resolve(join(gitMainDir, ".."));
    const parentRepoId = basename(mainWorktreePath);

    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: dirPath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    return {
      isWorktree: true,
      parentRepoId,
      branch,
      mainWorktreePath,
    };
  } catch (err) {
    console.error(`[store] Failed to detect worktree for ${dirPath}:`, err);
    return null;
  }
}

function sanitizeBranchForDir(branch: string): string {
  return branch.replace(/\//g, "-");
}

// List all available projects from ~/projects
export function listProjects(basePath?: string): Project[] {
  const projectsBase = basePath || DEFAULT_PROJECTS_BASE;

  if (!existsSync(projectsBase)) {
    console.log("[store] Projects base path does not exist:", projectsBase);
    return [];
  }

  try {
    const dirs = readdirSync(projectsBase);
    const projects: Project[] = [];

    for (const dir of dirs) {
      if (dir.startsWith(".")) continue;

      const fullPath = join(projectsBase, dir);
      try {
        const stat = statSync(fullPath);
        if (!stat.isDirectory()) continue;

        if (hasProjectMarkers(fullPath)) {
          // Check if we have stored lastAccessed
          let lastAccessed: string | undefined;
          try {
            const convPath = join(
              getProjectConfigDir(dir),
              "conversation.json",
            );
            if (existsSync(convPath)) {
              const conv = JSON.parse(readFileSync(convPath, "utf8"));
              lastAccessed = conv.updatedAt;
            }
          } catch {
            // Ignore
          }

          const worktreeInfo = detectWorktree(fullPath);

          projects.push({
            id: dir,
            path: fullPath,
            name: worktreeInfo
              ? `${getProjectName(worktreeInfo.mainWorktreePath)} [${worktreeInfo.branch}]`
              : getProjectName(fullPath),
            lastAccessed,
            worktree: worktreeInfo || undefined,
          });
        }
      } catch {
        // Skip directories we can't access
      }
    }

    // Sort by last accessed (most recent first), then by name
    return projects.sort((a, b) => {
      if (a.lastAccessed && b.lastAccessed) {
        return (
          new Date(b.lastAccessed).getTime() -
          new Date(a.lastAccessed).getTime()
        );
      }
      if (a.lastAccessed) return -1;
      if (b.lastAccessed) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (err) {
    console.error("[store] Failed to list projects:", err);
    return [];
  }
}

// Load conversation for a specific project
export function loadProjectConversation(
  projectId: string,
): ProjectConversation {
  try {
    const convPath = join(getProjectConfigDir(projectId), "conversation.json");
    if (!existsSync(convPath)) {
      return {
        projectId,
        messages: [],
        claudeSessionId: null,
        updatedAt: new Date().toISOString(),
      };
    }
    const data = JSON.parse(readFileSync(convPath, "utf8"));
    // Ensure all fields exist
    return {
      projectId,
      messages: data.messages || [],
      claudeSessionId: data.claudeSessionId || null,
      updatedAt: data.updatedAt || new Date().toISOString(),
    };
  } catch (err) {
    console.error(
      `[store] Failed to load project conversation for ${projectId}:`,
      err,
    );
    return {
      projectId,
      messages: [],
      claudeSessionId: null,
      updatedAt: new Date().toISOString(),
    };
  }
}

// Save conversation for a specific project
export function saveProjectConversation(
  projectId: string,
  conversation: ProjectConversation,
): void {
  ensureProjectsDir();
  ensureProjectConfigDir(projectId);
  conversation.updatedAt = new Date().toISOString();
  const convPath = join(getProjectConfigDir(projectId), "conversation.json");
  writeFileSync(convPath, JSON.stringify(conversation, null, 2));
  console.log(
    `[store] Project ${projectId} conversation saved, messages:`,
    conversation.messages.length,
  );
}

// Add message to a specific project
export function addProjectMessage(
  projectId: string,
  message: Message,
): ProjectConversation {
  const conversation = loadProjectConversation(projectId);
  conversation.messages.push(message);
  saveProjectConversation(projectId, conversation);
  return conversation;
}

// Get Claude session ID for a specific project
export function getProjectSessionId(projectId: string): string | null {
  const conversation = loadProjectConversation(projectId);
  return conversation.claudeSessionId;
}

// Save Claude session ID for a specific project
export function saveProjectSessionId(
  projectId: string,
  sessionId: string,
): void {
  const conversation = loadProjectConversation(projectId);
  conversation.claudeSessionId = sessionId;
  saveProjectConversation(projectId, conversation);
  console.log(`[store] Project ${projectId} session ID saved:`, sessionId);
}

// Clear conversation for a specific project
export function clearProjectConversation(projectId: string): void {
  ensureProjectsDir();
  ensureProjectConfigDir(projectId);
  const empty: ProjectConversation = {
    projectId,
    messages: [],
    claudeSessionId: null,
    updatedAt: new Date().toISOString(),
  };
  const convPath = join(getProjectConfigDir(projectId), "conversation.json");
  writeFileSync(convPath, JSON.stringify(empty, null, 2));
  console.log(`[store] Project ${projectId} conversation and session cleared`);
}

// Get project by ID (validates it exists)
export function getProject(
  projectId: string,
  basePath?: string,
): Project | null {
  if (!validateProjectId(projectId)) return null;
  const projectsBase = basePath || DEFAULT_PROJECTS_BASE;
  const fullPath = join(projectsBase, projectId);

  if (!existsSync(fullPath)) return null;

  try {
    const stat = statSync(fullPath);
    if (!stat.isDirectory()) return null;

    const worktreeInfo = detectWorktree(fullPath);

    return {
      id: projectId,
      path: fullPath,
      name: worktreeInfo
        ? `${getProjectName(worktreeInfo.mainWorktreePath)} [${worktreeInfo.branch}]`
        : getProjectName(fullPath),
      worktree: worktreeInfo || undefined,
    };
  } catch {
    return null;
  }
}

// ============================================
// Worktree management functions
// ============================================

export function listBranches(projectId: string, basePath?: string): string[] {
  const project = getProject(projectId, basePath);
  if (!project) return [];

  const repoPath = project.worktree
    ? project.worktree.mainWorktreePath
    : project.path;

  try {
    const output = execSync("git branch -a --format='%(refname:short)'", {
      cwd: repoPath,
      encoding: "utf-8",
      timeout: 10000,
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function createWorktree(
  projectId: string,
  branch: string,
  basePath?: string,
): Project {
  const projectsBase = basePath || DEFAULT_PROJECTS_BASE;
  const project = getProject(projectId, basePath);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  // Get the main repo path
  const mainRepoPath = project.worktree
    ? project.worktree.mainWorktreePath
    : project.path;
  const mainRepoId = basename(mainRepoPath);

  // Create directory name: repo--branch (sanitize / to -)
  const safeBranch = sanitizeBranchForDir(branch);
  const worktreeId = `${mainRepoId}--${safeBranch}`;

  if (!validateProjectId(worktreeId)) {
    throw new Error(`Invalid worktree directory name: ${worktreeId}`);
  }

  const worktreePath = join(projectsBase, worktreeId);

  if (existsSync(worktreePath)) {
    throw new Error(`Directory already exists: ${worktreeId}`);
  }

  // Check if the branch exists locally or remotely
  let branchExists = false;
  try {
    execSync(`git rev-parse --verify ${branch}`, {
      cwd: mainRepoPath,
      encoding: "utf-8",
      timeout: 5000,
      stdio: "pipe",
    });
    branchExists = true;
  } catch {
    // Try remote
    try {
      execSync(`git rev-parse --verify origin/${branch}`, {
        cwd: mainRepoPath,
        encoding: "utf-8",
        timeout: 5000,
        stdio: "pipe",
      });
      branchExists = true;
    } catch {
      // Branch doesn't exist anywhere — will be created new
    }
  }

  const cmd = branchExists
    ? `git worktree add ${JSON.stringify(worktreePath)} ${branch}`
    : `git worktree add -b ${branch} ${JSON.stringify(worktreePath)}`;

  console.log(`[store] Creating worktree: ${cmd}`);
  execSync(cmd, {
    cwd: mainRepoPath,
    encoding: "utf-8",
    timeout: 30000,
  });

  return {
    id: worktreeId,
    path: worktreePath,
    name: `${getProjectName(mainRepoPath)} [${branch}]`,
    worktree: {
      isWorktree: true,
      parentRepoId: mainRepoId,
      branch,
      mainWorktreePath: mainRepoPath,
    },
  };
}

export function removeWorktree(
  worktreeProjectId: string,
  basePath?: string,
): void {
  const project = getProject(worktreeProjectId, basePath);
  if (!project) throw new Error(`Project not found: ${worktreeProjectId}`);
  if (!project.worktree)
    throw new Error(`Not a worktree: ${worktreeProjectId}`);

  const mainRepoPath = project.worktree.mainWorktreePath;

  console.log(`[store] Removing worktree: ${project.path}`);
  execSync(`git worktree remove ${JSON.stringify(project.path)} --force`, {
    cwd: mainRepoPath,
    encoding: "utf-8",
    timeout: 30000,
  });
}
