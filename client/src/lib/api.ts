/**
 * Authenticated fetch wrapper for API calls.
 * Uses session cookies for auth (set by POST /api/login).
 */

export interface ApiOptions extends RequestInit {
  serverId?: string;
  serverUrl?: string;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init?: ApiOptions,
): Promise<Response> {
  const headers = new Headers(init?.headers);

  // Prefix with serverUrl for cross-origin requests
  let url = input;
  if (init?.serverUrl && typeof input === "string" && input.startsWith("/")) {
    url = `${init.serverUrl}${input}`;
  }

  // Strip custom keys before passing to fetch
  const { serverId: _s, serverUrl: _u, ...fetchInit } = init || {};
  return fetch(url, { ...fetchInit, headers, credentials: "include" });
}
