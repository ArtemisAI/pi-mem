# Joining the Memory Network — Client Guide

This guide gets a new machine connected to the centralized claude-mem worker in under 5 minutes.

## Prerequisites

- Machine has **Bun** installed (`bun --version`) — hooks fail without it
- Machine has **Claude Code** installed (`claude --version`)
- Machine is on the **Tailscale** mesh (`tailscale status`)
- You can reach the worker: `curl -s http://100.89.23.33:37777/api/health`

## Step 0: Install Bun (required)

Bun is a mandatory dependency — claude-mem hooks run via Bun. Without it, every hook fires and fails with "Bun not found."

```bash
# Install (may need: sudo apt-get install -y unzip)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# CRITICAL: symlink so Claude Code hooks find bun
# Hooks run in non-interactive shells that don't source .bashrc
sudo ln -sf ~/.bun/bin/bun /usr/local/bin/bun
sudo ln -sf ~/.bun/bin/bunx /usr/local/bin/bunx

bun --version  # should show 1.x
```

## Step 1: Install claude-mem hooks

```bash
npx claude-mem install
```

This installs hooks into Claude Code. No local worker is started.

## Step 2: Point at the centralized worker

Create or edit `~/.claude-mem/settings.json`:

```json
{
  "CLAUDE_MEM_WORKER_HOST": "100.89.23.33",
  "CLAUDE_MEM_WORKER_PORT": "37777"
}
```

Or set via environment variables (add to `~/.bashrc` or `~/.zshrc`):

```bash
export CLAUDE_MEM_WORKER_HOST=100.89.23.33
export CLAUDE_MEM_WORKER_PORT=37777
```

## Step 3: Verify connectivity

```bash
# Test worker reachability
curl -s http://100.89.23.33:37777/api/health | python3 -m json.tool

# Expected: {"status":"ok","version":"12.1.0",...,"ai":{"provider":"openrouter",...}}
```

## Step 4: Start a Claude Code session

```bash
claude
```

Observations will flow to the central worker automatically. Verify with:

```bash
# Check worker logs for your session
ssh brain "tail -20 /opt/claude-mem-data/logs/claude-mem-$(date -u +%Y-%m-%d).log"

# Search past work from any node
curl -s "http://100.89.23.33:37777/api/search?query=your+search+term&limit=5"
```

In Claude Code, use `/mem-search` to search the shared memory.

## One-liner setup (copy-paste)

```bash
npx claude-mem install && mkdir -p ~/.claude-mem && echo '{"CLAUDE_MEM_WORKER_HOST":"100.89.23.33","CLAUDE_MEM_WORKER_PORT":"37777"}' > ~/.claude-mem/settings.json && curl -s http://100.89.23.33:37777/api/health | python3 -c "import json,sys; print('Connected!' if json.load(sys.stdin)['status']=='ok' else 'FAILED')"
```

## Architecture

```text
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   rpi-1     │     │   rpi-2     │     │   Dev-1     │
│ Claude Code │     │ Claude Code │     │ Claude Code │
│   hooks     │     │   hooks     │     │   hooks     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │ Tailscale         │ Tailscale         │ Tailscale
       └───────────────────┼───────────────────┘
                           │
                    ┌──────▼──────┐
                    │   brain     │
                    │ claude-mem  │
                    │   worker    │
                    │ :37777      │
                    │ SQLite +    │
                    │ Chroma      │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼ primary    │            ▼ fallback
       ┌──────────────┐   │     ┌──────────────┐
       │ api.ai-      │   │     │ openrouter   │
       │ automate.me  │   │     │ .ai/api/v1   │
       │ (proxy)      │   │     │ (direct)     │
       │ nemotron OR  │   │     │ nemotron     │
       │ 62 models    │   │     │ 120B free    │
       └──────────────┘   │     └──────────────┘
                          │
                   If both fail:
                   observation queued
                   for retry
```

## Central Worker Details

| Setting | Value |
|---|---|
| Host | brain (100.89.23.33 via Tailscale) |
| Port | 37777 |
| Primary | api.ai-automate.me → nemotron-3-super-or:free |
| Fallback | openrouter.ai → nvidia/nemotron-3-super-120b-a12b:free |
| Data | /opt/claude-mem-data/ on brain |
| Service | `systemctl status claude-mem-worker` |
| Logs | `/opt/claude-mem-data/logs/claude-mem-YYYY-MM-DD.log` |

## Connected Nodes

| Node | Tailscale IP | Status |
|---|---|---|
| brain (server) | 100.89.23.33 | Worker host |
| rpi-1 | 100.104.3.88 | Client ✅ |
| rpi-2 | 100.120.187.88 | Client ✅ |
| Dev-1 | 100.72.99.20 | Client ✅ |

## Troubleshooting

**Can't reach worker:**
```bash
tailscale ping 100.89.23.33
ssh brain "systemctl status claude-mem-worker"
ssh brain "ss -tlnp | grep 37777"
```

**Observations not flowing:**
```bash
# Check hooks installed
ls ~/.claude/plugins/marketplaces/thedotmack/

# Check settings
cat ~/.claude-mem/settings.json

# Check worker logs for your session
ssh brain "tail -30 /opt/claude-mem-data/logs/claude-mem-$(date -u +%Y-%m-%d).log"
```

**Worker restart:**
```bash
ssh brain "sudo systemctl restart claude-mem-worker"
```
