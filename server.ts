import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';
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

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '6767', 10);

// PIN must be set via environment variable
const PIN = process.env.CLAUDE_REMOTE_PIN;
if (!PIN) {
  console.error('CLAUDE_REMOTE_PIN environment variable is required');
  process.exit(1);
}

let pinHash: string;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Global state
let serverState: ServerState;
let device: Device | null;

function initializeServer() {
  device = loadDevice();
  const existingState = loadServerState();

  if (existingState && device) {
    // Already paired, use existing state
    serverState = { ...existingState, pairingToken: null };
  } else if (existingState && !device) {
    // Have keys but no device, generate new pairing token
    serverState = { ...existingState, pairingToken: randomBytes(16).toString('hex') };
  } else {
    // Fresh start, generate new keys and token
    const keyPair = generateKeyPair();
    serverState = {
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      pairingToken: randomBytes(16).toString('hex'),
    };
  }
  saveServerState(serverState);
}

// Export for API routes
export function getServerState() {
  return serverState;
}

export function getDevice() {
  return device;
}

export function completePairing(clientPublicKey: string) {
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
  return { serverPublicKey: serverState.publicKey, deviceId: newDevice.id };
}

app.prepare().then(async () => {
  pinHash = await hashPin(PIN);
  initializeServer();

  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error handling request:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    let authenticated = false;
    let abortController: AbortController | null = null;

    const sendEncrypted = (data: object) => {
      if (!device) return;
      const encrypted = encrypt(JSON.stringify(data), device.sharedSecret);
      ws.send(JSON.stringify(encrypted));
    };

    ws.on('message', async (raw: Buffer) => {
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
    console.log(`> Ready on http://${hostname}:${port}`);
    if (serverState.pairingToken) {
      console.log(`> Pairing token: ${serverState.pairingToken}`);
    } else {
      console.log('> Device already paired');
    }
  });
});
