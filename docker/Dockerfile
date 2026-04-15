# claude-mem worker — centralized memory server
# Runs the observation/summary worker with OpenRouter provider (no claude binary needed)
# Target: ARM64 (Raspberry Pi 5, Proxmox ARM VMs) and AMD64

FROM oven/bun:1-debian AS base

# Install Python 3 + pip for Chroma vector DB (uvx/chroma-mcp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uvx (uv package manager — runs chroma-mcp)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Create app directory and data directory
# Symlink ~/.claude-mem → /data/claude-mem so homedir() paths resolve to the volume
RUN mkdir -p /app /data/claude-mem \
    && ln -s /data/claude-mem /root/.claude-mem

WORKDIR /app

# Copy the pre-built plugin (worker + hooks + UI)
COPY plugin/ ./plugin/

# Install runtime dependencies (better-sqlite3 needs native build)
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile 2>/dev/null || bun install --production

# Data volume — SQLite DB, Chroma vectors, logs, settings
VOLUME /data/claude-mem

# Worker port
EXPOSE 37777

# Environment defaults for containerized operation
ENV CLAUDE_MEM_DATA_DIR=/data/claude-mem \
    CLAUDE_MEM_WORKER_HOST=0.0.0.0 \
    CLAUDE_MEM_WORKER_PORT=37777 \
    CLAUDE_MEM_PROVIDER=openrouter \
    CLAUDE_MEM_LOG_LEVEL=INFO \
    CLAUDE_MEM_MAX_CONCURRENT_AGENTS=1 \
    CLAUDE_MEM_MANAGED=true

# Health check — /api/health returns 200 when worker is up
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://127.0.0.1:37777/api/health || exit 1

# Run worker in foreground (--daemon flag = actual server, not daemonization)
CMD ["bun", "plugin/scripts/worker-service.cjs", "--daemon"]
