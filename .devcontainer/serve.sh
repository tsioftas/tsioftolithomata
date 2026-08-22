#!/usr/bin/env bash
# Serve the checked-out site, and make the forwarded port reachable from a phone.
set -uo pipefail
cd "$(dirname "$0")/.."

# Port visibility cannot be declared in devcontainer.json — portsAttributes only
# supports presentation settings such as `label`, so this is the documented way to
# do it. Without it the forwarded URL is private, which still works in a browser
# already signed in to GitHub but not when the link is shared or opened elsewhere.
if [ -n "${CODESPACE_NAME:-}" ] && command -v gh > /dev/null; then
  gh codespace ports visibility 8000:public --codespace "$CODESPACE_NAME" \
    || echo "Could not set port 8000 public; do it from the Ports tab." >&2
fi

echo "Serving $(pwd) on :8000"
exec python3 -m http.server 8000 --bind 0.0.0.0
