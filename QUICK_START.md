# Quick Start

Get Terminal Bridge running in under five minutes.

## Prerequisites

- **Node.js 22+** and npm
- **macOS or Linux** with `tmux` installed (`brew install tmux` on macOS)
- An **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com))
- **Tailscale** installed on the host and your remote devices ([tailscale.com/download](https://tailscale.com/download))

## Install Tailscale

```bash
# macOS
brew install --cask tailscale

# Linux — see https://tailscale.com/download/linux
```

Open Tailscale, sign in, and run `tailscale up`. Install on your phone/laptop too — same account.

## Install Terminal Bridge

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

## Run

```bash
terminal-bridge
```

The server starts on port 3001 by default (`PORT=8080 terminal-bridge` to change it).

## Open

| Client   | URL                                    |
|----------|----------------------------------------|
| Terminal | `http://<tailscale-ip>:3001/`         |
| AI Chat  | `http://<tailscale-ip>:3001/ai`       |
| Local    | `http://localhost:3001/`               |

Enter your auth token on the login screen to connect.

---

For development setup, architecture details, and the full protocol reference, see the [README](README.md).
