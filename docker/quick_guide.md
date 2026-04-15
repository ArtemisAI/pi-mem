# Joining the Memory Network — Quick Guide

This guide gets a new machine connected to the centralized claude-mem worker in under 5 minutes.

## Prerequisites

- Machine has **Claude Code** installed (`claude --version`)
- Machine is on the **Tailscale** mesh (`tailscale status`)
- You can reach the worker: `curl -s http://100.89.23.33:37777/api/health`

## Step 1: Install claude-mem hooks

```bash
npx claude-mem install
```

This installs the hooks into Claude Code. No local worker is started.

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

## Step 3: Verify

```bash
# Test worker reachability
curl -s http://100.89.23.33:37777/api/health | python3 -m json.tool

# Start a Claude Code session — observations should flow to the central worker
claude
```

Check the worker logs to confirm observations arrive:

```bash
ssh brain "journalctl -u claude-mem-worker -f --no-pager"
```

## Step 4: Verify search works

From within Claude Code, use `/mem-search` or call the API:

```bash
curl -s "http://100.89.23.33:37777/api/search?query=test&limit=5"
```

## Architecture

```
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
                    └─────────────┘
                           │
                    ┌──────▼──────┐
                    │ api.ai-     │
                    │ automate.me │
                    │ (proxy)     │
                    │ gemma4:31b  │
                    └─────────────┘
```

## Central Worker Details

| Setting | Value |
|---|---|
| Host | brain (100.89.23.33 via Tailscale) |
| Port | 37777 |
| Provider | openrouter → OpenRouter API (nvidia/nemotron-3-super-120b) |
| Model | nvidia/nemotron-3-super-120b-a12b:free |
| Data | /opt/claude-mem-data/ on brain |
| Service | systemd `claude-mem-worker` |

## Troubleshooting

**Can't reach worker:**
```bash
# Check Tailscale connectivity
tailscale ping 100.89.23.33

# Check worker is running
ssh brain "systemctl status claude-mem-worker"

# Check firewall
ssh brain "ss -tlnp | grep 37777"
```

**Observations not flowing:**
```bash
# Check hook is installed
ls ~/.claude/plugins/marketplaces/thedotmack/

# Check settings point at remote worker
cat ~/.claude-mem/settings.json | grep WORKER_HOST

# Check worker logs for incoming requests
ssh brain "journalctl -u claude-mem-worker --since '5 min ago' --no-pager"
```

**Search returns no results:**
- Worker may still be indexing after migration
- Try: `curl -s "http://100.89.23.33:37777/api/search?query=test&limit=1"`
