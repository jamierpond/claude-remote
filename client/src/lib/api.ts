/**
 * Authenticated fetch wrapper for API calls.
 * Reads the PIN from localStorage and adds Authorization: Bearer <pin> header.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);

  // Read PIN from localStorage (same format as Chat.tsx uses)
  try {
    const stored = localStorage.getItem('claude-remote-pin');
    if (stored) {
      const { pin, exp } = JSON.parse(stored);
      if (Date.now() <= exp && pin) {
        headers.set('Authorization', `Bearer ${pin}`);
      }
    }
  } catch {
    // If localStorage read fails, proceed without auth
  }

  return fetch(input, { ...init, headers });
}
