/**
 * Authenticated fetch wrapper for API calls.
 * Supports multi-server: pass serverId + serverUrl for cross-origin requests.
 */

export interface ApiOptions extends RequestInit {
  serverId?: string;
  serverUrl?: string;
}

export function apiFetch(input: RequestInfo | URL, init?: ApiOptions): Promise<Response> {
  const headers = new Headers(init?.headers);
  const serverId = init?.serverId;

  // Read PIN for this specific server (or legacy key)
  try {
    const pinKey = serverId ? `claude-remote-pin-${serverId}` : 'claude-remote-pin';
    const stored = localStorage.getItem(pinKey);
    if (stored) {
      const { pin, exp } = JSON.parse(stored);
      if (Date.now() <= exp && pin) {
        headers.set('Authorization', `Bearer ${pin}`);
      }
    }
  } catch {
    // proceed without auth
  }

  // Prefix with serverUrl for cross-origin requests
  let url = input;
  if (init?.serverUrl && typeof input === 'string' && input.startsWith('/')) {
    url = `${init.serverUrl}${input}`;
  }

  // Strip custom keys before passing to fetch
  const { serverId: _s, serverUrl: _u, ...fetchInit } = init || {};
  return fetch(url, { ...fetchInit, headers });
}
