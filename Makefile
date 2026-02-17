.PHONY: dev build deploy start stop restart status logs logs-client deps docker-up docker-down docker-logs docker-deploy free-ports _kill_server _wait_port_free

SERVICE := claude-remote.service
LOGFILE := logs/daemon-server.log
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

deploy: build _kill_server _wait_port_free
	@mkdir -p logs
	@echo "Starting server..."
	@NODE_ENV=production nohup pnpm tsx server.ts >> $(LOGFILE) 2>&1 &
	@sleep 2
	@if lsof -ti :6767 > /dev/null 2>&1; then \
		echo "Server (:6767) running (PID $$(lsof -ti :6767 | head -1))."; \
	else \
		echo "ERROR: server failed to start. Check logs:"; \
		tail -20 $(LOGFILE); \
		exit 1; \
	fi
	@echo "Deployed."

start: _wait_port_free
	@mkdir -p logs
	@NODE_ENV=production nohup pnpm tsx server.ts >> $(LOGFILE) 2>&1 &
	@sleep 2
	@echo "Server started."

stop: _kill_server

restart: _kill_server _wait_port_free start

status:
	@if lsof -ti :6767 > /dev/null 2>&1; then \
		echo "Server running (PID $$(lsof -ti :6767 | head -1))."; \
	else \
		echo "Server not running."; \
	fi

_kill_server:
	@if lsof -ti :6767 > /dev/null 2>&1; then \
		echo "Stopping server on :6767..."; \
		lsof -ti :6767 | xargs kill -9 2>/dev/null || true; \
	fi

_wait_port_free:
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
		if ! lsof -ti :6767 > /dev/null 2>&1; then break; fi; \
		if [ $$i -eq 10 ]; then echo "ERROR: port 6767 still in use after 5s"; exit 1; fi; \
		sleep 0.5; \
	done

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
