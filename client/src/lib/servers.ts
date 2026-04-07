/**
 * Multi-server storage layer.
 * Manages an array of ServerConfig in localStorage.
 */

export interface ServerConfig {
  id: string;
  name: string;
  serverUrl: string;
  addedAt: string;
}

const SERVERS_KEY = "claude-remote-servers";
const ACTIVE_KEY = "claude-remote-active-server-id";

export function getServers(): ServerConfig[] {
  try {
    const raw = localStorage.getItem(SERVERS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveServers(servers: ServerConfig[]): void {
  localStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
}

export function addServer(config: ServerConfig): void {
  const servers = getServers();
  servers.push(config);
  saveServers(servers);
}

export function removeServer(serverId: string): void {
  const servers = getServers().filter((s) => s.id !== serverId);
  saveServers(servers);
  // Clean up per-server keys
  localStorage.removeItem(`claude-remote-password-${serverId}`);
  localStorage.removeItem(`claude-remote-projects-${serverId}`);
  localStorage.removeItem(`claude-remote-active-project-${serverId}`);
  localStorage.removeItem(`claude-remote-draft-${serverId}`);
  // If this was active, clear active
  if (getActiveServerId() === serverId) {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function getActiveServerId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveServerId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function getActiveServer(): ServerConfig | null {
  const id = getActiveServerId();
  if (!id) return null;
  return getServers().find((s) => s.id === id) || null;
}

export function getServerPassword(
  serverId: string,
): { password: string; exp: number } | null {
  try {
    const stored = localStorage.getItem(`claude-remote-password-${serverId}`);
    if (!stored) return null;
    const { password, exp } = JSON.parse(stored);
    if (Date.now() > exp) {
      localStorage.removeItem(`claude-remote-password-${serverId}`);
      return null;
    }
    return { password, exp };
  } catch {
    return null;
  }
}

export function setServerPassword(
  serverId: string,
  password: string,
  ttlMs = 24 * 60 * 60 * 1000,
): void {
  localStorage.setItem(
    `claude-remote-password-${serverId}`,
    JSON.stringify({ password, exp: Date.now() + ttlMs }),
  );
}

export function clearServerPassword(serverId: string): void {
  localStorage.removeItem(`claude-remote-password-${serverId}`);
}
