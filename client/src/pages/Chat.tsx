import { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  token: string | null;
  onNavigate: (route: 'home' | 'chat' | 'pair') => void;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
}

interface EncryptedData {
  iv: string;
  ct: string;
  tag: string;
}

async function generateKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
}

async function exportPublicKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

async function importPublicKey(base64: string): Promise<CryptoKey> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

async function deriveSharedSecret(privateKey: CryptoKey, peerPublicKey: CryptoKey): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    256
  );
  // Hash with SHA-256 to ensure consistent 32-byte key across platforms
  const hashed = await crypto.subtle.digest('SHA-256', bits);
  return crypto.subtle.importKey(
    'raw',
    hashed,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(plaintext: string, key: CryptoKey): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  const ct = new Uint8Array(encrypted.slice(0, -16));
  const tag = new Uint8Array(encrypted.slice(-16));
  return {
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...ct)),
    tag: btoa(String.fromCharCode(...tag)),
  };
}

async function decrypt(data: EncryptedData, key: CryptoKey): Promise<string> {
  const iv = Uint8Array.from(atob(data.iv), c => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(data.ct), c => c.charCodeAt(0));
  const tag = Uint8Array.from(atob(data.tag), c => c.charCodeAt(0));
  const combined = new Uint8Array(ct.length + tag.length);
  combined.set(ct);
  combined.set(tag, ct.length);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    combined
  );
  return new TextDecoder().decode(decrypted);
}

type View = 'pairing' | 'pin' | 'chat';

