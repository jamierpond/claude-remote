.PHONY: dev build deploy start stop restart status logs logs-client deps docker-up docker-down docker-logs docker-deploy free-ports

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
# Server on :6767, Client on :5173

# Build + restart both daemons
deploy: build
	@systemctl --user daemon-reload
	@systemctl --user restart claude-remote claude-remote-client
	@sleep 1
	@systemctl --user is-active --quiet claude-remote && echo "Server (:6767) running." || (echo "ERROR: server failed to start" && systemctl --user status claude-remote && exit 1)
	@systemctl --user is-active --quiet claude-remote-client && echo "Client (:5173) running." || (echo "ERROR: client failed to start" && systemctl --user status claude-remote-client && exit 1)
	@echo "Deployed."

start:
	@systemctl --user start claude-remote claude-remote-client
	@echo "Both daemons started."

stop:
	@systemctl --user stop claude-remote claude-remote-client
	@echo "Both daemons stopped."

restart:
	@systemctl --user restart claude-remote claude-remote-client
	@echo "Both daemons restarted."

status:
	@systemctl --user status claude-remote claude-remote-client

logs:
	@tail -n 100 -f logs/daemon-server.log

logs-client:
	@tail -n 100 -f logs/daemon-client.log

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
	@echo "Freeing ports 6767 and 5173..."
	@fuser -k 6767/tcp 2>/dev/null || true
	@fuser -k 5173/tcp 2>/dev/null || true
	@echo "Done"
