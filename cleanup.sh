#!/usr/bin/env bash
# Tear down the dsp-native-basyx monitoring compose stack and its volumes
# (postgres, vault, mongo, prometheus/grafana/tempo data) so the next run starts
# clean.
#
#   ./cleanup.sh        # tear down BOTH identity arms (idempotent; safe if one
#                       # was never up) — the default, so you never strand a stack
#   ./cleanup.sh on     # tear down only the identity-ON (MVD/DCP) arm
#   ./cleanup.sh off    # tear down only the identity-OFF (mock) arm
# Aliases: real|dcp|non-mock == on ; mock|no-id == off.
set -euo pipefail

cd "$(dirname "$0")"

REAL_COMPOSE="docker-compose.monitoring.yaml"               # identity ON  (MVD/DCP)
MOCK_COMPOSE="docker-compose-mock.monitoring.yaml"          # identity OFF (mock)

case "${1:-both}" in
  on|real|dcp|non-mock) FILES=("$REAL_COMPOSE");;
  off|mock|no-id)       FILES=("$MOCK_COMPOSE");;
  both)                 FILES=("$REAL_COMPOSE" "$MOCK_COMPOSE");;
  *) echo "Usage: $0 [on|off]   (no arg = tear down both arms)" >&2; exit 2;;
esac

for f in "${FILES[@]}"; do
  echo ">>> Stopping and removing dsp-native-basyx stack + volumes (${f}) ..."
  docker compose -f "$f" down -v --remove-orphans
done

echo ">>> Done."
