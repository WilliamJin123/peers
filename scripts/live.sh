#!/bin/sh
# HEAD -> a plugin folder named in CLAUDE_CODE_PLUGIN_DIRS: every open session hot-reloads the mod, no restart.
# Only changed files are written: an unchanged mod reloads nothing.
set -e
cd "$(dirname "$0")/.."
live="${PEERS_LIVE:-$HOME/.claude/mods/peers}"
tmp=$(mktemp -d)
git archive HEAD | tar -x -C "$tmp"
mkdir -p "$live"
rsync -a --delete --checksum "$tmp/" "$live/"
rm -rf "$tmp"
mkdir -p "$HOME/.local/bin"
ln -sfn "$live/bin/peers.mjs" "$HOME/.local/bin/peers"
# The view server runs the CLI it was installed from.
[ -n "$PEERS_HOST" ] && node "$live/bin/peers.mjs" view --install --host "$PEERS_HOST" >/dev/null
echo "live: $(node -p "require('$live/.claude-plugin/plugin.json').version") in $live"
