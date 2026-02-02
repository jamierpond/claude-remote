# Claude Remote Implementation Plan

## Overview
Mobile chat interface for local Claude CLI with E2E encryption. Personal use - access Claude from phone via Cloudflare tunnel.

## Architecture

### Tech Stack
- **Next.js 16** with App Router
- **Custom server** for WebSocket support
- **Tailwind CSS** for styling
- **argon2** for PIN hashing
- **qrcode** for QR generation
- **ws** for WebSocket server

### Directory Structure
```
claude-remote/
├── server.ts              # Custom server with WebSocket
├── src/
│   ├── lib/
│   │   ├── crypto.ts      # ECDH + AES-GCM encryption
│   │   ├── store.ts       # Config/device persistence
│   │   └── claude.ts      # Claude CLI spawning
│   └── app/
│       ├── page.tsx       # QR code / paired status
│       ├── pair/[token]/
│       │   └── route.ts   # Pairing API endpoints
│       └── chat/
│           └── page.tsx   # Chat interface
```

## Files to Create

### 1. `src/lib/crypto.ts`
- `generateKeyPair()` - ECDH P-256
- `deriveSharedSecret(privateKey, peerPublicKey)` - ECDH derive
- `encrypt(plaintext, secret)` - AES-256-GCM, returns {iv, ct, tag}
- `decrypt(encrypted, secret)` - AES-256-GCM
- Key serialization helpers (base64 <-> Buffer)

### 2. `src/lib/store.ts`
- Config dir: `~/.config/claude-remote/`
- `loadDevice()` / `saveDevice()` - device.json
- `loadConfig()` / `saveConfig()` - config.json (PIN hash)
- `hashPin(pin)` / `verifyPin(pin, hash)` - argon2

### 3. `src/lib/claude.ts`
- `spawnClaude(message, onEvent, signal)` - spawn CLI with streaming
- Parse JSON stream events: content_block_start, content_block_delta
- Map to simplified events: {type: 'thinking'|'text', text, done}
- Handle cancel via AbortSignal

### 4. `server.ts`
- Custom Next.js server on port 3001
- WebSocket server on `/ws`:
  - Verify device is paired
  - Handle encrypted messages: auth, message, cancel
  - Stream encrypted responses back
- Session management: authenticated state per connection

### 5. `src/app/page.tsx`
- Server component showing QR code when no device paired
- Shows "Paired" status when device exists
- QR contains URL: `{baseUrl}/pair/{token}`

### 6. `src/app/pair/[token]/route.ts`
- `GET` - Return server public key
- `POST` - Receive client public key, complete pairing

### 7. `src/app/chat/page.tsx`
Client-side chat interface:
- **Crypto**: Web Crypto API for ECDH + AES-GCM
- **Views**: PIN entry → Chat
- **Chat UI**: Thinking bubbles, response bubbles, input
- **WebSocket**: Connect, encrypt/decrypt messages
- **Storage**: localStorage for deviceId, privateKey, sharedSecret

## Pairing Flow

1. Server generates ECDH keypair + random token on startup (if no device)
2. Desktop shows QR code with URL: `{baseUrl}/pair/{token}`
3. Phone scans, opens URL, generates own ECDH keypair
4. Phone POSTs its public key to `/pair/{token}`
5. Server derives shared secret, stores device, returns its public key
6. Phone derives shared secret, stores locally
7. Server now shows "paired" status, phone redirects to chat

## Message Flow

1. Phone connects WebSocket, sends encrypted `{type: 'auth', pin}`
2. Server decrypts, verifies PIN hash, sends encrypted `{type: 'auth_ok'}`
3. Phone sends encrypted `{type: 'message', text}`
4. Server spawns `claude --print --output-format stream-json`
5. Server streams encrypted `{type: 'thinking'|'text', text, done}` events
6. Phone decrypts and displays in real-time

## Verification

1. `npm run dev` - starts server on port 3001
2. Open localhost:3001 - see QR code
3. Scan QR with phone, complete pairing
4. Set PIN, verify PIN entry works
5. Send message, verify streaming response
6. Test cancel functionality
