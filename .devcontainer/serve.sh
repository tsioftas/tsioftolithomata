#!/usr/bin/env bash
# Serve the checked-out site, and make the forwarded port reachable from a phone.
#
# Deliberately not `set -e`: nothing in here is worth aborting for. If the port
# cannot be made public the site is still served; if the log cannot be written the
# site is still served. The one job is that something is listening on 8000 by the
# time anyone looks.
#
# Safe to run twice: postStartCommand runs it on every container start, and it is
# a reasonable thing to run by hand as well.
set -u

cd "$(dirname "$0")/.." || exit 1

# /dev/tcp rather than ss or lsof, neither of which is guaranteed to be installed.
if (exec 3<>/dev/tcp/127.0.0.1/8000) 2>/dev/null; then
  exec 3>&- 2>/dev/null
  echo "Something is already serving on :8000; leaving it alone."
  exit 0
fi

# The log is written into the served directory as well as /tmp, so it can be read
# in a browser at <preview-url>/serve.log. Reading a file is far easier than
# driving a terminal on a phone. It is gitignored.
LOG="$(pwd)/serve.log"
exec > >(tee "$LOG" /tmp/serve.log) 2>&1

echo "=== $(date -u +%FT%TZ) ==="
echo "workspace : $(pwd)"
echo "python    : $(command -v python3 || echo 'MISSING')"
echo "codespace : ${CODESPACE_NAME:-<not a codespace>}"

# Port visibility cannot be declared in devcontainer.json — portsAttributes only
# carries presentation settings such as `label` — so this is the documented way.
# Without it the forwarded URL is private, which still works in a browser already
# signed in to GitHub but not when the link is shared or opened elsewhere.
if [ -n "${CODESPACE_NAME:-}" ] && command -v gh > /dev/null 2>&1; then
  if gh codespace ports visibility 8000:public --codespace "$CODESPACE_NAME"; then
    echo "port 8000 -> public"
  else
    echo "could not set port 8000 public; use the Ports tab (Port Visibility -> Public)"
  fi
else
  echo "no gh or not a codespace; leaving port visibility alone"
fi

if [ -n "${CODESPACE_NAME:-}" ]; then
  DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  echo "site      : https://${CODESPACE_NAME}-8000.${DOMAIN}/"
fi

echo "serving on :8000 ..."
exec python3 -m http.server 8000 --bind 0.0.0.0
