import { config } from 'dotenv';
config({ path: '.env.local' });

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import { readFileSync, existsSync } from 'fs';
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
} from './src/lib/store';
import { spawnClaude, ClaudeEvent } from './src/lib/claude';

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
    let abortController: AbortController | null = null;

    const sendEncrypted = (data: object) => {
      reloadState();
      if (!device) return;
      const encrypted = encrypt(JSON.stringify(data), device.sharedSecret);
      ws.send(JSON.stringify(encrypted));
    };

    ws.on('message', async (raw: Buffer) => {
      reloadState();
      if (!device) {
        ws.close(4001, 'No device paired');
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

      let decrypted: string;
      try {
        decrypted = decrypt(encrypted, device.sharedSecret);
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

      console.log('Received message type:', msg.type);

      if (msg.type === 'auth') {
        const valid = await verifyPin(msg.pin || '', pinHash);
        if (valid) {
          authenticated = true;
          console.log('Auth successful');
          sendEncrypted({ type: 'auth_ok' });
        } else {
          console.log('Auth failed - invalid PIN');
          sendEncrypted({ type: 'auth_error', error: 'Invalid PIN' });
        }
      } else if (msg.type === 'message') {
        if (!authenticated) {
          console.log('Message rejected - not authenticated');
          sendEncrypted({ type: 'error', error: 'Not authenticated' });
          return;
        }

        const userText = msg.text || '';
        console.log('Processing message:', userText.substring(0, 50));

        // Save user message
        addMessage({
          role: 'user',
          content: userText,
          timestamp: new Date().toISOString(),
        });

        abortController = new AbortController();

        // Track assistant response
        let assistantThinking = '';
        let assistantText = '';

        // Get existing session ID for continuity
        const sessionId = getClaudeSessionId();
        console.log('Using Claude session:', sessionId || 'new session');

        spawnClaude(userText, (event: ClaudeEvent) => {
          console.log('[ws] Claude event:', event.type, event.sessionId ? `sessionId=${event.sessionId}` : '');

          // Don't forward session_init to client, just save it
          if (event.type === 'session_init' && event.sessionId) {
            console.log('[ws] Saving session ID:', event.sessionId);
            saveClaudeSessionId(event.sessionId);
            return;
          }

          sendEncrypted(event);

          // Collect response for saving
          if (event.type === 'thinking' && event.text) {
            assistantThinking += event.text;
          } else if (event.type === 'text' && event.text) {
            assistantText += event.text;
          } else if (event.type === 'done') {
            // Save assistant message when complete
            if (assistantText || assistantThinking) {
              addMessage({
                role: 'assistant',
                content: assistantText,
                thinking: assistantThinking || undefined,
                timestamp: new Date().toISOString(),
              });
            }
          }
        }, abortController.signal, sessionId);
      } else if (msg.type === 'cancel') {
        console.log('Cancel requested');
        if (abortController) {
          abortController.abort();
          abortController = null;
        }
      } else {
        console.log('Unknown message type:', msg.type);
      }
    });

    ws.on('close', () => {
      if (abortController) {
        abortController.abort();
      }
    });
  });

  server.listen(port, () => {
    console.log(`> Server ready on ${serverUrl}`);
    console.log(`> Client URL: ${clientUrl}`);
    if (serverState.pairingToken) {
      const pairUrl = `${clientUrl}/pair/${serverState.pairingToken}`;
      console.log(`> Pair URL: ${pairUrl}`);
      console.log('');
      qrcode.generate(pairUrl, { small: true });
    } else {
      console.log('> Device already paired');
      console.log(`> Go to ${clientUrl} to chat or unpair`);
    }
  });
}

main();
