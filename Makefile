.PHONY: dev build deploy start stop restart status logs logs-client deps docker-up docker-down docker-logs docker-deploy free-ports

SERVICE := claude-remote.service
LOGFILE := logs/daemon-server.log
PIDFILE := logs/server.pid
UNAME := $(shell uname)

# Install dependencies
deps:
	pnpm install

# Run Vite client dev server (server runs as daemon)
dev:
	pnpm vite

# Build for production
build:
	pnpm build

# === Production ===
# Server on :6767 (serves built client static files)

ifeq ($(UNAME),Darwin)
# --- macOS: PID-file based process management ---

deploy: build
	@mkdir -p logs
	@# Stop existing server if running
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "Stopping existing server (PID $$(cat $(PIDFILE)))..."; \
		kill $$(cat $(PIDFILE)) 2>/dev/null; \
		sleep 1; \
	fi
	@# Also kill anything on port 6767 in case of stale processes
	@lsof -ti :6767 | xargs kill 2>/dev/null || true
	@sleep 1
	@echo "Starting server..."
	@NODE_ENV=production nohup pnpm tsx server.ts >> $(LOGFILE) 2>&1 & echo $$! > $(PIDFILE)
	@sleep 2
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "Server (:6767) running (PID $$(cat $(PIDFILE)))."; \
	else \
		echo "ERROR: server failed to start. Check logs:"; \
		tail -20 $(LOGFILE); \
		exit 1; \
	fi
	@echo "Deployed."

start:
	@mkdir -p logs
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "Server already running (PID $$(cat $(PIDFILE)))."; \
	else \
		NODE_ENV=production nohup pnpm tsx server.ts >> $(LOGFILE) 2>&1 & echo $$! > $(PIDFILE); \
		echo "Server started (PID $$(cat $(PIDFILE)))."; \
	fi

stop:
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		kill $$(cat $(PIDFILE)); \
		rm -f $(PIDFILE); \
		echo "Server stopped."; \
	else \
		echo "Server not running."; \
		rm -f $(PIDFILE); \
	fi

restart: stop start

status:
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "Server running (PID $$(cat $(PIDFILE)))."; \
	else \
		echo "Server not running."; \
	fi

else
# --- Linux: systemd ---

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

endif

# === Common targets ===

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
