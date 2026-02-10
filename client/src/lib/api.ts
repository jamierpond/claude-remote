/**
 * Authenticated fetch wrapper for API calls.
 * Supports multi-server: pass serverId + serverUrl for cross-origin requests.
 * Auth header is SHA-256(pin + deviceToken) instead of raw PIN.
 */

import { getServers } from "./servers";

export interface ApiOptions extends RequestInit {
  serverId?: string;
  serverUrl?: string;
}

async function computeAuthHash(
  pin: string,
  deviceToken: string,
): Promise<string> {
  const data = new TextEncoder().encode(pin + deviceToken);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: ApiOptions,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const serverId = init?.serverId;

  // Build auth header from SHA-256(pin + deviceToken)
  try {
    const pinKey = serverId
      ? `claude-remote-pin-${serverId}`
      : "claude-remote-pin";
    const stored = localStorage.getItem(pinKey);
    if (stored) {
      const { pin, exp } = JSON.parse(stored);
      if (Date.now() <= exp && pin) {
        // Find the device token for this server
        const server = serverId
          ? getServers().find((s) => s.id === serverId)
          : null;
        if (server?.deviceToken) {
          const authHash = await computeAuthHash(pin, server.deviceToken);
          headers.set("Authorization", `Bearer ${authHash}`);
        }
      }
    }
  } catch {
    // proceed without auth
  }

  // Prefix with serverUrl for cross-origin requests
  let url = input;
  if (init?.serverUrl && typeof input === "string" && input.startsWith("/")) {
    url = `${init.serverUrl}${input}`;
  }

  // Strip custom keys before passing to fetch
  const { serverId: _s, serverUrl: _u, ...fetchInit } = init || {};
  return fetch(url, { ...fetchInit, headers });
}
