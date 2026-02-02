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
