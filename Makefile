.PHONY: dev build deploy start stop restart status logs logs-client deps docker-up docker-down docker-logs docker-deploy free-ports

PIDFILE := logs/server.pid
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

# === Production (PID-file based) ===
# Server on :6767 (serves built client static files)

# Build + restart server
deploy: build
	@mkdir -p logs
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "Stopping existing server (PID $$(cat $(PIDFILE)))..."; \
		kill $$(cat $(PIDFILE)); \
		sleep 2; \
	fi
	@NODE_ENV=production nohup ./node_modules/.bin/tsx server.ts >> $(LOGFILE) 2>&1 & echo $$! > $(PIDFILE)
	@sleep 2
	@if kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "Server (:6767) running. PID: $$(cat $(PIDFILE))"; \
	else \
		echo "ERROR: server failed to start. Check logs:"; \
		tail -20 $(LOGFILE); \
		rm -f $(PIDFILE); \
		exit 1; \
	fi
	@echo "Deployed."

start:
	@mkdir -p logs
	@if [ -f $(PIDFILE) ] && kill -0 $$(cat $(PIDFILE)) 2>/dev/null; then \
		echo "Server already running (PID $$(cat $(PIDFILE)))"; \
	else \
		NODE_ENV=production nohup ./node_modules/.bin/tsx server.ts >> $(LOGFILE) 2>&1 & echo $$! > $(PIDFILE); \
		sleep 1; \
		echo "Server started (PID $$(cat $(PIDFILE)))"; \
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
		echo "Server running (PID $$(cat $(PIDFILE)))"; \
	else \
		echo "Server not running."; \
		rm -f $(PIDFILE) 2>/dev/null; \
	fi

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
	@rm -f $(PIDFILE)
	@echo "Done"
