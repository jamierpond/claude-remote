import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import argon2 from 'argon2';

const CONFIG_DIR = join(homedir(), '.config', 'claude-remote');

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

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  timestamp: string;
}

export interface Conversation {
  messages: Message[];
  claudeSessionId: string | null;
  updatedAt: string;
}

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadDevice(): Device | null {
  try {
    const path = join(CONFIG_DIR, 'device.json');
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function saveDevice(device: Device): void {
  ensureConfigDir();
  writeFileSync(join(CONFIG_DIR, 'device.json'), JSON.stringify(device, null, 2));
}

export function loadServerState(): ServerState | null {
  try {
    const path = join(CONFIG_DIR, 'server.json');
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function saveServerState(state: ServerState): void {
  ensureConfigDir();
  writeFileSync(join(CONFIG_DIR, 'server.json'), JSON.stringify(state, null, 2));
}

export function loadConfig(): Config {
  try {
    const path = join(CONFIG_DIR, 'config.json');
    if (!existsSync(path)) return { pinHash: null };
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { pinHash: null };
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  writeFileSync(join(CONFIG_DIR, 'config.json'), JSON.stringify(config, null, 2));
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
    const path = join(CONFIG_DIR, 'conversation.json');
    if (!existsSync(path)) return { messages: [], claudeSessionId: null, updatedAt: new Date().toISOString() };
    const data = JSON.parse(readFileSync(path, 'utf8'));
    // Ensure claudeSessionId exists for backwards compatibility
    if (!('claudeSessionId' in data)) {
      data.claudeSessionId = null;
    }
    return data;
  } catch (err) {
    console.error('[store] Failed to load conversation:', err);
    return { messages: [], claudeSessionId: null, updatedAt: new Date().toISOString() };
  }
}

export function saveClaudeSessionId(sessionId: string): void {
  const conversation = loadConversation();
  conversation.claudeSessionId = sessionId;
  saveConversation(conversation);
  console.log('[store] Claude session ID saved:', sessionId);
}

export function getClaudeSessionId(): string | null {
  const conversation = loadConversation();
  return conversation.claudeSessionId;
}

export function saveConversation(conversation: Conversation): void {
  ensureConfigDir();
  conversation.updatedAt = new Date().toISOString();
  writeFileSync(join(CONFIG_DIR, 'conversation.json'), JSON.stringify(conversation, null, 2));
  console.log('[store] Conversation saved, messages:', conversation.messages.length);
}

export function addMessage(message: Message): Conversation {
  const conversation = loadConversation();
  conversation.messages.push(message);
  saveConversation(conversation);
  return conversation;
}

export function clearConversation(): void {
  ensureConfigDir();
  const empty: Conversation = { messages: [], claudeSessionId: null, updatedAt: new Date().toISOString() };
  writeFileSync(join(CONFIG_DIR, 'conversation.json'), JSON.stringify(empty, null, 2));
  console.log('[store] Conversation and session cleared');
}
