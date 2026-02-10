.PHONY: dev build deploy start stop restart status logs logs-client deps docker-up docker-down docker-logs docker-deploy free-ports

SERVICE := claude-remote.service
LOGFILE := logs/daemon-server.log

# Install dependencies
deps:
	pnpm install

# Run Vite client dev server (server runs as daemon)
dev:
	pnpm vite

# Build for production
build:
	pnpm build

# === Production (systemd) ===
# Server on :6767 (serves built client static files)

# Build + restart server via systemd
deploy: build
	@mkdir -p logs
	systemctl --user restart $(SERVICE)
	@sleep 2
	@if systemctl --user is-active --quiet $(SERVICE); then \
		echo "Server (:6767) running via systemd."; \
	else \
		echo "ERROR: server failed to start. Check logs:"; \
		tail -20 $(LOGFILE); \
		exit 1; \
	fi
	@echo "Deployed."

start:
	systemctl --user start $(SERVICE)
	@echo "Server started."

stop:
	systemctl --user stop $(SERVICE)
	@echo "Server stopped."

restart:
	systemctl --user restart $(SERVICE)
	@echo "Server restarted."

status:
	@systemctl --user status $(SERVICE) --no-pager

logs:
	@tail -n 100 -f $(LOGFILE)

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
	@lsof -ti :6767 | xargs kill -9 2>/dev/null || true
	@lsof -ti :5173 | xargs kill -9 2>/dev/null || true
	@echo "Done"
