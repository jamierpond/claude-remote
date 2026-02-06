# Plan: Dockerize claude-remote

## Files to create
1. **`Dockerfile`** — multi-stage build (deps + build + runtime)
2. **`docker-compose.yml`** — orchestration, volumes, env
3. **`.dockerignore`** — keep image lean
4. **Update `Makefile`** — add `docker-up`, `docker-down`, `docker-logs` targets

## Dockerfile approach
- **Base**: `node:20-slim`
- **Install**: `pnpm`, system deps for `argon2` (`python3`, `make`, `g++`), `git`, `curl`
- **Install Claude CLI**: `npm install -g @anthropic-ai/claude-code`
- **Build**: `pnpm install` then `pnpm build` (vite builds client)
- **Runtime**: `pnpm start` (runs `tsx server.ts`)
- No multi-stage needed since `tsx` runs TS directly (not compiled)

## docker-compose.yml volumes

| Host path | Container path | Purpose |
|---|---|---|
| `~/.config/claude-remote` | `/home/node/.config/claude-remote` | Pairing state, device keys, conversations |
| `~/projects` | `/home/node/projects` | Projects Claude can access (sandboxed!) |
| `~/.claude` | `/home/node/.claude` | Claude CLI auth credentials + session state |
| `./logs` | `/app/logs` | Server logs |

Key insight: `store.ts` uses `homedir()` for paths, so inside the container the home dir must have the right structure. We'll use `node` user (comes with `node:20-slim`), set `HOME=/home/node`.

## Environment variables
Passed via `env_file: .env.local` in compose:
- `CLAUDE_REMOTE_PIN`
- `CLIENT_URL`
- `SERVER_URL`
- `NODE_ENV=production`

## .dockerignore
```
node_modules
dist
logs
.git
flutter_client
.env*
*.md
```

## Makefile additions
- `docker-up`: `docker compose up -d --build`
- `docker-down`: `docker compose down`
- `docker-logs`: `docker compose logs -f`
- `docker-deploy`: `docker compose up -d --build` (replaces `make deploy` for Docker users)

## Security benefit
The container only sees what's in the volume mounts. Claude CLI can only access `~/projects` — not `~/.ssh`, not `/etc`, not anything else on the host.
