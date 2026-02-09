# Distribution & Packaging Ideas

## Client (App Store)

### PWA (Current)
Already working with push notifications, home screen install, standalone mode on iOS. Covers 90% of use cases. Limitation: Apple's restrictions on PWA capabilities (no background fetch, limited push reliability).

### Capacitor (Recommended next step)
Wrap the existing Vite React app in a native shell. Minimal code changes — web app runs inside WKWebView.

Benefits over PWA:
- Reliable native push via APNs
- Keychain storage for encryption keys/PIN
- Face ID / Touch ID for biometric auth
- Background WebSocket keep-alive
- App Store presence, TestFlight updates

Costs:
- Apple Developer account ($99/year)
- App Store review (add biometric auth + Keychain to avoid "thin wrapper" rejection)
- Xcode project + signing certificate maintenance

```
├── client/src/          # existing React app (unchanged)
├── ios/                 # Capacitor-generated Xcode project
├── capacitor.config.ts  # points to dist/client/
└── src/plugins/         # native bridge for Keychain, biometrics
```

## Server

### Option 1: npm package
```bash
npx claude-remote
```
- Publish to npm, one-command setup
- Requires Node 22+ and Claude CLI on the machine
- `argon2` native dep needs build tools — consider swapping for pure-JS alternative (`@noble/hashes` with scrypt)
- Bundle the built client into the package

### Option 2: Docker image
```bash
docker run -p 6767:6767 -v ~/.config/claude-remote:/data jamierpond/claude-remote
```
- Publish to Docker Hub / GitHub Container Registry
- Docker Compose file with Cloudflare tunnel sidecar for turnkey setup
- Challenge: Claude CLI needs host filesystem access for coding tasks

### Option 3: Single binary
- Compile with `bun build --compile` or similar
- No Node/npm required — download and run
- Need to swap argon2 for pure-JS to avoid native deps

### Option 4: Homebrew tap
```bash
brew install jamierpond/tap/claude-remote
```
- Great for macOS users (primary target audience)
- Wrap npm package or compiled binary
- Include launchd plist for running as a service

## Recommended Path

1. **npm package + Docker** covers the most ground
2. Replace `argon2` with pure-JS alternative to eliminate native compilation
3. Bundle built client into the npm package
4. Add `claude-remote init` command for guided Cloudflare tunnel setup
5. Detect if `claude` is on PATH and guide user through setup on first run

## Key Friction Points

- Cloudflare tunnel setup (could automate/guide)
- Claude CLI must be installed on the host
- argon2 native compilation (swap for pure-JS)
- HTTPS required for Web Push / crypto APIs (tunnel handles this)