export default function Chat({ token }: Props) {
  const [view, setView] = useState<View>('pairing');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentThinking, setCurrentThinking] = useState('');
  const [currentResponse, setCurrentResponse] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const sharedKeyRef = useRef<CryptoKey | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef('');
  const responseRef = useRef('');

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const fetchConversationHistory = async () => {
    console.log('Fetching conversation history...');
    try {
      const res = await fetch('/api/conversation');
      if (!res.ok) {
        throw new Error(`Failed to fetch history: ${res.status}`);
      }
      const data = await res.json();
      console.log('Loaded conversation history:', data.messages?.length, 'messages');
      if (data.messages && data.messages.length > 0) {
        setMessages(data.messages.map((m: { role: string; content: string; thinking?: string }) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          thinking: m.thinking,
        })));
      }
    } catch (err) {
      console.error('Failed to fetch conversation history:', err);
      // Don't show error to user - just start fresh
    }
  };

  const clearHistory = async () => {
    console.log('Clearing conversation history...');
    try {
      const res = await fetch('/api/conversation', { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`Failed to clear history: ${res.status}`);
      }
      setMessages([]);
      console.log('History cleared');
    } catch (err) {
      const msg = `Failed to clear history: ${err}`;
      console.error(msg);
      alert(msg);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentThinking, currentResponse]);

  useEffect(() => {
    console.log('Chat useEffect: token =', token);
    if (token) {
      console.log('New pairing flow - clearing old credentials');
      localStorage.removeItem('claude-remote-paired');
      localStorage.removeItem('claude-remote-device-id');
      localStorage.removeItem('claude-remote-private-key');
      localStorage.removeItem('claude-remote-server-public-key');
      // Stay in 'pairing' view, completePairing will run
    } else {
      const stored = localStorage.getItem('claude-remote-paired');
      console.log('No token, checking localStorage:', { stored });
      if (stored) {
        console.log('Found pairing, showing PIN view');
        setView('pin');
      } else {
        const msg = 'Not paired. Go to home page to scan QR code.';
        console.error(msg);
        alert(msg);
        setError(msg);
      }
    }
  }, [token]);

  const pairingStarted = useRef(false);

  const completePairing = useCallback(async () => {
    if (!token || pairingStarted.current) {
      return;
    }
    pairingStarted.current = true;

    console.log('Fetching server public key...');
    const getRes = await fetch(`/api/pair/${token}`);
    if (!getRes.ok) {
      const data = await getRes.json().catch(() => ({}));
      const msg = `FATAL: Failed to get server key: ${data.error || getRes.status}`;
      console.error(msg, data);
      alert(msg);
      setError(msg);
      throw new Error(msg);
    }
    const getData = await getRes.json();
    console.log('Got server response:', getData);
    const { serverPublicKey } = getData;
    if (!serverPublicKey) {
      const msg = 'FATAL: Server returned empty public key';
      console.error(msg, getData);
      alert(msg);
      setError(msg);
      throw new Error(msg);
    }

    const keyPair = await generateKeyPair();
    const clientPublicKey = await exportPublicKey(keyPair.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    const postRes = await fetch(`/api/pair/${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientPublicKey }),
    });

    if (!postRes.ok) {
      const data = await postRes.json();
      const msg = `Failed to complete pairing: ${data.error || postRes.status}`;
      console.error(msg, data);
      setError(msg);
      throw new Error(msg);
    }

    const { deviceId } = await postRes.json();
    if (!deviceId) {
      const msg = 'Server returned empty device ID';
      console.error(msg);
      setError(msg);
      throw new Error(msg);
    }

    const serverKey = await importPublicKey(serverPublicKey);
    await deriveSharedSecret(keyPair.privateKey, serverKey); // Verify key derivation works

    localStorage.setItem('claude-remote-paired', 'true');
    localStorage.setItem('claude-remote-device-id', deviceId);
    localStorage.setItem('claude-remote-private-key', JSON.stringify(privateKeyJwk));
    localStorage.setItem('claude-remote-server-public-key', serverPublicKey);

    // Hard redirect to avoid React strict mode issues
    window.location.href = '/chat';
  }, [token]);

  useEffect(() => {
    if (token && view === 'pairing') {
      completePairing().catch((err) => {
        console.error('Pairing failed:', err);
        // Error already set in completePairing
      });
    }
  }, [completePairing, token, view]);

  const restoreSharedKey = useCallback(async (): Promise<void> => {
    const privateKeyJwk = localStorage.getItem('claude-remote-private-key');
    const serverPublicKey = localStorage.getItem('claude-remote-server-public-key');

    if (!privateKeyJwk) {
      throw new Error('No private key in localStorage - device not paired');
    }
    if (!serverPublicKey) {
      throw new Error('No server public key in localStorage - device not paired');
    }

    const privateKey = await crypto.subtle.importKey(
      'jwk',
      JSON.parse(privateKeyJwk),
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );
    const serverKey = await importPublicKey(serverPublicKey);
    const sharedKey = await deriveSharedSecret(privateKey, serverKey);
    sharedKeyRef.current = sharedKey;
  }, []);

  const connectWebSocket = useCallback((): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => {
        wsRef.current = ws;
        resolve(ws);
      };

      ws.onmessage = async (event) => {
        if (!sharedKeyRef.current) {
          const err = 'FATAL: Received WebSocket message but sharedKeyRef is null - this should never happen';
          console.error(err);
          alert(err);
          setError(err);
          setIsStreaming(false);
          return;
        }

        let encrypted: EncryptedData;
        try {
          encrypted = JSON.parse(event.data);
        } catch (err) {
          const msg = `FATAL: Failed to parse WebSocket message as JSON: ${err}`;
          console.error(msg, event.data);
          alert(msg);
          setError(msg);
          setIsStreaming(false);
          return;
        }

        let decrypted: string;
        try {
          decrypted = await decrypt(encrypted, sharedKeyRef.current);
        } catch (err) {
          const msg = `FATAL: Decryption failed - crypto keys likely mismatched. Clear localStorage and re-pair. Error: ${err}`;
          console.error(msg, err, encrypted);
          alert(msg);
          setError(msg);
          setIsStreaming(false);
          return;
        }

        let msg: { type: string; text?: string; error?: string };
        try {
          msg = JSON.parse(decrypted);
        } catch (err) {
          const errMsg = `FATAL: Failed to parse decrypted message as JSON: ${err}`;
          console.error(errMsg, decrypted);
          alert(errMsg);
          setError(errMsg);
          setIsStreaming(false);
          return;
        }

        if (msg.type === 'auth_ok') {
          setError('');
          setView('chat');
          // Fetch conversation history
          fetchConversationHistory();
        } else if (msg.type === 'auth_error') {
          const errMsg = `AUTH FAILED: ${msg.error || 'Unknown auth error'}`;
          console.error(errMsg);
          alert(errMsg);
          setError(errMsg);
        } else if (msg.type === 'thinking') {
          thinkingRef.current += msg.text || '';
          setCurrentThinking(thinkingRef.current);
        } else if (msg.type === 'text') {
          responseRef.current += msg.text || '';
          setCurrentResponse(responseRef.current);
        } else if (msg.type === 'done') {
          setIsStreaming(false);
          const thinking = thinkingRef.current;
          const response = responseRef.current;
          if (thinking || response) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: response,
              thinking: thinking || undefined,
            }]);
          }
          thinkingRef.current = '';
          responseRef.current = '';
          setCurrentThinking('');
          setCurrentResponse('');
        } else if (msg.type === 'error') {
          const errMsg = `SERVER ERROR: ${msg.error || 'Unknown server error'}`;
          console.error(errMsg);
          alert(errMsg);
          setError(errMsg);
          setIsStreaming(false);
        } else {
          const errMsg = `Unknown message type: ${msg.type}`;
          console.error(errMsg, msg);
          setError(errMsg);
        }
      };

      ws.onclose = (event) => {
        const msg = `WebSocket CLOSED: code=${event.code} reason="${event.reason || 'none'}"`;
        console.error(msg);
        wsRef.current = null;
        setIsStreaming(false);
        if (event.code !== 1000) {
          alert(msg);
          setError(msg);
        }
      };

      ws.onerror = (event) => {
        const msg = 'FATAL: WebSocket connection failed';
        console.error(msg, event);
        alert(msg);
        setError(msg);
        setIsStreaming(false);
        reject(new Error(msg));
      };
    });
  }, []);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('handlePinSubmit called', { pin: pin ? `${pin.length} digits` : 'empty' });

    if (!pin || pin.length < 4) {
      const msg = 'PIN must be at least 4 digits';
      alert(msg);
      setError(msg);
      return;
    }

    if (!sharedKeyRef.current) {
      try {
        console.log('Restoring shared key...');
        await restoreSharedKey();
        console.log('Shared key restored');
      } catch (err) {
        const msg = `FATAL: Failed to restore encryption keys: ${err}`;
        console.error(msg, err);
        alert(msg);
        setError(msg);
        return;
      }
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      try {
        console.log('Connecting WebSocket...');
        await connectWebSocket();
        console.log('WebSocket connected');
      } catch (err) {
        const msg = `FATAL: WebSocket connection failed: ${err}`;
        console.error(msg);
        alert(msg);
        setError(msg);
        return;
      }
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      const err = `FATAL: WebSocket not connected after connect attempt (state: ${wsRef.current?.readyState ?? 'null'})`;
      console.error(err);
      alert(err);
      setError(err);
      return;
    }

    if (!sharedKeyRef.current) {
      const err = 'FATAL: Shared key is null after restore - cannot encrypt';
      console.error(err);
      alert(err);
      setError(err);
      return;
    }

    console.log('Sending auth message...');
    const encrypted = await encrypt(
      JSON.stringify({ type: 'auth', pin }),
      sharedKeyRef.current
    );
    wsRef.current.send(JSON.stringify(encrypted));
    console.log('Auth message sent');
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('handleSend called', { input, isStreaming, wsRef: wsRef.current, sharedKey: sharedKeyRef.current });

    if (!input.trim()) {
      return;
    }

    if (isStreaming) {
      const msg = 'Already streaming - wait for response or click Cancel';
      console.error(msg);
      alert(msg);
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      const err = `FATAL: WebSocket not connected (state: ${wsRef.current?.readyState ?? 'null'}) - cannot send message`;
      console.error(err);
      alert(err);
      setError(err);
      return;
    }

    if (!sharedKeyRef.current) {
      const err = 'FATAL: Shared key is null - cannot encrypt. Re-pair required.';
      console.error(err);
      alert(err);
      setError(err);
      return;
    }

    const text = input.trim();
    setInput('');
    setError(''); // Clear any previous errors
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsStreaming(true);
    thinkingRef.current = '';
    responseRef.current = '';
    setCurrentThinking('');
    setCurrentResponse('');

    try {
      const encrypted = await encrypt(
        JSON.stringify({ type: 'message', text }),
        sharedKeyRef.current
      );
      wsRef.current.send(JSON.stringify(encrypted));
    } catch (err) {
      const msg = `FATAL: Failed to encrypt/send message: ${err}`;
      console.error(msg, err);
      alert(msg);
      setError(msg);
      setIsStreaming(false);
    }
  };

  const handleCancel = async () => {
    console.log('handleCancel called');

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      const msg = 'Cannot cancel - WebSocket not connected. Click Reset instead.';
      console.error(msg);
      alert(msg);
      setIsStreaming(false);
      return;
    }

    if (!sharedKeyRef.current) {
      const msg = 'Cannot cancel - no shared key. Click Reset instead.';
      console.error(msg);
      alert(msg);
      setIsStreaming(false);
      return;
    }

    try {
      const encrypted = await encrypt(
        JSON.stringify({ type: 'cancel' }),
        sharedKeyRef.current
      );
      wsRef.current.send(JSON.stringify(encrypted));
      setIsStreaming(false);
    } catch (err) {
      const msg = `Failed to send cancel: ${err}`;
      console.error(msg);
      alert(msg);
      setIsStreaming(false);
    }
  };

  if (view === 'pairing') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">{error ? 'Error' : 'Pairing...'}</h1>
          {error ? (
            <>
              <p className="text-red-400 mb-4">{error}</p>
              <a href="/" className="px-6 py-3 bg-blue-600 rounded-lg font-semibold hover:bg-blue-700 transition-colors inline-block">
                Go to Home
              </a>
            </>
          ) : (
            <p className="text-gray-400">Establishing secure connection</p>
          )}
        </div>
      </main>
    );
  }

  if (view === 'pin') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
        <div className="w-full max-w-xs">
          <h1 className="text-2xl font-bold mb-2 text-center">Enter PIN</h1>
          {error && <p className="text-red-400 text-sm mb-4 text-center">{error}</p>}
          <form onSubmit={handlePinSubmit}>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="Enter PIN"
              className="w-full p-4 text-2xl text-center bg-gray-800 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <button
              type="submit"
              className="w-full p-4 bg-blue-600 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              Unlock
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col bg-gray-900 text-white">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${msg.role === 'user' ? 'order-1' : ''}`}>
              {msg.thinking && (
                <div className="bg-gray-800 rounded-lg p-3 mb-2 text-sm text-gray-400 italic">
                  <div className="text-xs text-gray-500 mb-1">Thinking...</div>
                  <div className="whitespace-pre-wrap">{msg.thinking}</div>
                </div>
              )}
              <div className={`rounded-lg p-3 ${msg.role === 'user' ? 'bg-blue-600' : 'bg-gray-700'}`}>
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          </div>
        ))}

        {isStreaming && (currentThinking || currentResponse) && (
          <div className="flex justify-start">
            <div className="max-w-[85%]">
              {currentThinking && (
                <div className="bg-gray-800 rounded-lg p-3 mb-2 text-sm text-gray-400 italic">
                  <div className="text-xs text-gray-500 mb-1">Thinking...</div>
                  <div className="whitespace-pre-wrap">{currentThinking}</div>
                </div>
              )}
              {currentResponse && (
                <div className="bg-gray-700 rounded-lg p-3">
                  <div className="whitespace-pre-wrap">{currentResponse}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {isStreaming && !currentThinking && !currentResponse && (
          <div className="flex justify-start">
            <div className="bg-gray-700 rounded-lg p-3">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.1s]" />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0.2s]" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-700">
        {error && (
          <div className="bg-red-900 border border-red-500 rounded-lg p-3 mb-2">
            <p className="text-red-200 font-bold">ERROR:</p>
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isStreaming ? "Waiting for response..." : "Type a message..."}
            className="flex-1 p-3 bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={!input.trim() || isStreaming}
            className="px-4 py-3 bg-blue-600 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            Send
          </button>
          {isStreaming && (
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-3 bg-red-600 rounded-lg font-semibold hover:bg-red-700 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setIsStreaming(false);
              setError('');
              setCurrentThinking('');
              setCurrentResponse('');
              console.log('State reset by user');
            }}
            className="px-4 py-3 bg-gray-600 rounded-lg font-semibold hover:bg-gray-500 transition-colors"
            title="Reset stuck state"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={clearHistory}
            disabled={isStreaming}
            className="px-4 py-3 bg-yellow-700 rounded-lg font-semibold hover:bg-yellow-600 transition-colors disabled:opacity-50"
            title="Clear conversation history"
          >
            Clear
          </button>
        </form>
      </div>
    </main>
  );
}
