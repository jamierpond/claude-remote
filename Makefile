.PHONY: dev dev-server dev-client dev-vite dev-flutter-client build start stop restart status logs logs-server logs-client deps install clean reload kill dev-restart

# Install dependencies only
deps:
	pnpm install
	cd flutter_client && flutter pub get

# Full install: deps + systemd daemon setup
install: deps
	@echo "Installing systemd service..."
	@mkdir -p ~/.config/systemd/user
	@mkdir -p logs
	@cp claude-remote.service ~/.config/systemd/user/
	@systemctl --user daemon-reload
	@systemctl --user enable claude-remote
	@systemctl --user restart claude-remote
	@echo ""
	@echo "Daemon installed and running. Logs: logs/daemon-server.log"
	@echo "Run 'sudo loginctl enable-linger $(USER)' to keep it running when logged out."

# Run server + Flutter web client (with hot reload)
# Server: tsx --watch auto-restarts on .ts file changes
# Flutter: flutter run -d web-server on port 5173, use `make reload` for hot reload
dev:
	@mkdir -p logs
	@echo "Starting server and Flutter web client..."
	@(pnpm tsx --watch server.ts 2>&1 | tee logs/server.log) & \
	(cd flutter_client && flutter run -d web-server --web-port=5173 --pid-file=../logs/flutter.pid 2>&1 | tee ../logs/flutter.log)

# Run both server and React web client (with hot reload)
# Server: tsx --watch auto-restarts on .ts file changes
# Client: Vite HMR auto-updates on save
dev-vite:
	pnpm dev

# Run server only (with watch mode)
dev-server:
	pnpm dev:server

# Run client only (Vite/React web)
dev-client:
	pnpm dev:client

# Run Flutter web client only
dev-flutter-client:
	cd flutter_client && flutter run -d chrome

# Build for production
build:
	pnpm build

# Start daemon (production)
start:
	@systemctl --user start claude-remote
	@echo "Daemon started. Use 'make logs' to view output."

# Stop daemon
stop:
	@systemctl --user stop claude-remote
	@echo "Daemon stopped."

# Restart daemon (production)
restart:
	@systemctl --user restart claude-remote
	@echo "Daemon restarted."

# Daemon status
status:
	@systemctl --user status claude-remote

# Daemon logs (follow mode)
logs:
	@tail -n 100 -f logs/daemon-server.log

# Trigger reload for all dev processes
# - Touches server.ts to trigger tsx --watch restart
# - Sends SIGUSR2 to Flutter process for hot restart (rebuilds app)
# - Calls /api/dev/reload to broadcast reload message to connected clients
reload:
	@echo "Triggering reload..."
	@touch server.ts
	@if [ -f logs/flutter.pid ]; then kill -USR2 $$(cat logs/flutter.pid) 2>/dev/null || true; fi
	@sleep 2
	@curl -s -X POST http://localhost:3001/api/dev/reload > /dev/null 2>&1 || true
	@echo "Done - clients will auto-refresh"

# Kill all dev processes
kill:
	@echo "Killing dev processes..."
	@pkill -f "tsx.*server.ts" 2>/dev/null || true
	@pkill -f "vite" 2>/dev/null || true
	@if [ -f logs/flutter.pid ]; then kill $$(cat logs/flutter.pid) 2>/dev/null || true; rm -f logs/flutter.pid; fi
	@pkill -f "flutter.*run" 2>/dev/null || true
	@pkill -f "dart.*flutter" 2>/dev/null || true
	@fuser -k 5173/tcp 2>/dev/null || true
	@fuser -k 3001/tcp 2>/dev/null || true
	@echo "Done"

# Restart dev mode (kill + restart)
dev-restart: kill
	@sleep 1
	$(MAKE) dev

# Tail logs
logs-server:
	pnpm logs:server

logs-client:
	pnpm logs:client

logs-flutter:
	tail -f logs/flutter.log

# Clean build artifacts
clean:
	rm -rf node_modules .next logs/*.log dist
	cd flutter_client && flutter clean

# Uninstall daemon
uninstall:
	@systemctl --user stop claude-remote 2>/dev/null || true
	@systemctl --user disable claude-remote 2>/dev/null || true
	@rm -f ~/.config/systemd/user/claude-remote.service
	@systemctl --user daemon-reload
	@echo "Daemon removed."

# Nix/direnv setup
nix-allow:
	direnv allow
