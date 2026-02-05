import { useState, useEffect, useRef, useCallback } from 'react';
import ProjectTabs, { type Project } from '../components/ProjectTabs';
import ProjectPicker from '../components/ProjectPicker';
import StreamingResponse, { type ToolActivity } from '../components/StreamingResponse';
import ToolStack from '../components/ToolStack';
import GitStatus from '../components/GitStatus';


interface Props {
  token: string | null;
  onNavigate: (route: 'home' | 'chat' | 'pair') => void;
}

interface OutputChunk {
  text: string;
  timestamp: number;
  afterTool?: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  task?: string;              // user's original prompt (for assistant messages)
  chunks?: OutputChunk[];     // structured output chunks
  thinking?: string;
  activity?: ToolActivity[];
  startedAt?: string;
  completedAt?: string;
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

// Per-project state container
interface ProjectState {
  messages: Message[];
  isStreaming: boolean;
  currentThinking: string;
  currentResponse: string;
  currentActivity: ToolActivity[];
  currentTask: string;         // The user prompt for current streaming task
  taskStartTime: number | null; // When the current task started
}

function createEmptyProjectState(): ProjectState {
  return {
    messages: [],
    isStreaming: false,
    currentThinking: '',
    currentResponse: '',
    currentActivity: [],
    currentTask: '',
    taskStartTime: null,
  };
}

export default function Chat({ token }: Props) {
  const [view, setView] = useState<View>('pairing');
  const [input, setInput] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  // Multi-project state
  const [openProjects, setOpenProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectStates, setProjectStates] = useState<Map<string, ProjectState>>(new Map());
  const [streamingProjectIds, setStreamingProjectIds] = useState<Set<string>>(new Set());
  const [showProjectPicker, setShowProjectPicker] = useState(false);
  const tabsRestoredRef = useRef(false);

  // Refs for streaming (per-project)
  const thinkingRefs = useRef<Map<string, string>>(new Map());
  const responseRefs = useRef<Map<string, string>>(new Map());
  const activityRefs = useRef<Map<string, ToolActivity[]>>(new Map());

  const wsRef = useRef<WebSocket | null>(null);
  const sharedKeyRef = useRef<CryptoKey | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Reconnection state
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cachedPinRef = useRef<string | null>((() => {
    try {
      const stored = localStorage.getItem('claude-remote-pin');
      if (!stored) return null;
      const { pin, exp } = JSON.parse(stored);
      if (Date.now() > exp) {
        localStorage.removeItem('claude-remote-pin');
        return null;
      }
      return pin as string;
    } catch {
      localStorage.removeItem('claude-remote-pin');
      return null;
    }
  })());
  const intentionalCloseRef = useRef(false);

  // Helper to get current project state
  const getProjectState = useCallback((projectId: string | null): ProjectState => {
    if (!projectId) return createEmptyProjectState();
    return projectStates.get(projectId) || createEmptyProjectState();
  }, [projectStates]);

  // Helper to update project state
  const updateProjectState = useCallback((projectId: string, updater: (state: ProjectState) => ProjectState) => {
    setProjectStates(prev => {
      const current = prev.get(projectId) || createEmptyProjectState();
      const updated = updater(current);
      const next = new Map(prev);
      next.set(projectId, updated);
      return next;
    });
  }, []);

  // Current active project state (for display)
  const activeState = getProjectState(activeProjectId);
  const messages = activeState.messages;
  const isStreaming = activeState.isStreaming;
  const currentThinking = activeState.currentThinking;
  const currentResponse = activeState.currentResponse;
  const currentActivity = activeState.currentActivity;
  const currentTask = activeState.currentTask;
  const taskStartTime = activeState.taskStartTime;

  const scrollToBottom = useCallback((force = false) => {
    if (!messagesEndRef.current) return;

    // Only auto-scroll if user is near the bottom (within 150px) or forced
    const container = messagesEndRef.current.parentElement;
    if (container && !force) {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      if (distanceFromBottom > 150) return; // User scrolled up, don't interrupt
    }

    messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Fetch conversation history for a specific project
  const fetchProjectConversation = useCallback(async (projectId: string, retries = 3) => {
    console.log(`Fetching conversation history for project: ${projectId}`);
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/conversation`);
        if (!res.ok) {
          throw new Error(`Failed to fetch history: ${res.status}`);
        }
        const data = await res.json();
        console.log(`Loaded conversation for ${projectId}:`, data.messages?.length, 'messages');
        if (data.messages && data.messages.length > 0) {
          const loadedMessages = data.messages.map((m: {
            role: string;
            content: string;
            task?: string;
            chunks?: OutputChunk[];
            thinking?: string;
            activity?: ToolActivity[];
            startedAt?: string;
            completedAt?: string;
          }) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            task: m.task,
            chunks: m.chunks,
            thinking: m.thinking,
            activity: m.activity,
            startedAt: m.startedAt,
            completedAt: m.completedAt,
          }));
          updateProjectState(projectId, state => ({ ...state, messages: loadedMessages }));
          // Scroll to bottom after messages are rendered
          // Use requestAnimationFrame to ensure DOM is updated, then scroll
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            });
          });
        }
        return; // Success
      } catch (err) {
        console.error(`Failed to fetch project conversation (attempt ${attempt}/${retries}):`, err);
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        }
      }
    }
    console.error('All retries failed for project conversation');
  }, [updateProjectState]);

  // Fetch streaming state for a project (to restore in-progress responses on reconnect)
  const fetchProjectStreamingState = useCallback(async (projectId: string) => {
    console.log(`Fetching streaming state for project: ${projectId}`);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/streaming`);
      if (!res.ok) {
        throw new Error(`Failed to fetch streaming state: ${res.status}`);
      }
      const data = await res.json();
      console.log(`Streaming state for ${projectId}:`, data);

      if (data.isStreaming && data.partial) {
        // Restore streaming state
        setStreamingProjectIds(prev => {
          const next = new Set(prev);
          next.add(projectId);
          return next;
        });

        // Update refs with partial data
        if (data.partial.thinking) {
          thinkingRefs.current.set(projectId, data.partial.thinking);
        }
        if (data.partial.text) {
          responseRefs.current.set(projectId, data.partial.text);
        }
        if (data.partial.activity && data.partial.activity.length > 0) {
          activityRefs.current.set(projectId, data.partial.activity);
        }

        // Update project state with restored streaming data
        updateProjectState(projectId, state => ({
          ...state,
          isStreaming: true,
          currentThinking: data.partial.thinking || '',
          currentResponse: data.partial.text || '',
          currentActivity: data.partial.activity || [],
        }));
      }
    } catch (err) {
      console.error(`Failed to fetch streaming state for ${projectId}:`, err);
    }
  }, [updateProjectState]);

  const clearHistory = async () => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/conversation`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to clear history: ${res.status}`);
      updateProjectState(activeProjectId, state => ({ ...state, messages: [] }));
    } catch (err) {
      setError(`Failed to clear history: ${err}`);
    }
  };

  // Scroll to bottom when new messages arrive or project changes (force scroll)
  const messagesLength = messages.length;
  useEffect(() => {
    scrollToBottom(true);
  }, [messagesLength, activeProjectId, scrollToBottom]);

  // Scroll during streaming only if user is near bottom (don't interrupt if scrolled up)
  useEffect(() => {
    if (isStreaming) {
      scrollToBottom(false);
    }
  }, [currentThinking, currentResponse, currentActivity, isStreaming, scrollToBottom]);

  // Persist open tabs to localStorage (skip initial render to avoid nuking saved data)
  const initialRenderRef = useRef(true);
  useEffect(() => {
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      return;
    }
    if (openProjects.length > 0) {
      localStorage.setItem('claude-remote-open-projects', JSON.stringify(openProjects));
    } else {
      localStorage.removeItem('claude-remote-open-projects');
    }
  }, [openProjects]);

  // Persist active tab to localStorage (skip initial render)
  const initialActiveRef = useRef(true);
  useEffect(() => {
    if (initialActiveRef.current) {
      initialActiveRef.current = false;
      return;
    }
    if (activeProjectId) {
      localStorage.setItem('claude-remote-active-project', activeProjectId);
    } else {
      localStorage.removeItem('claude-remote-active-project');
    }
  }, [activeProjectId]);

  useEffect(() => {
    console.log('Chat useEffect: token =', token);
    if (token) {
      console.log('New pairing flow - clearing old credentials');
      localStorage.removeItem('claude-remote-paired');
      localStorage.removeItem('claude-remote-device-id');
      localStorage.removeItem('claude-remote-private-key');
      localStorage.removeItem('claude-remote-server-public-key');
      localStorage.removeItem('claude-remote-pin');
      cachedPinRef.current = null;
      // Stay in 'pairing' view, completePairing will run
    } else {
      const stored = localStorage.getItem('claude-remote-paired');
      if (stored) {
        // Check if we have a cached PIN — auto-connect if so
        const cachedPin = cachedPinRef.current;
        if (cachedPin) {
          console.log('Found cached PIN, auto-connecting...');

          // Restore tabs from localStorage immediately (don't wait for auth_ok)
          const savedProjects = localStorage.getItem('claude-remote-open-projects');
          const savedActiveId = localStorage.getItem('claude-remote-active-project');
          if (savedProjects) {
            try {
              const projects: Project[] = JSON.parse(savedProjects);
              if (projects.length > 0) {
                setOpenProjects(projects);
                const newStates = new Map<string, ProjectState>();
                projects.forEach(p => {
                  newStates.set(p.id, createEmptyProjectState());
                });
                setProjectStates(newStates);
                const activeId = savedActiveId && projects.find(p => p.id === savedActiveId)
                  ? savedActiveId
                  : projects[0].id;
                setActiveProjectId(activeId);
                tabsRestoredRef.current = true;
              }
            } catch (err) {
              console.error('Failed to restore saved projects on init:', err);
            }
          }

          setView('chat');
          setIsReconnecting(true);
          setTimeout(() => connectAndAuth(), 0);
        } else {
          console.log('Found pairing but no cached PIN, showing PIN view');
          setView('pin');
        }
      } else {
        setError('Not paired. Go to home page to scan QR code.');
      }
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const pairingStarted = useRef(false);

  const completePairing = useCallback(async () => {
    if (!token || pairingStarted.current) {
      return;
    }
    pairingStarted.current = true;

    console.log('Fetching server public key...');
    const getRes = await fetch(`/pair/${token}`);
    if (!getRes.ok) {
      const data = await getRes.json().catch(() => ({}));
      const msg = `Failed to get server key: ${data.error || getRes.status}`;
      console.error(msg, data);
      setError(msg);
      throw new Error(msg);
    }
    const getData = await getRes.json();
    const { serverPublicKey } = getData;
    if (!serverPublicKey) {
      const msg = 'Server returned empty public key';
      console.error(msg, getData);
      setError(msg);
      throw new Error(msg);
    }

    const keyPair = await generateKeyPair();
    const clientPublicKey = await exportPublicKey(keyPair.publicKey);
    const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

    const postRes = await fetch(`/pair/${token}`, {
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

  // Schedule a reconnection attempt with exponential backoff
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    const attempt = reconnectAttemptRef.current;
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000); // 1s, 2s, 4s, ... 30s max
    console.log(`[reconnect] Scheduling attempt ${attempt + 1} in ${delay}ms`);
    reconnectAttemptRef.current = attempt + 1;
    setReconnectAttempt(attempt + 1);
    setIsReconnecting(true);
    reconnectTimerRef.current = setTimeout(() => {
      connectAndAuth();
    }, delay);
  }, []); // connectAndAuth referenced below via ref

  // Ref to break circular dependency between connectWebSocket and scheduleReconnect
  const scheduleReconnectRef = useRef(scheduleReconnect);
  scheduleReconnectRef.current = scheduleReconnect;

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
          console.error('[ws] Received message but sharedKeyRef is null');
          setError('Encryption key missing - please refresh the page');
          return;
        }

        let encrypted: EncryptedData;
        try {
          encrypted = JSON.parse(event.data);
        } catch (err) {
          console.error('[ws] Failed to parse message as JSON:', err);
          return;
        }

        let decrypted: string;
        try {
          decrypted = await decrypt(encrypted, sharedKeyRef.current);
        } catch (err) {
          console.error('[ws] Decryption failed:', err);
          setError('Decryption failed - keys may be mismatched. Try clearing data and re-pairing.');
          return;
        }

        let msg: {
          type: string;
          text?: string;
          thinking?: string;
          error?: string;
          projectId?: string;
          activeProjectIds?: string[];
          activity?: ToolActivity[];
          toolUse?: { tool: string; input: Record<string, unknown> };
          toolResult?: { tool: string; output?: string; error?: string };
        };
        try {
          msg = JSON.parse(decrypted);
        } catch (err) {
          console.error('[ws] Failed to parse decrypted message:', err);
          return;
        }

        // Get projectId from message (streaming events include it)
        const projectId = msg.projectId;

        if (msg.type === 'auth_ok') {
          // Successful auth — clear reconnection state
          setError('');
          setView('chat');
          setIsReconnecting(false);
          setReconnectAttempt(0);
          reconnectAttemptRef.current = 0;

          // Set streaming indicators for any active jobs
          const activeIds = msg.activeProjectIds || [];
          if (activeIds.length > 0) {
            console.log('Active streaming projects on reconnect:', activeIds);
            setStreamingProjectIds(new Set(activeIds.filter(id => id !== '__global__')));
            activeIds.forEach(projectId => {
              if (projectId !== '__global__') {
                updateProjectState(projectId, state => ({
                  ...state,
                  isStreaming: true,
                }));
              }
            });
          }

          // Restore tabs from localStorage, or show picker if none saved
          if (!tabsRestoredRef.current) {
            tabsRestoredRef.current = true;
            const savedProjects = localStorage.getItem('claude-remote-open-projects');
            const savedActiveId = localStorage.getItem('claude-remote-active-project');

            if (savedProjects) {
              try {
                const projects: Project[] = JSON.parse(savedProjects);
                if (projects.length > 0) {
                  setOpenProjects(projects);
                  const newStates = new Map<string, ProjectState>();
                  projects.forEach(p => {
                    const isStreaming = activeIds.includes(p.id);
                    newStates.set(p.id, {
                      ...createEmptyProjectState(),
                      isStreaming,
                    });
                  });
                  setProjectStates(newStates);
                  const activeId = savedActiveId && projects.find(p => p.id === savedActiveId)
                    ? savedActiveId
                    : projects[0].id;
                  setActiveProjectId(activeId);
                  projects.forEach(p => {
                    fetchProjectConversation(p.id);
                  });
                  return;
                }
              } catch (err) {
                console.error('Failed to restore saved projects:', err);
              }
            }
            setShowProjectPicker(true);
          } else {
            // Tabs already restored (e.g. from cached PIN init) — just fetch conversations
            const savedProjects = localStorage.getItem('claude-remote-open-projects');
            if (savedProjects) {
              try {
                const projects: Project[] = JSON.parse(savedProjects);
                projects.forEach(p => fetchProjectConversation(p.id));
              } catch {}
            }
          }
        } else if (msg.type === 'auth_error') {
          console.error('Auth failed:', msg.error);
          // PIN was wrong — clear cached PIN, drop to PIN screen
          cachedPinRef.current = null;
          localStorage.removeItem('claude-remote-pin');
          setIsReconnecting(false);
          setReconnectAttempt(0);
          reconnectAttemptRef.current = 0;
          setError(msg.error || 'Authentication failed - please re-enter PIN');
          setView('pin');
        } else if (msg.type === 'streaming_restore' && projectId) {
          console.log(`Restoring streaming state for ${projectId}:`, {
            thinking: msg.thinking?.length || 0,
            text: msg.text?.length || 0,
            activity: msg.activity?.length || 0,
          });

          if (msg.thinking) {
            thinkingRefs.current.set(projectId, msg.thinking);
          }
          if (msg.text) {
            responseRefs.current.set(projectId, msg.text);
          }
          if (msg.activity && msg.activity.length > 0) {
            activityRefs.current.set(projectId, msg.activity);
          }

          updateProjectState(projectId, state => ({
            ...state,
            isStreaming: true,
            currentThinking: msg.thinking || '',
            currentResponse: msg.text || '',
            currentActivity: msg.activity || [],
          }));
        } else if (msg.type === 'thinking' && projectId) {
          const currentThinking = thinkingRefs.current.get(projectId) || '';
          thinkingRefs.current.set(projectId, currentThinking + (msg.text || ''));
          updateProjectState(projectId, state => ({
            ...state,
            currentThinking: thinkingRefs.current.get(projectId) || ''
          }));
        } else if (msg.type === 'text' && projectId) {
          const currentResponse = responseRefs.current.get(projectId) || '';
          responseRefs.current.set(projectId, currentResponse + (msg.text || ''));
          updateProjectState(projectId, state => ({
            ...state,
            currentResponse: responseRefs.current.get(projectId) || ''
          }));
        } else if (msg.type === 'tool_use' && msg.toolUse && projectId) {
          const activity: ToolActivity = {
            type: 'tool_use',
            tool: msg.toolUse.tool,
            input: msg.toolUse.input,
            timestamp: Date.now()
          };
          const currentActivity = activityRefs.current.get(projectId) || [];
          activityRefs.current.set(projectId, [...currentActivity, activity]);
          updateProjectState(projectId, state => ({
            ...state,
            currentActivity: activityRefs.current.get(projectId) || []
          }));
        } else if (msg.type === 'tool_result' && msg.toolResult && projectId) {
          const activity: ToolActivity = {
            type: 'tool_result',
            tool: msg.toolResult.tool,
            output: msg.toolResult.output,
            error: msg.toolResult.error,
            timestamp: Date.now()
          };
          const currentActivity = activityRefs.current.get(projectId) || [];
          activityRefs.current.set(projectId, [...currentActivity, activity]);
          updateProjectState(projectId, state => ({
            ...state,
            currentActivity: activityRefs.current.get(projectId) || []
          }));
        } else if (msg.type === 'done' && projectId) {
          const thinking = thinkingRefs.current.get(projectId) || '';
          const response = responseRefs.current.get(projectId) || '';
          const activity = activityRefs.current.get(projectId) || [];

          setStreamingProjectIds(prev => {
            const next = new Set(prev);
            next.delete(projectId);
            return next;
          });

          updateProjectState(projectId, state => {
            const task = state.currentTask;
            const startedAt = state.taskStartTime ? new Date(state.taskStartTime).toISOString() : undefined;
            const completedAt = new Date().toISOString();

            return {
              ...state,
              isStreaming: false,
              currentThinking: '',
              currentResponse: '',
              currentActivity: [],
              currentTask: '',
              taskStartTime: null,
              messages: (thinking || response || activity.length > 0)
                ? [...state.messages, {
                    role: 'assistant' as const,
                    content: response,
                    task: task || undefined,
                    thinking: thinking || undefined,
                    activity: activity.length > 0 ? activity : undefined,
                    startedAt,
                    completedAt,
                  }]
                : state.messages,
            };
          });

          thinkingRefs.current.delete(projectId);
          responseRefs.current.delete(projectId);
          activityRefs.current.delete(projectId);
        } else if (msg.type === 'error') {
          console.error('Server error:', msg.error);
          setError(msg.error || 'Unknown server error');
          if (projectId) {
            setStreamingProjectIds(prev => {
              const next = new Set(prev);
              next.delete(projectId);
              return next;
            });
            updateProjectState(projectId, state => ({
              ...state,
              isStreaming: false,
            }));
          }
        } else {
          console.log('Unknown message type:', msg.type, msg);
        }
      };

      ws.onclose = (event) => {
        console.log(`[ws] Closed: code=${event.code} reason="${event.reason || 'none'}"`);
        wsRef.current = null;

        // Don't reconnect if we closed intentionally
        if (intentionalCloseRef.current) {
          intentionalCloseRef.current = false;
          return;
        }

        if (event.code !== 1000) {
          // Unexpected close — try to auto-reconnect if we have a cached PIN
          if (cachedPinRef.current) {
            // DON'T clear streaming state — server keeps jobs running, we'll restore on reconnect
            scheduleReconnectRef.current();
          } else {
            // No cached PIN — must go to PIN screen
            setError('Connection lost. Please re-enter PIN.');
            setView('pin');
          }
        }
      };

      ws.onerror = (event) => {
        // Just log — onclose will fire after this and handle reconnection
        console.error('[ws] Connection error', event);
        reject(new Error('WebSocket connection failed'));
      };
    });
  }, [updateProjectState]);

  // Connect + authenticate in one shot (used by reconnect loop and auto-login)
  const connectAndAuth = useCallback(async () => {
    const pinToUse = cachedPinRef.current;
    if (!pinToUse) {
      console.log('[reconnect] No cached PIN, dropping to PIN screen');
      setIsReconnecting(false);
      setReconnectAttempt(0);
      setView('pin');
      return;
    }

    // Ensure shared key is ready
    if (!sharedKeyRef.current) {
      try {
        await restoreSharedKey();
      } catch (err) {
        console.error('[reconnect] Failed to restore shared key:', err);
        setIsReconnecting(false);
        setError('Encryption key restore failed - please refresh');
        setView('pin');
        return;
      }
    }

    try {
      await connectWebSocket();
    } catch {
      // onclose handler will schedule next reconnect
      return;
    }

    // Send auth
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && sharedKeyRef.current) {
      try {
        const encrypted = await encrypt(
          JSON.stringify({ type: 'auth', pin: pinToUse }),
          sharedKeyRef.current
        );
        wsRef.current.send(JSON.stringify(encrypted));
        console.log('[reconnect] Auth sent');
      } catch (err) {
        console.error('[reconnect] Failed to send auth:', err);
        // Will get closed, onclose will retry
      }
    }
  }, [connectWebSocket, restoreSharedKey]);

  // Clean up reconnect timer on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  // Auto-dismiss errors after 8 seconds (unless it's a pairing/key error that needs action)
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(''), 8000);
    return () => clearTimeout(timer);
  }, [error]);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pin || pin.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }

    // Cache the PIN for auto-reconnect
    cachedPinRef.current = pin;
    localStorage.setItem('claude-remote-pin', JSON.stringify({ pin, exp: Date.now() + 24 * 60 * 60 * 1000 }));

    setError('');
    await connectAndAuth();
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    if (!activeProjectId) {
      setShowProjectPicker(true);
      return;
    }

    if (isStreaming) return;

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected - waiting for reconnection...');
      return;
    }

    if (!sharedKeyRef.current) {
      setError('Encryption key missing - please refresh the page');
      return;
    }

    const text = input.trim();
    setInput('');
    setError('');

    const taskStartTime = Date.now();
    updateProjectState(activeProjectId, state => ({
      ...state,
      messages: [...state.messages, { role: 'user' as const, content: text }],
      isStreaming: true,
      currentThinking: '',
      currentResponse: '',
      currentActivity: [],
      currentTask: text,
      taskStartTime,
    }));

    setStreamingProjectIds(prev => new Set(prev).add(activeProjectId));

    thinkingRefs.current.set(activeProjectId, '');
    responseRefs.current.set(activeProjectId, '');
    activityRefs.current.set(activeProjectId, []);

    try {
      const encrypted = await encrypt(
        JSON.stringify({ type: 'message', text, projectId: activeProjectId }),
        sharedKeyRef.current
      );
      wsRef.current.send(JSON.stringify(encrypted));
    } catch (err) {
      console.error('[send] Failed:', err);
      setError(`Failed to send message: ${err}`);
      setStreamingProjectIds(prev => {
        const next = new Set(prev);
        next.delete(activeProjectId);
        return next;
      });
      updateProjectState(activeProjectId, state => ({
        ...state,
        isStreaming: false,
      }));
    }
  };

  const handleCancel = async () => {
    if (!activeProjectId) return;

    // Optimistic UI update
    setStreamingProjectIds(prev => {
      const next = new Set(prev);
      next.delete(activeProjectId);
      return next;
    });
    updateProjectState(activeProjectId, state => ({
      ...state,
      isStreaming: false,
    }));

    // Try WebSocket cancel
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && sharedKeyRef.current) {
      try {
        const encrypted = await encrypt(
          JSON.stringify({ type: 'cancel', projectId: activeProjectId }),
          sharedKeyRef.current
        );
        wsRef.current.send(JSON.stringify(encrypted));
      } catch (err) {
        console.error('[cancel] WS cancel failed:', err);
      }
    }

    // Also fire HTTP cancel as fallback (fire and forget)
    fetch(`/api/projects/${encodeURIComponent(activeProjectId)}/cancel`, { method: 'POST' })
      .catch(err => console.error('[cancel] HTTP cancel failed:', err));
  };

  // Handle project selection from picker
  const handleSelectProject = (project: Project) => {
    console.log('Selected project:', project.id);

    // Add to open projects if not already open
    if (!openProjects.find(p => p.id === project.id)) {
      setOpenProjects(prev => [...prev, project]);
      // Initialize empty state for new project
      if (!projectStates.has(project.id)) {
        setProjectStates(prev => {
          const next = new Map(prev);
          next.set(project.id, createEmptyProjectState());
          return next;
        });
      }
      // Fetch conversation history for this project
      fetchProjectConversation(project.id);
    }

    // Set as active
    setActiveProjectId(project.id);
    setShowProjectPicker(false);
  };

  // Handle closing a project tab
  const handleCloseProject = (projectId: string) => {
    setOpenProjects(prev => prev.filter(p => p.id !== projectId));

    // If closing the active project, switch to another or null
    if (activeProjectId === projectId) {
      const remaining = openProjects.filter(p => p.id !== projectId);
      setActiveProjectId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
    }

    // Clear project state
    setProjectStates(prev => {
      const next = new Map(prev);
      next.delete(projectId);
      return next;
    });
  };

  // Reset stuck state for current project
  const handleReset = () => {
    setError('');
    if (activeProjectId) {
      setStreamingProjectIds(prev => {
        const next = new Set(prev);
        next.delete(activeProjectId);
        return next;
      });
      updateProjectState(activeProjectId, state => ({
        ...state,
        isStreaming: false,
        currentThinking: '',
        currentResponse: '',
        currentActivity: [],
        currentTask: '',
        taskStartTime: null,
      }));
    }
    console.log('State reset by user');
  };

  if (view === 'pairing') {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">{error ? 'Error' : 'Pairing...'}</h1>
          {error ? (
            <>
              <p className="text-red-400 mb-4">{error}</p>
              <a href="/" className="px-6 py-3 bg-pink-600 rounded-lg font-semibold hover:bg-pink-700 transition-colors inline-block">
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
              className="w-full p-4 text-2xl text-center bg-gray-800 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-pink-500"
              autoFocus
            />
            <button
              type="submit"
              className="w-full p-4 bg-pink-600 rounded-lg font-semibold hover:bg-pink-700 transition-colors"
            >
              Unlock
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="h-[100dvh] flex flex-col bg-gray-900 text-white">
      {/* Project Tabs */}
      <ProjectTabs
        projects={openProjects}
        activeProjectId={activeProjectId}
        streamingProjectIds={streamingProjectIds}
        onSelectProject={setActiveProjectId}
        onCloseProject={handleCloseProject}
        onAddProject={() => setShowProjectPicker(true)}
      />

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-700 bg-gray-900 sticky top-0 z-10">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <h1 className="text-lg font-semibold truncate">
            {activeProjectId
              ? openProjects.find(p => p.id === activeProjectId)?.name || activeProjectId
              : 'Select a project'}
          </h1>
          <GitStatus projectId={activeProjectId} />
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={handleReset}
            className="p-2 text-gray-400 hover:text-white transition-colors"
            title="Reset stuck state"
            aria-label="Reset"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            type="button"
            onClick={clearHistory}
            disabled={isStreaming || !activeProjectId}
            className="p-2 text-gray-400 hover:text-white transition-colors disabled:opacity-50"
            title="Clear conversation history"
            aria-label="Clear history"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </header>

      {/* Reconnecting banner */}
      {isReconnecting && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-yellow-900/80 border-b border-yellow-700 text-yellow-200 text-sm">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>Reconnecting{reconnectAttempt > 1 ? ` (attempt ${reconnectAttempt})` : ''}...</span>
          <button
            onClick={() => {
              if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
              setIsReconnecting(false);
              setReconnectAttempt(0);
              reconnectAttemptRef.current = 0;
              cachedPinRef.current = null;
              localStorage.removeItem('claude-remote-pin');
              setView('pin');
            }}
            className="ml-2 px-2 py-0.5 text-xs bg-yellow-800 hover:bg-yellow-700 rounded transition-colors"
          >
            Use PIN
          </button>
        </div>
      )}

      {/* Project Picker Modal */}
      <ProjectPicker
        isOpen={showProjectPicker}
        onClose={() => setShowProjectPicker(false)}
        onSelect={handleSelectProject}
        openProjectIds={new Set(openProjects.map(p => p.id))}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3 sm:px-4 sm:space-y-4">
        {!activeProjectId ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="p-6 rounded-2xl bg-gray-800/50">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              <p className="text-gray-400 mb-4">Select a project to start chatting</p>
              <button
                onClick={() => setShowProjectPicker(true)}
                className="px-4 py-2 bg-pink-600 rounded-lg hover:bg-pink-700 transition-colors"
              >
                Open Project
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, i) => (
              <div key={i}>
                {msg.role === 'user' ? (
                  // User message - compact bubble on the right
                  <div className="flex justify-end">
                    <div className="max-w-[90%] sm:max-w-[85%]">
                      <div className="rounded-2xl px-4 py-3 bg-pink-600">
                        <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  // Assistant message - full width response card
                  <StreamingResponse
                    thinking={msg.thinking}
                    activity={msg.activity}
                    content={msg.content}
                    task={msg.task}
                    startedAt={msg.startedAt}
                    completedAt={msg.completedAt}
                  />
                )}
              </div>
            ))}

            {/* Streaming response */}
            {isStreaming && (
              <StreamingResponse
                thinking={currentThinking}
                activity={currentActivity}
                content={currentResponse}
                task={currentTask}
                startedAt={taskStartTime ? new Date(taskStartTime).toISOString() : undefined}
                isStreaming
              />
            )}

            {messages.length === 0 && !isStreaming && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <p className="text-gray-500">Start a conversation with Claude in this project</p>
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Tools stack - shows during streaming */}
      {isStreaming && currentActivity.length > 0 && (
        <ToolStack
          activity={currentActivity}
          isStreaming={isStreaming}
        />
      )}

      {/* Input area */}
      <div className="border-t border-gray-700 bg-gray-900 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-4">
        {error && !isReconnecting && (
          <div className="bg-red-900/80 border border-red-500 rounded-xl p-3 mb-3 flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-red-300 text-sm break-words">{error}</p>
            </div>
            <button
              onClick={() => setError('')}
              className="shrink-0 text-red-400 hover:text-red-200 transition-colors"
              aria-label="Dismiss error"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        )}
        <form onSubmit={handleSend} className="flex gap-2 items-end">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isStreaming ? "Task running..." : "New task..."}
            className="flex-1 min-h-[44px] px-4 py-3 bg-gray-800 rounded-full focus:outline-none focus:ring-2 focus:ring-pink-500 text-base"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={handleCancel}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-red-600 rounded-full font-semibold hover:bg-red-700 active:bg-red-800 transition-colors"
              aria-label="Cancel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-pink-600 rounded-full font-semibold hover:bg-pink-700 active:bg-pink-800 transition-colors disabled:opacity-50 disabled:hover:bg-pink-600"
              aria-label="Send"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
