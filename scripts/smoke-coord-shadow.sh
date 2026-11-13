#!/bin/sh
# The claims and queue smokes with the shadow coord store on (WA-1370): each ends with the store level with the files.
# PEERS_COORD=files (default) or a store module path (Aerie: its peers-coord.js, with AERIE_DATABASE_URL set).
set -e
d=$(dirname "$0")
export PEERS_COORD="${PEERS_COORD:-files}"
sh "$d/smoke-claims.sh" && sh "$d/smoke-queue.sh"
