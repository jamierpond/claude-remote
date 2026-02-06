import { useState, useEffect, useRef } from 'react';
import type { PairInfo } from '../App';

interface Props {
  onNavigate: (route: 'home' | 'chat' | 'pair') => void;
  pairInfo?: PairInfo | null;
}

interface DeviceInfo {
  id: string;
  createdAt: string;
}

interface Status {
  paired: boolean;
  devices: DeviceInfo[];
  deviceCount: number;
  pairingUrl: string | null;
}

// Crypto helpers (same as Chat.tsx)
async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
}

async function exportPublicKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

async function importPublicKey(base64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
  const hash = await crypto.subtle.digest('SHA-256', bits);
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export default function Home({ onNavigate, pairInfo }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [unpairing, setUnpairing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pairing state
  const [pairingUrl, setPairingUrl] = useState('');
  const [isPairing, setIsPairing] = useState(false);
  const [pairingLog, setPairingLog] = useState<string[]>([]);
  const autoPairingStarted = useRef(false);

  const addLog = (msg: string) => {
    console.log(msg);
    setPairingLog(prev => [...prev, msg]);
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error('Failed to fetch status');
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  // Auto-pair if pairInfo is provided from URL
  useEffect(() => {
    if (pairInfo && !autoPairingStarted.current) {
      autoPairingStarted.current = true;
      doPairingWithInfo(pairInfo.serverUrl, pairInfo.token);
    }
  }, [pairInfo]);

  const handleUnpair = async () => {
    setUnpairing(true);
    try {
      const res = await fetch('/api/unpair', { method: 'POST' });
      if (res.ok) {
        localStorage.removeItem('claude-remote-paired');
        localStorage.removeItem('claude-remote-device-id');
        localStorage.removeItem('claude-remote-private-key');
        localStorage.removeItem('claude-remote-server-public-key');
        await fetchStatus();
      }
    } catch {
      setError('Failed to unpair');
    } finally {
      setUnpairing(false);
    }
  };

  // Parse pairing URL and extract server + token
  // Supports both formats:
  // - New: https://client/pair?server=https://server&token=TOKEN
  // - Old: https://server/pair/TOKEN
  const parseUrl = (url: string): { serverUrl: string; token: string } | null => {
    try {
      const uri = new URL(url.trim());
      const params = new URLSearchParams(uri.search);
      const segments = uri.pathname.split('/').filter(Boolean);

      // New format: /pair?server=...&token=...
      const serverParam = params.get('server');
      const tokenParam = params.get('token');
      if (serverParam && tokenParam) {
        return { serverUrl: serverParam, token: tokenParam };
      }

      // Old format: /pair/TOKEN (server is the URL host)
      if (segments.length >= 2 && segments[0] === 'pair') {
        const token = segments[1];
        const serverUrl = `${uri.protocol}//${uri.host}`;
        return { serverUrl, token };
      }

      return null;
    } catch {
      return null;
    }
  };

  const doPairing = () => {
    const parsed = parseUrl(pairingUrl);
    if (!parsed) {
      setError('Invalid URL. Expected format: https://server/pair?server=...&token=... or https://server/pair/TOKEN');
      return;
    }
    doPairingWithInfo(parsed.serverUrl, parsed.token);
  };

  const doPairingWithInfo = async (serverUrl: string, token: string) => {
    setPairingLog([]);
    setError(null);
    addLog(`Server: ${serverUrl}`);
    addLog(`Token: ${token}`);

    setIsPairing(true);
    try {
      // Step 1: Generate keypair
      addLog('Generating keypair...');
      const keyPair = await generateKeyPair();
      const clientPublicKey = await exportPublicKey(keyPair.publicKey);
      const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
      addLog('Keypair generated');

      // Step 2: GET server public key
      addLog(`GET ${serverUrl}/pair/${token}`);
      const getRes = await fetch(`${serverUrl}/pair/${token}`);
      if (!getRes.ok) {
        const data = await getRes.json().catch(() => ({}));
        throw new Error(`Failed to get server key: ${data.error || getRes.status}`);
      }
      const { serverPublicKey } = await getRes.json();
      if (!serverPublicKey) {
        throw new Error('Server returned empty public key');
      }
      addLog('Got server public key');

      // Step 3: POST client public key
      addLog(`POST ${serverUrl}/pair/${token}`);
      const postRes = await fetch(`${serverUrl}/pair/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientPublicKey }),
      });
      if (!postRes.ok) {
        const data = await postRes.json().catch(() => ({}));
        throw new Error(`Failed to complete pairing: ${data.error || postRes.status}`);
      }
      const { deviceId } = await postRes.json();
      if (!deviceId) {
        throw new Error('Server returned empty device ID');
      }
      addLog(`Device ID: ${deviceId}`);

      // Step 4: Derive shared secret and store
      addLog('Deriving shared secret...');
      const serverKey = await importPublicKey(serverPublicKey);
      const sharedSecret = await deriveSharedSecret(keyPair.privateKey, serverKey);
      const sharedSecretJwk = await crypto.subtle.exportKey('jwk', sharedSecret);

      // Store credentials
      localStorage.setItem('claude-remote-paired', 'true');
      localStorage.setItem('claude-remote-device-id', deviceId);
      localStorage.setItem('claude-remote-private-key', JSON.stringify(privateKeyJwk));
      localStorage.setItem('claude-remote-server-public-key', serverPublicKey);
      localStorage.setItem('claude-remote-shared-secret', JSON.stringify(sharedSecretJwk));
      localStorage.setItem('claude-remote-server-url', serverUrl);

      addLog('Pairing complete!');

      // Navigate to chat
      setTimeout(() => {
        onNavigate('chat');
      }, 500);

    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      addLog(`ERROR: ${msg}`);
      setError(msg);
    } finally {
      setIsPairing(false);
    }
  };

  if (error && !pairingLog.length) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Error</h1>
          <p className="text-red-400">{error}</p>
        </div>
      </main>
    );
  }

  if (!status) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] p-4">
        <div className="text-center">
          <p className="text-[var(--color-text-secondary)]">Loading...</p>
        </div>
      </main>
    );
  }

  const hasBrowserCredentials = !!localStorage.getItem('claude-remote-paired');
  const myDeviceId = localStorage.getItem('claude-remote-device-id');

  // This browser is paired - show chat link
  if (hasBrowserCredentials && myDeviceId) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Claude Remote</h1>
          <p className="text-[var(--color-text-secondary)] mb-4">Device paired and ready.</p>
          <p className="text-sm text-[var(--color-text-tertiary)] mb-2">This device: {myDeviceId}</p>
          <p className="text-sm text-[var(--color-text-tertiary)] mb-6">Total devices: {status.deviceCount}</p>
          <div className="flex flex-col gap-3">
            <button
              onClick={() => onNavigate('chat')}
              className="px-6 py-3 bg-[var(--color-accent)] rounded-lg font-semibold hover:bg-[var(--color-accent-hover)] transition-colors text-center"
            >
              Open Chat
            </button>
            <button
              onClick={handleUnpair}
              disabled={unpairing}
              className="px-6 py-3 bg-[var(--color-bg-hover)] rounded-lg font-semibold hover:bg-[var(--color-border-emphasis)] transition-colors disabled:opacity-50"
            >
              {unpairing ? 'Resetting...' : 'Unpair All & Reset'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Not paired - show pairing input
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] p-4">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-2 text-center">Claude Remote</h1>
        <p className="text-[var(--color-text-secondary)] mb-6 text-center">
          Scan or paste your pairing link
        </p>

        {error && (
          <div className="bg-red-900/50 border border-red-500 rounded-lg p-3 mb-4">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <div className="space-y-4">
          <input
            type="text"
            value={pairingUrl}
            onChange={(e) => setPairingUrl(e.target.value)}
            placeholder="https://server/pair/token..."
            className="w-full px-4 py-3 bg-[var(--color-bg-secondary)] border border-[var(--color-border-default)] rounded-lg text-[var(--color-text-primary)] placeholder-[var(--color-text-tertiary)] focus:outline-none focus:border-[var(--color-accent)]"
          />

          <div className="flex gap-2">
            <button
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  setPairingUrl(text);
                } catch {
                  setError('Failed to read clipboard');
                }
              }}
              className="flex-1 px-4 py-3 bg-[var(--color-bg-hover)] rounded-lg font-semibold hover:bg-[var(--color-border-emphasis)] transition-colors"
            >
              Paste
            </button>
            <button
              onClick={doPairing}
              disabled={isPairing || !pairingUrl.trim()}
              className="flex-1 px-4 py-3 bg-[var(--color-accent)] rounded-lg font-semibold hover:bg-[var(--color-accent-hover)] transition-colors disabled:opacity-50"
            >
              {isPairing ? 'Pairing...' : 'Pair'}
            </button>
          </div>
        </div>

        {pairingLog.length > 0 && (
          <div className="mt-6 bg-[var(--color-bg-secondary)] rounded-lg p-4">
            <p className="text-[var(--color-text-secondary)] text-sm mb-2">Log:</p>
            <div className="font-mono text-xs text-green-400 space-y-1">
              {pairingLog.map((log, i) => (
                <p key={i}>{log}</p>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
