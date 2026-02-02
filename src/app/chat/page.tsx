'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

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
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  return keyPair;
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
  return crypto.subtle.importKey(
    'raw',
    bits,
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

export default function ChatPage() {
  const [view, setView] = useState<View>('pairing');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentThinking, setCurrentThinking] = useState('');
  const [currentResponse, setCurrentResponse] = useState('');
  const [isPinSetup, setIsPinSetup] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const sharedKeyRef = useRef<CryptoKey | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentThinking, currentResponse]);

  useEffect(() => {
    const stored = localStorage.getItem('claude-remote-paired');
    if (stored) {
      setView('pin');
    }
  }, []);

  const completePairing = useCallback(async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (!token) {
      setError('No pairing token provided');
      return;
    }

    try {
      // Get server's public key
      const getRes = await fetch(`/pair/${token}`);
      if (!getRes.ok) {
        const err = await getRes.json();
        setError(err.error || 'Failed to get server key');
        return;
      }
      const { serverPublicKey } = await getRes.json();

      // Generate our key pair
      const keyPair = await generateKeyPair();
      const clientPublicKey = await exportPublicKey(keyPair.publicKey);

      // Export private key for storage
      const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

      // Send our public key to server
      const postRes = await fetch(`/pair/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientPublicKey }),
      });

      if (!postRes.ok) {
        const err = await postRes.json();
        setError(err.error || 'Failed to complete pairing');
        return;
      }

      const { deviceId } = await postRes.json();

      // Derive shared secret
      const serverKey = await importPublicKey(serverPublicKey);
      const sharedKey = await deriveSharedSecret(keyPair.privateKey, serverKey);

      // Store everything
      localStorage.setItem('claude-remote-paired', 'true');
      localStorage.setItem('claude-remote-device-id', deviceId);
      localStorage.setItem('claude-remote-private-key', JSON.stringify(privateKeyJwk));
      localStorage.setItem('claude-remote-server-public-key', serverPublicKey);

      sharedKeyRef.current = sharedKey;
      setIsPinSetup(true);
      setView('pin');
    } catch (err) {
      setError(`Pairing failed: ${err}`);
    }
  }, []);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('token') && view === 'pairing') {
      completePairing();
    }
  }, [completePairing, view]);

  const restoreSharedKey = useCallback(async () => {
    const privateKeyJwk = localStorage.getItem('claude-remote-private-key');
    const serverPublicKey = localStorage.getItem('claude-remote-server-public-key');

    if (!privateKeyJwk || !serverPublicKey) {
      return false;
    }

    try {
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
      return true;
    } catch {
      return false;
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      wsRef.current = ws;
    };

    ws.onmessage = async (event) => {
      if (!sharedKeyRef.current) return;

      try {
        const encrypted: EncryptedData = JSON.parse(event.data);
        const decrypted = await decrypt(encrypted, sharedKeyRef.current);
        const msg = JSON.parse(decrypted);

        if (msg.type === 'auth_ok') {
          setError('');
          setView('chat');
        } else if (msg.type === 'auth_error') {
          setError(msg.error || 'Authentication failed');
        } else if (msg.type === 'thinking') {
          setCurrentThinking(prev => prev + (msg.text || ''));
        } else if (msg.type === 'text') {
          setCurrentResponse(prev => prev + (msg.text || ''));
        } else if (msg.type === 'done') {
          setIsStreaming(false);
          if (currentThinking || currentResponse) {
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: currentResponse,
              thinking: currentThinking || undefined,
            }]);
            setCurrentThinking('');
            setCurrentResponse('');
          }
        } else if (msg.type === 'error') {
          setError(msg.error || 'An error occurred');
          setIsStreaming(false);
        }
      } catch (err) {
        console.error('Failed to process message:', err);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
    };

    ws.onerror = () => {
      setError('WebSocket connection failed');
    };
  }, [currentThinking, currentResponse]);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin || pin.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }

    if (!sharedKeyRef.current) {
      const restored = await restoreSharedKey();
      if (!restored) {
        setError('Failed to restore encryption keys');
        return;
      }
    }

    if (!wsRef.current) {
      connectWebSocket();
      // Wait for connection
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (wsRef.current && sharedKeyRef.current) {
      const encrypted = await encrypt(
        JSON.stringify({ type: 'auth', pin }),
        sharedKeyRef.current
      );
      wsRef.current.send(JSON.stringify(encrypted));
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !wsRef.current || !sharedKeyRef.current || isStreaming) return;

    const text = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsStreaming(true);
    setCurrentThinking('');
    setCurrentResponse('');

    const encrypted = await encrypt(
      JSON.stringify({ type: 'message', text }),
      sharedKeyRef.current
    );
    wsRef.current.send(JSON.stringify(encrypted));
  };

  const handleCancel = async () => {
    if (!wsRef.current || !sharedKeyRef.current) return;

    const encrypted = await encrypt(
      JSON.stringify({ type: 'cancel' }),
      sharedKeyRef.current
    );
    wsRef.current.send(JSON.stringify(encrypted));
  };

  if (view === 'pairing') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Pairing...</h1>
          {error ? (
            <p className="text-red-400">{error}</p>
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
          <h1 className="text-2xl font-bold mb-2 text-center">
            {isPinSetup ? 'Set Your PIN' : 'Enter PIN'}
          </h1>
          {isPinSetup && (
            <p className="text-gray-400 text-sm mb-4 text-center">
              Choose a PIN to secure your session
            </p>
          )}
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
              {isPinSetup ? 'Set PIN' : 'Unlock'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col bg-gray-900 text-white">
      {/* Messages */}
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
              <div
                className={`rounded-lg p-3 ${
                  msg.role === 'user' ? 'bg-blue-600' : 'bg-gray-700'
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          </div>
        ))}

        {/* Streaming response */}
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
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-700">
        {error && <p className="text-red-400 text-sm mb-2">{error}</p>}
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={isStreaming}
            className="flex-1 p-3 bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={handleCancel}
              className="px-4 py-3 bg-red-600 rounded-lg font-semibold hover:bg-red-700 transition-colors"
            >
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-4 py-3 bg-blue-600 rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
