# Claude Remote - Flutter Client

Native mobile client for Claude Remote with E2E encryption.

## Features

- **QR Code Pairing** — Scan QR from server to establish secure connection
- **E2E Encryption** — ECDH key exchange + AES-256-GCM (same as web client)
- **Biometric Auth** — Face ID / Fingerprint instead of PIN (optional)
- **Background Execution** — Tasks continue running when app is backgrounded
- **Push Notifications** — Get notified when long tasks complete
- **State Persistence** — Remembers scroll position, input draft, active project
- **Task-Centric UI** — Not a chat interface, shows work as it happens

## Setup

1. Install Flutter SDK (3.16+)
2. Run in this directory:

```bash
flutter pub get
flutter run
```

## Project Structure

```
lib/
├── main.dart              # Entry point
├── app.dart               # Router + theme
├── core/
│   ├── crypto.dart        # ECDH + AES-GCM encryption
│   ├── websocket.dart     # WebSocket connection manager
│   └── storage.dart       # Secure + regular storage
├── models/
│   ├── task.dart          # Task state model
│   └── tool_activity.dart # Tool use/result model
├── providers/
│   ├── auth_provider.dart # Pairing + authentication
│   └── task_provider.dart # Task execution state
└── ui/
    ├── screens/
    │   ├── pair_screen.dart   # QR scanning + pairing
    │   ├── pin_screen.dart    # PIN entry + biometrics
    │   └── task_screen.dart   # Main task execution view
    └── widgets/
        ├── task_header.dart   # Status bar + cancel
        ├── thinking_panel.dart
        ├── activity_feed.dart # Tool use timeline
        └── output_chunks.dart # Structured response display
```

## Crypto Compatibility

The Flutter client uses the `cryptography` package which supports X25519 for ECDH.
The Node.js server currently uses P-256 (secp256r1).

**TODO:** Either:
1. Update server to support X25519, or
2. Use `pointycastle` package for P-256 support in Flutter

## TODO

- [ ] Implement HTTP client for pairing API calls
- [ ] Add P-256 ECDH support (or update server to X25519)
- [ ] Push notification integration
- [ ] Background isolate for WebSocket
- [ ] Project switching support
- [ ] History view
- [ ] Rich tool output rendering (diffs, code blocks)
