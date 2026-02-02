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
  loadDevice,
  saveDevice,
  loadServerState,
  saveServerState,
  verifyPin,
  hashPin,
  Device,
  ServerState,
} from './src/lib/store';
import { spawnClaude, ClaudeEvent } from './src/lib/claude';

const port = parseInt(process.env.PORT || '6767', 10);

const PIN = process.env.CLAUDE_REMOTE_PIN;
if (!PIN) {
  console.error('CLAUDE_REMOTE_PIN environment variable is required');
  process.exit(1);
}

let pinHash: string;
let serverState: ServerState;
let device: Device | null;

function initializeServer() {
  device = loadDevice();
  const existingState = loadServerState();

  if (existingState && device) {
    serverState = { ...existingState, pairingToken: null };
  } else if (existingState && !device) {
    serverState = { ...existingState, pairingToken: randomBytes(16).toString('hex') };
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
  device = loadDevice();
  const existingState = loadServerState();
  if (existingState) {
    serverState = existingState;
  }
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

  // API: Status (does NOT expose pairing token - that's only in server logs)
  if (pathname === '/api/status' && method === 'GET') {
    reloadState();
    return json(res, {
      paired: !!device,
      deviceId: device?.id || null,
      pairedAt: device?.createdAt || null,
    });
  }

  // API: Pair GET - get server public key
  if (pathname?.startsWith('/api/pair/') && method === 'GET') {
    reloadState();
    const token = pathname.split('/api/pair/')[1];

    if (device) {
      return json(res, { error: 'Already paired' }, 400);
    }
    if (!serverState || serverState.pairingToken !== token) {
      return json(res, { error: 'Invalid token' }, 400);
    }

    return json(res, { serverPublicKey: serverState.publicKey });
  }

  // API: Pair POST - complete pairing
  if (pathname?.startsWith('/api/pair/') && method === 'POST') {
    reloadState();
    const token = pathname.split('/api/pair/')[1];

    if (device) {
      return json(res, { error: 'Already paired' }, 400);
    }
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

    saveDevice(newDevice);
    device = newDevice;
    serverState.pairingToken = null;
    saveServerState(serverState);

    return json(res, { serverPublicKey: serverState.publicKey, deviceId: newDevice.id });
  }

  // API: Unpair
  if (pathname === '/api/unpair' && method === 'POST') {
    const { unlinkSync } = await import('fs');
    const { join } = await import('path');
    const { homedir } = await import('os');

    const configDir = join(homedir(), '.config', 'claude-remote');
    const devicePath = join(configDir, 'device.json');
    const serverPath = join(configDir, 'server.json');

    if (existsSync(devicePath)) {
      unlinkSync(devicePath);
    }

    if (existsSync(serverPath)) {
      const state = JSON.parse(readFileSync(serverPath, 'utf8'));
      state.pairingToken = randomBytes(16).toString('hex');
      const { writeFileSync } = await import('fs');
      writeFileSync(serverPath, JSON.stringify(state, null, 2));
    }

    reloadState();
    return json(res, { success: true });
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

      try {
        const encrypted: EncryptedData = JSON.parse(raw.toString());
        const decrypted = decrypt(encrypted, device.sharedSecret);
        const msg = JSON.parse(decrypted);

        if (msg.type === 'auth') {
          const valid = await verifyPin(msg.pin, pinHash);
          if (valid) {
            authenticated = true;
            sendEncrypted({ type: 'auth_ok' });
          } else {
            sendEncrypted({ type: 'auth_error', error: 'Invalid PIN' });
          }
        } else if (msg.type === 'message') {
          if (!authenticated) {
            sendEncrypted({ type: 'error', error: 'Not authenticated' });
            return;
          }

          abortController = new AbortController();

          spawnClaude(msg.text, (event: ClaudeEvent) => {
            sendEncrypted(event);
          }, abortController.signal);
        } else if (msg.type === 'cancel') {
          if (abortController) {
            abortController.abort();
            abortController = null;
          }
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
        sendEncrypted({ type: 'error', error: 'Invalid message' });
      }
    });

    ws.on('close', () => {
      if (abortController) {
        abortController.abort();
      }
    });
  });

  server.listen(port, () => {
    console.log(`> Server ready on http://localhost:${port}`);
    if (serverState.pairingToken) {
      const clientPort = process.env.NODE_ENV === 'production' ? port : 5173;
      const pairUrl = `http://localhost:${clientPort}/pair/${serverState.pairingToken}`;
      console.log(`> Pair URL: ${pairUrl}`);
      console.log('');
      qrcode.generate(pairUrl, { small: true });
    } else {
      console.log('> Device already paired');
    }
  });
}

main();
