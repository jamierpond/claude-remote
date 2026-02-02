import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import { readFileSync, existsSync, appendFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import qrcode from 'qrcode-terminal';
import { join } from 'path';
import {
  generateKeyPair,
  deriveSharedSecret,
  encrypt,
  decrypt,
  EncryptedData,
} from './src/lib/crypto';
import {
  loadDevices,
  addDevice,
  removeDevice,
  loadServerState,
  saveServerState,
  verifyPin,
  hashPin,
  loadConversation,
  addMessage,
  clearConversation,
  getClaudeSessionId,
  saveClaudeSessionId,
  Device,
  ServerState,
  Message,
  ToolActivity,
  OutputChunk,
  // Project support
  listProjects,
  getProject,
  loadProjectConversation,
  addProjectMessage,
  clearProjectConversation,
  getProjectSessionId,
  saveProjectSessionId,
} from './src/lib/store';
import { spawnClaude, ClaudeEvent } from './src/lib/claude';

// Track active Claude processes per device per project
// Key format: `${deviceId}:${projectId}` or just `${deviceId}` for legacy
const activeJobs: Map<string, AbortController> = new Map();
// Track connected WebSockets per device
const connectedClients: Map<string, WebSocket> = new Map();

// Broadcast reload message to all connected clients (for dev hot reload)
function broadcastReload() {
  console.log('[dev] Broadcasting reload to', connectedClients.size, 'clients');
  const devices = loadDevices();
  for (const [deviceId, ws] of connectedClients.entries()) {
    if (ws.readyState === WebSocket.OPEN) {
      const device = devices.find(d => d.id === deviceId);
      if (device) {
        const encrypted = encrypt(JSON.stringify({ type: 'reload' }), device.sharedSecret);
        ws.send(JSON.stringify(encrypted));
        console.log(`[dev] Sent reload to device ${deviceId}`);
      }
    }
  }
}

// Helper to create job key
function jobKey(deviceId: string, projectId?: string): string {
  return projectId ? `${deviceId}:${projectId}` : deviceId;
}

// Events file path
const configDir = join(homedir(), '.config', 'claude-remote');
const eventsFile = join(configDir, 'events.jsonl');

function appendEvent(deviceId: string, event: ClaudeEvent) {
  const line = JSON.stringify({ deviceId, event, ts: Date.now() }) + '\n';
  appendFileSync(eventsFile, line);
}

// Persist last flushed timestamp per device to disk
const lastFlushedFile = join(configDir, 'last-flushed.json');

function loadLastFlushedTs(): Record<string, number> {
  try {
    if (!existsSync(lastFlushedFile)) return {};
    return JSON.parse(readFileSync(lastFlushedFile, 'utf-8'));
  } catch { return {}; }
}

function saveLastFlushedTs(deviceId: string, ts: number) {
  const data = loadLastFlushedTs();
  data[deviceId] = ts;
  writeFileSync(lastFlushedFile, JSON.stringify(data, null, 2));
}

function loadPendingEvents(deviceId: string): ClaudeEvent[] {
  if (!existsSync(eventsFile)) return [];
  const lines = readFileSync(eventsFile, 'utf-8').trim().split('\n').filter(Boolean);
  const events: ClaudeEvent[] = [];
  const lastTs = loadLastFlushedTs()[deviceId] || 0;
  let maxTs = lastTs;
  for (const line of lines) {
    try {
      const { deviceId: did, event, ts } = JSON.parse(line);
      if (did === deviceId && ts > lastTs) {
        events.push(event);
        if (ts > maxTs) maxTs = ts;
      }
    } catch {}
  }
  if (maxTs > lastTs) saveLastFlushedTs(deviceId, maxTs);
  return events;
}

function clearPendingEvents(deviceId: string) {
  if (!existsSync(eventsFile)) return;
  const lines = readFileSync(eventsFile, 'utf-8').trim().split('\n').filter(Boolean);
  const remaining = lines.filter(line => {
    try {
      const { deviceId: did } = JSON.parse(line);
      return did !== deviceId;
    } catch { return true; }
  });
  writeFileSync(eventsFile, remaining.join('\n') + (remaining.length ? '\n' : ''));
}

// Partial response persistence (survives crashes)
const partialResponseFile = join(configDir, 'partial-responses.json');

interface PartialResponse {
  text: string;
  thinking: string;
  activity: ToolActivity[];
  updatedAt: number;
}

function loadPartialResponses(): Record<string, PartialResponse> {
  try {
    if (!existsSync(partialResponseFile)) return {};
    return JSON.parse(readFileSync(partialResponseFile, 'utf-8'));
  } catch { return {}; }
}

function savePartialResponse(deviceId: string, text: string, thinking: string, activity: ToolActivity[] = []) {
  const data = loadPartialResponses();
  data[deviceId] = { text, thinking, activity, updatedAt: Date.now() };
  writeFileSync(partialResponseFile, JSON.stringify(data, null, 2));
}

function clearPartialResponse(deviceId: string) {
  const data = loadPartialResponses();
  delete data[deviceId];
  writeFileSync(partialResponseFile, JSON.stringify(data, null, 2));
}

function recoverPartialResponses() {
  // On startup, check for partial responses and save them as messages
  const partials = loadPartialResponses();
  for (const [deviceId, partial] of Object.entries(partials)) {
    if (partial.text || partial.thinking || partial.activity.length > 0) {
      console.log(`[recovery] Found partial response for device ${deviceId}, saving...`);
      addMessage({
        role: 'assistant',
        content: partial.text + '\n\n[Response interrupted - server restarted]',
        thinking: partial.thinking || undefined,
        activity: partial.activity.length > 0 ? partial.activity : undefined,
        timestamp: new Date(partial.updatedAt).toISOString(),
      });
    }
  }
  // Clear all partials after recovery
  writeFileSync(partialResponseFile, '{}');
}

const port = parseInt(process.env.PORT || '6767', 10);
const clientUrl = process.env.CLIENT_URL || `http://localhost:5173`;
const serverUrl = process.env.SERVER_URL || `http://localhost:${port}`;

const PIN = process.env.CLAUDE_REMOTE_PIN;
if (!PIN) {
  console.error('CLAUDE_REMOTE_PIN environment variable is required');
  process.exit(1);
}

let pinHash: string;
let serverState: ServerState;
let devices: Device[] = [];

function initializeServer() {
  devices = loadDevices();
  const existingState = loadServerState();

  if (existingState) {
    // Always keep pairing token active for multi-device support
    if (!existingState.pairingToken) {
      existingState.pairingToken = randomBytes(16).toString('hex');
    }
    serverState = existingState;
  } else {
    const keyPair = generateKeyPair();
    serverState = {
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      pairingToken: randomBytes(16).toString('hex'),
    };
  }
  saveServerState(serverState);
}

function reloadState() {
  devices = loadDevices();
  const existingState = loadServerState();
  if (existingState) {
    serverState = existingState;
  }
}

function findDeviceByDecryption(encrypted: EncryptedData): Device | null {
  for (const device of devices) {
    try {
      decrypt(encrypted, device.sharedSecret);
      return device;
    } catch {
      // Try next device
    }
  }
  return null;
}

function json(res: ServerResponse, data: object, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const { pathname } = parse(req.url || '', true);
  const method = req.method || 'GET';

  // CORS for dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API: Status - includes pairing URL (always available for multi-device)
  if (pathname === '/api/status' && method === 'GET') {
    reloadState();
    return json(res, {
      paired: devices.length > 0,
      devices: devices.map(d => ({ id: d.id, createdAt: d.createdAt })),
      deviceCount: devices.length,
      pairingUrl: serverState.pairingToken ? `${clientUrl}/pair/${serverState.pairingToken}` : null,
    });
  }

  // API: Dev reload - broadcasts reload message to all connected clients
  if (pathname === '/api/dev/reload' && method === 'POST') {
    broadcastReload();
    return json(res, { ok: true, clients: connectedClients.size });
  }

  // API: Dev full reload - triggers Flutter hot restart then broadcasts reload
  if (pathname === '/api/dev/full-reload' && method === 'POST') {
    try {
      // Send SIGUSR2 to Flutter process for hot restart
      const pidFile = join(process.cwd(), 'logs', 'flutter.pid');
      if (existsSync(pidFile)) {
        const pid = readFileSync(pidFile, 'utf-8').trim();
        process.kill(parseInt(pid), 'SIGUSR2');
        console.log('[dev] Sent SIGUSR2 to Flutter process', pid);
      }
      // Wait for Flutter to rebuild, then broadcast reload
      setTimeout(() => {
        broadcastReload();
      }, 2000);
      return json(res, { ok: true, message: 'Flutter restart triggered, reload will broadcast in 2s' });
    } catch (e) {
      console.error('[dev] Full reload failed:', e);
      return json(res, { ok: false, error: String(e) }, 500);
    }
  }

  // API: Get conversation history
  if (pathname === '/api/conversation' && method === 'GET') {
    const conversation = loadConversation();
    console.log('[api] Returning conversation with', conversation.messages.length, 'messages');
    return json(res, conversation);
  }

  // API: Clear conversation
  if (pathname === '/api/conversation' && method === 'DELETE') {
    clearConversation();
    console.log('[api] Conversation cleared');
    return json(res, { success: true });
  }

  // API: List available projects
  if (pathname === '/api/projects' && method === 'GET') {
    const projects = listProjects();
    console.log('[api] Returning', projects.length, 'projects');
    return json(res, { projects });
  }

  // API: Get project conversation history
  if (pathname?.startsWith('/api/projects/') && pathname.endsWith('/conversation') && method === 'GET') {
    const projectId = pathname.split('/api/projects/')[1].replace('/conversation', '');
    const project = getProject(projectId);
    if (!project) {
      return json(res, { error: 'Project not found' }, 404);
    }
    const conversation = loadProjectConversation(projectId);
    console.log(`[api] Returning project ${projectId} conversation with`, conversation.messages.length, 'messages');
    return json(res, conversation);
  }

  // API: Clear project conversation
  if (pathname?.startsWith('/api/projects/') && pathname.endsWith('/conversation') && method === 'DELETE') {
    const projectId = pathname.split('/api/projects/')[1].replace('/conversation', '');
    const project = getProject(projectId);
    if (!project) {
      return json(res, { error: 'Project not found' }, 404);
    }
    clearProjectConversation(projectId);
    console.log(`[api] Project ${projectId} conversation cleared`);
    return json(res, { success: true });
  }

  // API: Get streaming state for a project (used on reconnect to restore UI state)
  if (pathname?.startsWith('/api/projects/') && pathname.endsWith('/streaming') && method === 'GET') {
    const projectId = decodeURIComponent(pathname.split('/api/projects/')[1].replace('/streaming', ''));

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

    console.log(`[api] Streaming state for ${projectId}: isStreaming=${isStreaming}`);
    return json(res, {
      isStreaming,
      partial: partialResponse ? {
        text: partialResponse.text,
        thinking: partialResponse.thinking,
        activity: partialResponse.activity,
      } : null,
    });
  }

  // API: Get git status for a project
  if (pathname?.startsWith('/api/projects/') && pathname.endsWith('/git') && method === 'GET') {
    const projectId = decodeURIComponent(pathname.split('/api/projects/')[1].replace('/git', ''));
    const project = getProject(projectId);
    if (!project) {
      return json(res, { error: 'Project not found' }, 404);
    }

    try {
      // Get current branch
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: project.path,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      // Check if working directory is dirty
      const status = execSync('git status --porcelain', {
        cwd: project.path,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      const isDirty = status.length > 0;

      // Count changed files
      const changedFiles = status ? status.split('\n').length : 0;

      // Get ahead/behind counts (may fail if no upstream)
      let ahead = 0;
      let behind = 0;
      try {
        const counts = execSync('git rev-list --left-right --count HEAD...@{upstream}', {
          cwd: project.path,
          encoding: 'utf-8',
          timeout: 5000,
        }).trim().split('\t');
        ahead = parseInt(counts[0], 10) || 0;
        behind = parseInt(counts[1], 10) || 0;
      } catch {
        // No upstream configured, ignore
      }

      console.log(`[api] Git status for ${projectId}: ${branch} ${isDirty ? '(dirty)' : '(clean)'}`);
      return json(res, {
        branch,
        isDirty,
        changedFiles,
        ahead,
        behind,
      });
    } catch (err) {
      // Not a git repo or git not available
      console.log(`[api] Git status failed for ${projectId}:`, err);
      return json(res, { error: 'Not a git repository' }, 400);
    }
  }

  // API: Pair GET - get server public key
  if (pathname?.startsWith('/api/pair/') && method === 'GET') {
    reloadState();
    const token = pathname.split('/api/pair/')[1];

    if (!serverState || serverState.pairingToken !== token) {
      return json(res, { error: 'Invalid token' }, 400);
    }

    return json(res, { serverPublicKey: serverState.publicKey });
  }

  // API: Pair POST - complete pairing (allows multiple devices)
  if (pathname?.startsWith('/api/pair/') && method === 'POST') {
    reloadState();
    const token = pathname.split('/api/pair/')[1];

    if (!serverState || serverState.pairingToken !== token) {
      return json(res, { error: 'Invalid token' }, 400);
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    const { clientPublicKey } = JSON.parse(body);
    if (!clientPublicKey) {
      return json(res, { error: 'Missing clientPublicKey' }, 400);
    }

    const sharedSecret = deriveSharedSecret(serverState.privateKey, clientPublicKey);
    const newDevice: Device = {
      id: randomBytes(8).toString('hex'),
      publicKey: clientPublicKey,
      sharedSecret,
      createdAt: new Date().toISOString(),
    };

    addDevice(newDevice);
    devices = loadDevices();
    console.log(`> New device paired: ${newDevice.id} (total: ${devices.length})`);

    return json(res, { serverPublicKey: serverState.publicKey, deviceId: newDevice.id });
  }

  // API: Unpair specific device or all devices
  if (pathname === '/api/unpair' && method === 'POST') {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let deviceId: string | null = null;
    try {
      const parsed = JSON.parse(body);
      deviceId = parsed.deviceId || null;
    } catch {
      // No body or invalid JSON - unpair all
    }

    if (deviceId) {
      // Remove specific device
      removeDevice(deviceId);
      console.log(`> Device ${deviceId} unpaired`);
    } else {
      // Remove all devices
      const { writeFileSync } = await import('fs');
      const { join } = await import('path');
      const { homedir } = await import('os');
      const configDir = join(homedir(), '.config', 'claude-remote');
      writeFileSync(join(configDir, 'devices.json'), '[]');
      console.log('> All devices unpaired');
    }

    reloadState();
    return json(res, { success: true, deviceCount: devices.length });
  }

  // Static files (production)
  const distPath = join(process.cwd(), 'dist', 'client');
  if (existsSync(distPath)) {
    let filePath = join(distPath, pathname === '/' ? 'index.html' : pathname || '');

    // SPA fallback
    if (!existsSync(filePath) || !filePath.includes('.')) {
      filePath = join(distPath, 'index.html');
    }

    if (existsSync(filePath)) {
      const ext = filePath.split('.').pop() || '';
      const contentTypes: Record<string, string> = {
        html: 'text/html',
        js: 'application/javascript',
        css: 'text/css',
        json: 'application/json',
        png: 'image/png',
        svg: 'image/svg+xml',
      };

      res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
      res.end(readFileSync(filePath));
      return;
    }
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

async function main() {
  pinHash = await hashPin(PIN);
  initializeServer();
  recoverPartialResponses();

  const server = createServer(handleRequest);
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = parse(req.url || '', true);

    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws: WebSocket) => {
    let authenticated = false;
    let currentDevice: Device | null = null;

    const sendEncrypted = (data: object) => {
      if (!currentDevice) return;
      if (ws.readyState !== WebSocket.OPEN) {
        // Write to disk for later
        appendEvent(currentDevice.id, data as ClaudeEvent);
        console.log(`[${currentDevice.id}] Event written to disk (ws not open)`);
        return;
      }
      const encrypted = encrypt(JSON.stringify(data), currentDevice.sharedSecret);
      ws.send(JSON.stringify(encrypted));
    };

    ws.on('message', async (raw: Buffer) => {
      reloadState();
      if (devices.length === 0) {
        ws.close(4001, 'No devices paired');
        return;
      }

      let encrypted: EncryptedData;
      try {
        encrypted = JSON.parse(raw.toString());
      } catch (err) {
        console.error('FATAL: Failed to parse WebSocket message as JSON:', err);
        console.error('Raw message:', raw.toString().substring(0, 200));
        ws.close(4002, 'Invalid JSON');
        return;
      }

      // Find device by trying decryption with each device's key
      if (!currentDevice) {
        currentDevice = findDeviceByDecryption(encrypted);
        if (currentDevice) {
          console.log(`Device identified: ${currentDevice.id}`);
        }
      }

      if (!currentDevice) {
        console.error('FATAL: No device could decrypt message - client needs to re-pair');
        ws.close(4003, 'Decryption failed - re-pair required');
        return;
      }

      let decrypted: string;
      try {
        decrypted = decrypt(encrypted, currentDevice.sharedSecret);
      } catch (err) {
        console.error('FATAL: Decryption failed - crypto keys mismatched. Client needs to re-pair.');
        console.error('Error:', err);
        ws.close(4003, 'Decryption failed - re-pair required');
        return;
      }

      let msg: { type: string; pin?: string; text?: string };
      try {
        msg = JSON.parse(decrypted);
      } catch (err) {
        console.error('FATAL: Failed to parse decrypted message as JSON:', err);
        ws.close(4004, 'Invalid message format');
        return;
      }

      console.log(`[${currentDevice.id}] Received message type:`, msg.type);

      if (msg.type === 'auth') {
        const valid = await verifyPin(msg.pin || '', pinHash);
        if (valid) {
          authenticated = true;
          console.log('Auth successful');
          
          // Register this connection
          connectedClients.set(currentDevice.id, ws);

          // Find all active jobs for this device (across all projects)
          const activeProjectIds: string[] = [];
          for (const key of activeJobs.keys()) {
            if (key.startsWith(`${currentDevice.id}:`)) {
              // Extract projectId from key format "deviceId:projectId"
              const projectId = key.substring(currentDevice.id.length + 1);
              activeProjectIds.push(projectId);
            } else if (key === currentDevice.id) {
              // Legacy global job (no projectId)
              activeProjectIds.push('__global__');
            }
          }

          sendEncrypted({ type: 'auth_ok', activeProjectIds });

          // Send partial responses for any active streaming sessions
          // This sends the accumulated content BEFORE pending events (which are deltas)
          if (activeProjectIds.length > 0) {
            const partials = loadPartialResponses();
            for (const projectId of activeProjectIds) {
              if (projectId === '__global__') continue;
              const jKey = jobKey(currentDevice.id, projectId);
              const partial = partials[jKey];
              if (partial) {
                sendEncrypted({
                  type: 'streaming_restore',
                  projectId,
                  thinking: partial.thinking,
                  text: partial.text,
                  activity: partial.activity,
                });
                console.log(`[${currentDevice.id}] Sent streaming restore for ${projectId}`);
              }
            }
          }

          // Flush any pending events from disk (but keep the file as backup)
          // These are delta events that occurred after the partial response was saved
          const pending = loadPendingEvents(currentDevice.id);
          if (pending.length > 0) {
            console.log(`[${currentDevice.id}] Flushing ${pending.length} pending events from disk`);
            for (const event of pending) {
              const encrypted = encrypt(JSON.stringify(event), currentDevice.sharedSecret);
              ws.send(JSON.stringify(encrypted));
            }
            // Don't clear - keep as backup log
          }
        } else {
          console.log('Auth failed - invalid PIN');
          sendEncrypted({ type: 'auth_error', error: 'Invalid PIN' });
        }
      } else if (msg.type === 'list_projects') {
        // List available projects
        const projects = listProjects();
        sendEncrypted({ type: 'projects_list', projects });
      } else if (msg.type === 'message') {
        if (!authenticated) {
          console.log('Message rejected - not authenticated');
          sendEncrypted({ type: 'error', error: 'Not authenticated' });
          return;
        }

        const userText = msg.text || '';
        const projectId = msg.projectId as string | undefined;
        console.log('Processing message:', userText.substring(0, 50), projectId ? `[project: ${projectId}]` : '[global]');

        // Validate project if specified
        let projectPath: string | undefined;
        if (projectId) {
          const project = getProject(projectId);
          if (!project) {
            sendEncrypted({ type: 'error', error: `Project not found: ${projectId}`, projectId });
            return;
          }
          projectPath = project.path;
        }

        // Save user message (to project or global)
        if (projectId) {
          addProjectMessage(projectId, {
            role: 'user',
            content: userText,
            timestamp: new Date().toISOString(),
          });
        } else {
          addMessage({
            role: 'user',
            content: userText,
            timestamp: new Date().toISOString(),
          });
        }

        const jKey = jobKey(currentDevice.id, projectId);
        const abortController = new AbortController();
        activeJobs.set(jKey, abortController);

        // Track assistant response
        let assistantThinking = '';
        let assistantText = '';
        const assistantActivity: ToolActivity[] = [];
        const assistantChunks: OutputChunk[] = [];
        let lastToolName: string | null = null;
        let currentChunkText = '';
        const taskStartedAt = new Date().toISOString();

        // Helper to detect if text starts a new chunk
        const isNewChunkStart = (text: string): boolean => {
          const trimmed = text.trim();
          // Text after a tool always starts a new chunk
          if (lastToolName !== null) return true;
          // Double newline indicates new section
          if (text.startsWith('\n\n')) return true;
          // Common transition phrases
          if (/^(Now|Next|Let me|I'll|First|Finally|Done|After|Moving|Continuing|Great|Perfect|Looking|Based on|The |This |I |Here)/i.test(trimmed)) return true;
          return false;
        };

        // Helper to flush current chunk
        const flushChunk = (afterTool?: string) => {
          if (currentChunkText.trim()) {
            assistantChunks.push({
              text: currentChunkText.trim(),
              timestamp: Date.now(),
              afterTool,
            });
            currentChunkText = '';
          }
        };

        // Get existing session ID for continuity
        const sessionId = projectId ? getProjectSessionId(projectId) : getClaudeSessionId();
        console.log('Using Claude session:', sessionId || 'new session', projectId ? `[project: ${projectId}]` : '');

        const deviceId = currentDevice.id;
        const deviceSecret = currentDevice.sharedSecret;

        spawnClaude(userText, (event: ClaudeEvent) => {
          console.log('[ws] Claude event:', event.type, event.sessionId ? `sessionId=${event.sessionId}` : '', projectId ? `[project: ${projectId}]` : '');

          // Don't forward session_init to client, just save it
          if (event.type === 'session_init' && event.sessionId) {
            console.log('[ws] Saving session ID:', event.sessionId, projectId ? `[project: ${projectId}]` : '');
            if (projectId) {
              saveProjectSessionId(projectId, event.sessionId);
            } else {
              saveClaudeSessionId(event.sessionId);
            }
            return;
          }

          // Transform error events: Claude uses 'text', client expects 'error'
          let transformedEvent = event;
          if (event.type === 'error' && event.text && !('error' in event)) {
            transformedEvent = { ...event, error: event.text };
          }
          
          // Include projectId in all events sent to client
          const eventWithProject = projectId ? { ...transformedEvent, projectId } : transformedEvent;

          // Try to send to connected client, or write to disk
          const clientWs = connectedClients.get(deviceId);
          if (clientWs && clientWs.readyState === WebSocket.OPEN) {
            const encrypted = encrypt(JSON.stringify(eventWithProject), deviceSecret);
            clientWs.send(JSON.stringify(encrypted));
          } else {
            // Write to disk for later
            appendEvent(deviceId, eventWithProject);
            console.log(`[${deviceId}] Event written to disk (client away)`);
          }

          // Collect response for saving
          if (event.type === 'thinking' && event.text) {
            assistantThinking += event.text;
            savePartialResponse(jKey, assistantText, assistantThinking, assistantActivity);
          } else if (event.type === 'text' && event.text) {
            // Check if this text starts a new chunk
            if (isNewChunkStart(event.text) && currentChunkText.trim()) {
              flushChunk(lastToolName || undefined);
              lastToolName = null;
            }
            currentChunkText += event.text;
            assistantText += event.text;
            savePartialResponse(jKey, assistantText, assistantThinking, assistantActivity);
          } else if (event.type === 'tool_use' && event.toolUse) {
            // Flush any text before tool use
            flushChunk();
            lastToolName = event.toolUse.tool;
            assistantActivity.push({
              type: 'tool_use',
              tool: event.toolUse.tool,
              input: event.toolUse.input,
              timestamp: Date.now(),
            });
            savePartialResponse(jKey, assistantText, assistantThinking, assistantActivity);
          } else if (event.type === 'tool_result' && event.toolResult) {
            assistantActivity.push({
              type: 'tool_result',
              tool: event.toolResult.tool,
              output: event.toolResult.output,
              error: event.toolResult.error,
              timestamp: Date.now(),
            });
            savePartialResponse(jKey, assistantText, assistantThinking, assistantActivity);
          } else if (event.type === 'done') {
            // Flush any remaining chunk
            flushChunk(lastToolName || undefined);

            // Save assistant message when complete (to project or global)
            if (assistantText || assistantThinking || assistantActivity.length > 0) {
              const assistantMsg: Message = {
                role: 'assistant',
                content: assistantText,
                task: userText,  // Store the original user prompt
                chunks: assistantChunks.length > 0 ? assistantChunks : undefined,
                thinking: assistantThinking || undefined,
                activity: assistantActivity.length > 0 ? assistantActivity : undefined,
                startedAt: taskStartedAt,
                completedAt: new Date().toISOString(),
                timestamp: new Date().toISOString(),
              };
              if (projectId) {
                addProjectMessage(projectId, assistantMsg);
              } else {
                addMessage(assistantMsg);
              }
            }
            // Clear partial response file
            clearPartialResponse(jKey);
            // Clear active job
            activeJobs.delete(jKey);
            console.log(`[${deviceId}] Job complete for ${projectId || 'global'}, cleared from active jobs`);
          }
        }, abortController.signal, sessionId, projectPath);
      } else if (msg.type === 'cancel') {
        console.log('Cancel requested', msg.projectId ? `[project: ${msg.projectId}]` : '[global]');
        const jKey = jobKey(currentDevice.id, msg.projectId as string | undefined);
        const abortController = activeJobs.get(jKey);
        if (abortController) {
          abortController.abort();
          activeJobs.delete(jKey);
        }
      } else {
        console.log('Unknown message type:', msg.type);
      }
    });

    ws.on('close', () => {
      // Don't abort - let Claude keep running
      // Just remove from connected clients
      if (currentDevice) {
        connectedClients.delete(currentDevice.id);
        console.log(`[${currentDevice.id}] Client disconnected, Claude will continue running`);
      }
    });
  });

  server.listen(port, () => {
    console.log(`> Server ready on ${serverUrl}`);
    console.log(`> Client URL: ${clientUrl}`);
    console.log(`> Paired devices: ${devices.length}`);
    if (serverState.pairingToken) {
      const pairUrl = `${clientUrl}/pair/${serverState.pairingToken}`;
      console.log(`> Pair URL: ${pairUrl}`);
      console.log('');
      qrcode.generate(pairUrl, { small: true });
    }
  });
}

main();
