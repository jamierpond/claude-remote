# Plan: Simplify Auth to Password + Cookie

## Context

Replace the current E2E encryption + ECDH pairing + argon2 PIN system with simple password + HTTP cookie auth. Assumes users run on a VPN (Tailscale) so transport security is handled.

## What Gets Removed

- `src/lib/crypto.ts` — entire file (ECDH, AES-256-GCM encrypt/decrypt)
- `client/src/lib/crypto-client.ts` — entire file (client-side ECDH, encrypt/decrypt)
- `argon2` dependency
- `qrcode-terminal` dependency
- Device management (devices.json, device tokens, token expiry)
- Server keypair + pairing token (server.json / ServerState)
- QR code generation on startup
- Pairing flow (`/pair/:token` GET/POST endpoints)
- `/api/new-pair-token` endpoint
- `/api/unpair` endpoint
- Per-message encryption/decryption on WebSocket
- `findDeviceByDecryption()` — device identification by trial decryption
- Client: pairing UI in ServerList.tsx
- Client: `crypto-client.ts` imports everywhere
- Client: PIN numeric-only restriction (becomes password)
- Client: `computeAuthHash()` in api.ts
- Client: localStorage keypair/deviceToken storage
- Client: `migrateFromLegacy()` in servers.ts

## What Gets Added

### Server-side

1. **`POST /api/login`** — accepts `{ password: string }`, validates against `CLAUDE_REMOTE_PIN` env var using constant-time comparison, sets HTTP-only cookie `session=<random-token>`, returns `{ ok: true }`.

2. **Session store** — in-memory `Map<string, { createdAt: number }>`. Sessions expire after 7 days. Lost on server restart (users just re-enter password — acceptable for VPN use).

3. **Cookie validation** — replace `checkApiAuth()` with `checkSession()` that reads the `session` cookie. All `/api/*` routes (except `/api/status` unauthenticated subset and `/api/login`) require valid session cookie.

4. **WebSocket auth** — on upgrade, check session cookie from the HTTP headers. If valid, connection is authenticated immediately. No more encrypted auth handshake. If no cookie, client sends `{ type: "auth", password }` as first message (plain JSON), server validates and sets a flag. This handles the case where the WS connects before the cookie is set.

5. **WebSocket messages** — plain JSON, no encrypt/decrypt wrapper. `sendEncrypted()` becomes just `sendJson()`.

6. **Broadcast** — `broadcastToOthers()` and event broadcasting send plain JSON instead of per-device encrypted payloads.

7. **Connected clients** — keyed by a generated connection ID instead of device ID. The `activeJobs` map uses connection ID.

8. **Startup** — no keypair generation, no QR code, no pairing URL. Just print the server URL.

### Client-side

1. **`servers.ts`** — `ServerConfig` simplified: just `{ id, name, serverUrl, addedAt }`. No privateKey, serverPublicKey, deviceId, deviceToken. Remove `migrateFromLegacy()`.

2. **`api.ts`** — remove `computeAuthHash()`. Use `credentials: 'include'` on fetch to send cookies. No Authorization header needed.

3. **`ServerList.tsx`** — "Add Server" just asks for server URL (no pairing). Checks `/api/status` to confirm reachable, saves config, navigates to chat.

4. **`Chat.tsx`** — 
   - "PIN" view becomes "Password" view (allows alphanumeric input)
   - On submit: `POST /api/login` with password, cookie set automatically
   - WebSocket connects after login, no auth message needed (cookie on upgrade)
   - All message send/receive is plain JSON — remove encrypt/decrypt calls
   - Remove `sharedKeyRef`, `restoreSharedKey()`, all crypto imports
   - Password cached in localStorage for convenience (same 24h TTL pattern)

5. **`App.tsx`** — remove `migrateFromLegacy()` call.

### store.ts changes

- Remove: `Device` interface, `ServerState` interface, `loadDevices()`, `saveDevices()`, `addDevice()`, `removeDevice()`, `getDeviceById()`, `loadDevice()`, `saveDevice()`, `loadServerState()`, `saveServerState()`, `hashPin()`, `verifyPin()`, `loadConfig()`, `saveConfig()`
- Remove: `import argon2`
- Keep: everything conversation/project/worktree related (unchanged)

### package.json changes

- Remove: `argon2`, `qrcode-terminal`
- Remove from `pnpm.onlyBuiltDependencies`: `argon2`

## What Stays

- Rate limiting (applied to `/api/login` attempts)
- CORS restriction
- Path traversal protection
- Push notifications (unchanged)
- Conversation/project/worktree storage (unchanged)
- Claude CLI spawning (unchanged)
- All project management APIs (unchanged, just auth method changes)
- `CLAUDE_REMOTE_PIN` env var (same name for backwards compat)

## File Change Summary

| File | Action |
|------|--------|
| `src/lib/crypto.ts` | DELETE |
| `client/src/lib/crypto-client.ts` | DELETE |
| `server.ts` | HEAVY EDIT — remove crypto, add cookie auth |
| `src/lib/store.ts` | EDIT — remove device/pin/serverstate, keep conversations |
| `client/src/lib/api.ts` | EDIT — remove auth hash, add credentials: include |
| `client/src/lib/servers.ts` | EDIT — simplify ServerConfig, remove migration |
| `client/src/pages/ServerList.tsx` | EDIT — remove pairing, add simple URL entry |
| `client/src/pages/Chat.tsx` | HEAVY EDIT — remove crypto, plain JSON WS |
| `client/src/App.tsx` | EDIT — remove migration |
| `package.json` | EDIT — remove argon2, qrcode-terminal |
| `CLAUDE.md` | EDIT — update security model docs |

## Order of Operations

1. Remove dependencies (`argon2`, `qrcode-terminal`) from package.json
2. Delete `src/lib/crypto.ts` and `client/src/lib/crypto-client.ts`
3. Gut `store.ts` — remove device/auth functions, keep conversation/project
4. Rewrite server.ts auth layer (cookie sessions, plain WS)
5. Simplify client: api.ts, servers.ts, App.tsx
6. Rewrite ServerList.tsx (simple add-server flow)
7. Rewrite Chat.tsx auth + WS (plain JSON, password login)
8. Update CLAUDE.md
9. `pnpm install` + `pnpm build` to verify
