.PHONY: dev build deploy start stop restart status logs deps docker-up docker-down docker-logs docker-deploy free-ports

# Install dependencies
deps:
	pnpm install

# Run Vite client dev server (server runs as daemon)
dev:
	pnpm vite

# Build for production
build:
	pnpm build

# === Systemd (native) ===

# Build + restart systemd daemon
deploy: build
	@systemctl --user restart claude-remote
	@sleep 1
	@systemctl --user is-active --quiet claude-remote && echo "Deployed and running." || (echo "ERROR: daemon failed to start" && systemctl --user status claude-remote && exit 1)

start:
	@systemctl --user start claude-remote
	@echo "Daemon started."

stop:
	@systemctl --user stop claude-remote
	@echo "Daemon stopped."

restart:
	@systemctl --user restart claude-remote
	@echo "Daemon restarted."

status:
	@systemctl --user status claude-remote

logs:
	@tail -n 100 -f logs/daemon-server.log

# === Docker ===

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f

docker-deploy:
	docker compose up -d --build
	@echo "Deployed via Docker."

# === Utilities ===

free-ports:
	@echo "Freeing port 6767..."
	@fuser -k 6767/tcp 2>/dev/null || true
	@echo "Done"
