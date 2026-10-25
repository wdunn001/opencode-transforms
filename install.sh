#!/bin/bash
# Install the plugin into opencode's config (default ~/.config/opencode).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
DEST=${1:-$HOME/.config/opencode}
mkdir -p "$DEST/plugins" "$DEST/plugin-lib"
cp "$HERE/plugins/transforms.ts" "$DEST/plugins/"
rsync -a --delete --exclude '*.test.ts' "$HERE/plugin-lib/" "$DEST/plugin-lib/"
echo "installed into $DEST; restart opencode to load it"
