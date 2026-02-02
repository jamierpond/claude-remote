.PHONY: dev dev-server dev-client dev-vite dev-flutter-client build start logs-server logs-client install clean reload kill restart

# Install all dependencies
install:
	pnpm install
	cd flutter_client && flutter pub get

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

# Start production server
start:
	pnpm start

# Trigger reload for all dev processes
# - Touches server.ts to trigger tsx --watch restart
# - Sends SIGUSR1 to Flutter process for hot reload
reload:
	@echo "Triggering reload..."
	@touch server.ts
	@if [ -f logs/flutter.pid ]; then kill -USR1 $$(cat logs/flutter.pid) 2>/dev/null || true; fi
	@echo "Done"

# Kill all dev processes
kill:
	@echo "Killing dev processes..."
	@pkill -f "tsx.*server.ts" 2>/dev/null || true
	@pkill -f "vite" 2>/dev/null || true
	@if [ -f logs/flutter.pid ]; then kill $$(cat logs/flutter.pid) 2>/dev/null || true; rm -f logs/flutter.pid; fi
	@pkill -f "flutter.*run" 2>/dev/null || true
	@echo "Done"

# Full restart
restart: kill
	@sleep 1
	$(MAKE) dev

# Tail logs
logs-server:
	pnpm logs:server

logs-client:
	pnpm logs:client

logs-flutter:
	tail -f logs/flutter.log

# Clean
clean:
	rm -rf node_modules .next logs/*.log dist
	cd flutter_client && flutter clean

# Nix/direnv setup
nix-allow:
	direnv allow
