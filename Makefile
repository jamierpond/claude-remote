.PHONY: dev dev-server dev-client build start logs-server logs-client install clean reload kill restart

# Install all dependencies
install:
	pnpm install
	cd flutter_client && flutter pub get

# Run both server and client (with hot reload)
# Server: tsx --watch auto-restarts on .ts file changes
# Client: Vite HMR auto-updates on save
dev:
	pnpm dev

# Run server only (with watch mode)
dev-server:
	pnpm dev:server

# Run client only (web)
dev-client:
	pnpm dev:client

# Build for production
build:
	pnpm build

# Start production server
start:
	pnpm start

# Trigger server reload (for use when dev server is running)
reload:
	@echo "Triggering server reload..."
	@touch server.ts

# Kill all dev processes
kill:
	@echo "Killing dev processes..."
	@pkill -f "tsx.*server.ts" 2>/dev/null || true
	@pkill -f "vite" 2>/dev/null || true
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

# Clean
clean:
	rm -rf node_modules .next logs/*.log dist
	cd flutter_client && flutter clean

# Nix/direnv setup
nix-allow:
	direnv allow
