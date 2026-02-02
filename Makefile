.PHONY: dev dev-server dev-client build start logs-server logs-client install clean

# Install all dependencies
install:
	pnpm install
	cd flutter_client && flutter pub get

# Run both server and client
dev:
	pnpm dev

# Run server only
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

# Tail logs
logs-server:
	pnpm logs:server

logs-client:
	pnpm logs:client

# Clean
clean:
	rm -rf node_modules .next logs/*.log
	cd flutter_client && flutter clean

# Nix/direnv setup
nix-allow:
	direnv allow
