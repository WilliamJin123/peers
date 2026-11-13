#!/bin/sh
# The claims and queue smokes with the shadow coord store on (WA-1370): each ends with the store level with the files.
# PEERS_COORD=files (default) or a store module path (Aerie: its peers-coord.js, with AERIE_DATABASE_URL set).
# Arg: claims | queue (default both). A shared board or store (the Aerie gate) needs a fresh database per smoke: run one each.
set -e
d=$(dirname "$0")
export PEERS_COORD="${PEERS_COORD:-files}"
for s in ${1:-claims queue}; do sh "$d/smoke-$s.sh"; done
