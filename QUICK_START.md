# Quick Start

Get Terminal Bridge running in under five minutes.

## Prerequisites

- **Node.js 22+** and npm
- **macOS or Linux** with `tmux` installed (`brew install tmux` on macOS)
- An **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com))
- **Tailscale** for remote access ([tailscale.com](https://tailscale.com))

## Install

```bash
npm install -g terminal-bridge
```

## Configure

Add to your `~/.zshrc` or `~/.bashrc`:

```bash
export TERMINAL_BRIDGE_AUTH_TOKEN="pick-a-strong-secret"
export ANTHROPIC_API_KEY="sk-ant-..."
```

Reload your shell (`source ~/.zshrc`) or open a new terminal.

## Set up Tailscale

Install [Tailscale](https://tailscale.com) on the host and on every device you want to connect from. Sign in with the same account on each device. Terminal Bridge auto-detects your Tailscale IP at startup and prints remote URLs.

## Run

```bash
terminal-bridge
```

The server starts on port 3001 by default (`PORT=8080 terminal-bridge` to change it).

## Open

| Client   | URL                          |
|----------|------------------------------|
| Terminal | `http://localhost:3001/`     |
| AI Chat  | `http://localhost:3001/ai`   |

Enter your auth token on the login screen to connect. With Tailscale, use `http://<tailscale-ip>:3001/` from any device on your network.

---

For development setup, architecture details, and the full protocol reference, see the [README](README.md).
