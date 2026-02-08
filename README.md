# Claude Remote

A secure mobile-friendly web interface for remotely accessing Claude Code from your phone or any device.

## Features

- **End-to-end encryption** - ECDH key exchange + AES-GCM encryption
- **QR code pairing** - Easy device pairing with QR codes
- **PIN protection** - Secure access with a PIN
- **Mobile-first UI** - Optimized for phones with touch-friendly controls
- **Real-time streaming** - See Claude's responses as they're generated
- **Rich activity panel** - See exactly what Claude is doing:
  - Tool calls with icons (Read, Write, Edit, Bash, etc.)
  - **Live diff view** for file edits (red for removed, green for added)
  - Syntax-highlighted bash commands
  - Collapsible tool results
  - Live streaming indicator

## Activity Panel

The chat interface includes a collapsible Activity panel that shows Claude's tool usage in real-time:

```
┌─────────────────────────────────────────────────┐
│ ▶ Activity                    📄 Read  🔧 Edit  │
├─────────────────────────────────────────────────┤
│ ▶ 📄 Read                     Chat.tsx          │
│ ▶ 🔧 Edit                     Chat.tsx          │
│   ├─ /client/src/pages/Chat.tsx                 │
│   ├─ - Remove:                                  │
│   │   ┌──────────────────────────────────────┐  │
│   │   │ const [foo, setFoo] = useState('');  │  │
│   │   └──────────────────────────────────────┘  │
│   └─ + Add:                                     │
│       ┌──────────────────────────────────────┐  │
│       │ const [bar, setBar] = useState('');  │  │
│       └──────────────────────────────────────┘  │
│ ▶ 💻 Bash                     pnpm run dev...   │
└─────────────────────────────────────────────────┘
```

### Tool Icons

| Icon | Tool            | Description                           |
| ---- | --------------- | ------------------------------------- |
| 📄   | Read            | Reading files                         |
| ✏️   | Write           | Creating new files                    |
| 🔧   | Edit            | Modifying existing files (shows diff) |
| 💻   | Bash            | Running shell commands                |
| 🔍   | Glob            | Finding files by pattern              |
| 🔎   | Grep            | Searching file contents               |
| 🤖   | Task            | Spawning sub-agents                   |
| 🌐   | WebFetch        | Fetching web content                  |
| 📝   | TodoWrite       | Managing task lists                   |
| ❓   | AskUserQuestion | Asking for input                      |

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm
- Claude CLI installed and authenticated

### Installation

```bash
pnpm install
```

### Development

```bash
pnpm run dev
```

This starts both the server (port 6767) and Vite dev server (port 5173).

### Environment Variables

Create a `.env.local` file:

```bash
PIN=1234              # Access PIN
CLIENT_URL=https://your-domain.com
SERVER_URL=https://your-server.com
```

## Architecture

- **Frontend**: React + TypeScript + Tailwind CSS (Vite)
- **Backend**: Node.js WebSocket server
- **Security**: ECDH key exchange, AES-256-GCM encryption
- **Claude Integration**: Spawns Claude CLI with `--output-format stream-json`

## Mobile Optimizations

- Dynamic viewport height (`100dvh`) for proper mobile browser support
- Safe area insets for notched devices
- 44px minimum touch targets
- Rounded pill-style input and buttons
- Collapsible sections to maximize screen space

## License

MIT
