/**
 * Multi-server storage layer.
 * Manages an array of ServerConfig in localStorage, with per-server PIN/project scoping.
 */

export interface ServerConfig {
  id: string;
  name: string;
  serverUrl: string;
  deviceId: string;
  privateKey: string; // JWK JSON string
  serverPublicKey: string; // base64
  pairedAt: string;
  deviceToken?: string; // server-issued device token for HTTP auth
  tokenExpiresAt?: string; // ISO timestamp when device token expires
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

export function updateServer(
  serverId: string,
  updates: Partial<ServerConfig>,
): void {
  const servers = getServers();
  const idx = servers.findIndex((s) => s.id === serverId);
  if (idx !== -1) {
    servers[idx] = { ...servers[idx], ...updates };
    saveServers(servers);
  }
}

export function removeServer(serverId: string): void {
  const servers = getServers().filter((s) => s.id !== serverId);
  saveServers(servers);
  // Clean up per-server keys
  localStorage.removeItem(`claude-remote-pin-${serverId}`);
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

export function getServerPin(
  serverId: string,
): { pin: string; exp: number } | null {
  try {
    const stored = localStorage.getItem(`claude-remote-pin-${serverId}`);
    if (!stored) return null;
    const { pin, exp } = JSON.parse(stored);
    if (Date.now() > exp) {
      localStorage.removeItem(`claude-remote-pin-${serverId}`);
      return null;
    }
    return { pin, exp };
  } catch {
    return null;
  }
}

export function setServerPin(
  serverId: string,
  pin: string,
  ttlMs = 24 * 60 * 60 * 1000,
): void {
  localStorage.setItem(
    `claude-remote-pin-${serverId}`,
    JSON.stringify({ pin, exp: Date.now() + ttlMs }),
  );
}

export function clearServerPin(serverId: string): void {
  localStorage.removeItem(`claude-remote-pin-${serverId}`);
}

/**
 * One-time migration from legacy flat localStorage keys to multi-server format.
 * Returns the migrated ServerConfig if migration happened, null otherwise.
 */
export function migrateFromLegacy(): ServerConfig | null {
  // Already migrated?
  if (localStorage.getItem(SERVERS_KEY)) return null;
  // No legacy data?
  if (!localStorage.getItem("claude-remote-paired")) return null;

  const deviceId = localStorage.getItem("claude-remote-device-id");
  const privateKey = localStorage.getItem("claude-remote-private-key");
  const serverPublicKey = localStorage.getItem(
    "claude-remote-server-public-key",
  );
  const serverUrl =
    localStorage.getItem("claude-remote-server-url") || window.location.origin;

  if (!deviceId || !privateKey || !serverPublicKey) return null;

  const id = crypto.randomUUID();
  let name: string;
  try {
    name = new URL(serverUrl).hostname;
  } catch {
    name = "Server";
  }

  const config: ServerConfig = {
    id,
    name,
    serverUrl,
    deviceId,
    privateKey,
    serverPublicKey,
    pairedAt: new Date().toISOString(),
  };

  // Save new format
  saveServers([config]);
  setActiveServerId(id);

  // Migrate PIN
  const legacyPin = localStorage.getItem("claude-remote-pin");
  if (legacyPin) {
    localStorage.setItem(`claude-remote-pin-${id}`, legacyPin);
  }

  // Migrate project tabs
  const legacyProjects = localStorage.getItem("claude-remote-open-projects");
  if (legacyProjects) {
    localStorage.setItem(`claude-remote-projects-${id}`, legacyProjects);
  }
  const legacyActive = localStorage.getItem("claude-remote-active-project");
  if (legacyActive) {
    localStorage.setItem(`claude-remote-active-project-${id}`, legacyActive);
  }

  // Migrate draft
  const legacyDraft = localStorage.getItem("claude-remote-draft");
  if (legacyDraft) {
    localStorage.setItem(`claude-remote-draft-${id}`, legacyDraft);
  }

  // Clean up legacy keys
  localStorage.removeItem("claude-remote-paired");
  localStorage.removeItem("claude-remote-device-id");
  localStorage.removeItem("claude-remote-private-key");
  localStorage.removeItem("claude-remote-server-public-key");
  localStorage.removeItem("claude-remote-shared-secret");
  localStorage.removeItem("claude-remote-server-url");
  localStorage.removeItem("claude-remote-pin");
  localStorage.removeItem("claude-remote-open-projects");
  localStorage.removeItem("claude-remote-active-project");
  localStorage.removeItem("claude-remote-draft");

  return config;
}
