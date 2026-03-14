#!/usr/bin/env bash

set -euo pipefail

ports=(8000 5173 8787 8790 8791 8792 8793 8794 8795 8796 8797 8798 8799)

collect_pids() {
  local port
  for port in "${ports[@]}"; do
    lsof -t -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
  done | sort -u
}

pids="$(collect_pids)"

if [[ -z "${pids}" ]]; then
  echo "No development services are listening on the configured ports."
  exit 0
fi

echo "Stopping development services on configured ports..."
echo "${pids}" | tr '\n' ' '
echo

echo "${pids}" | xargs kill
sleep 2

remaining="$(collect_pids)"
if [[ -n "${remaining}" ]]; then
  echo "Force killing remaining processes..."
  echo "${remaining}" | tr '\n' ' '
  echo
  echo "${remaining}" | xargs kill -9
fi

echo "Development service cleanup complete."