FROM node:20-slim

# System deps for argon2 native build + git for project status
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm @anthropic-ai/claude-code

WORKDIR /app

# Install deps first (layer cache)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build client
COPY . .
RUN pnpm build

RUN mkdir -p logs

EXPOSE 6767

CMD ["pnpm", "start"]
