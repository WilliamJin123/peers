#!/bin/sh
# coordMode through (WA-1367.1, aerie D23 B), on the files store: commands call the store at once, `next` takes from the
# store, the flush pulls the queue, a down store falls back to op files and replays, and the flush never diffs while a
# command holds the board lock; with a store that has listen (aerie), a store change reaches queue.json.
# PEERS_COORD=files (default) or a store module path (aerie: a fresh database). Needs `backlog` on PATH.
set -e
peers="$(cd "$(dirname "$0")/.." && pwd)/bin/peers.mjs"
lib="$(dirname "$peers")/../lib"
T=$(mktemp -d)
lp=
trap '[ -n "$lp" ] && kill $lp 2>/dev/null; rm -rf "$T"' EXIT
export HOME="$T/home" BACKLOG_CWD="$T/board" GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export PEERS_COORD="${PEERS_COORD:-files}" PEERS_COORD_MODE=through
unset CLAUDE_CODE_SESSION_ID
mkdir -p "$HOME/.claude/sessions" "$HOME/.claude/peers" "$BACKLOG_CWD" "$T/none"
(cd "$BACKLOG_CWD" && git init -q && backlog init smoke --defaults </dev/null >/dev/null 2>&1)
for t in one two three four five six; do backlog task create $t >/dev/null; done
echo '{"who":"m1","queueQuietSec":0}' >"$HOME/.claude/peers/config.json"
R="$HOME/.claude/peers-run"
C="$HOME/.claude/peers-claims"
old=$(($(date +%s) * 1000 - 600000))
up() { echo "{\"pid\":$$,\"sessionId\":\"$1\",\"name\":\"$2\",\"nameSource\":\"user\",\"status\":\"idle\",\"statusUpdatedAt\":$old}" >"$HOME/.claude/sessions/$1.json"; }
up aaaa1111-0 'one dev'
up bbbb2222-0 'two dev'
fails=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2], want [$3]"; fails=$((fails + 1)); fi; }
as() { s=$1; shift; (cd "$T/none" && PEERS_SESSION=$s node "$peers" "$@"); }
order() { as aaaa1111-0 queue --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).map(i=>i.task).join(" ")))'; }
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);console.log(v===null?"null":process.argv[1].split(".").reduce((o,k)=>o?.[k],v))})' "$1"; }
st() { (cd "$T/none" && node --input-type=module -e "import { coordSync } from '$lib/coord-sync.mjs'; const st = await coordSync({ home: process.env.HOME, config: {}, who: 'm1' }).store(); try { $1 } finally { await st.end?.() }"); }
sq() { st "console.log((await st.queueList()).map(i => i.id).join(' '))"; }
sheld() { st "console.log((await st.held()).map(t => t.id + ':' + t.holders.map(h => h.holder).join('+')).sort().join(' '))"; }
outbox() { ls "$R/coord-outbox" 2>/dev/null | grep -c json || true; }
flushed() { for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do r=$(as aaaa1111-0 coord flush); [ "$r" != busy ] && break; sleep 0.5; done; echo "$r"; }
# the mod's kicks run detached flushes; wait them out, so each check reads a still store
calm() { while [ -d "$R/coord-flush.lock" ]; do sleep 0.2; done; }

as aaaa1111-0 queue add TASK-1 TASK-2 TASK-3 >/dev/null
check 'add: in the store at once, no op file' "$(sq)|$(outbox)" 'TASK-1 TASK-2 TASK-3|0'
as aaaa1111-0 queue rm TASK-3 >/dev/null
check 'rm: in the store at once' "$(sq)" 'TASK-1 TASK-2'

# a row only the store has (another machine, aerie route): next takes it, the store picks
st "await st.queueAdd(['TASK-4'], { lane: 'main', at: 'top' })"
as aaaa1111-0 serve >/dev/null
got=$(as aaaa1111-0 next --json)
check 'next: the store picks its head, the files follow' "$(echo "$got" | field item.task)|$(sq)|$(order)" 'TASK-4|TASK-1 TASK-2|TASK-1 TASK-2'
check 'next: held in the store' "$(sheld)" 'TASK-4:m1/one-dev-aaaa'
calm

# the flush pulls a store-only row into queue.json; aerie run: rows stay out
st "await st.queueAdd(['TASK-5'], { lane: 'main' }); await st.queueAdd(['RUN-1'], { pin: 'run:claude' })"
flushed >/dev/null
check 'flush: queue.json follows the store, no run: row' "$(order)" 'TASK-1 TASK-2 TASK-5'
check 'flush: the run: row stays in the store' "$(sq)" 'TASK-1 TASK-2 TASK-5 RUN-1'
st "await st.queueRemove(['RUN-1'])"

(cd "$T/none" && git init -q)
as bbbb2222-0 claim TASK-6 >/dev/null 2>&1
check 'claim: in the store at once' "$(sheld)|$(outbox)" 'TASK-4:m1/one-dev-aaaa TASK-6:m1/two-dev-bbbb|0'
calm

# the board lock held (a command mid-way): the flush applies ops but diffs nothing
mkdir "$C/.lock" && echo $$ >"$C/.lock/pid"
check 'flush under a held board lock: no diff' "$(flushed)" 'ok: 0 ops, board busy, no diff'
rm -rf "$C/.lock"

# store down: the op files take it, one warning; back up: replayed in order, level
echo 'export default () => { throw new Error("down for the smoke") }' >"$T/down.mjs"
err=$( (cd "$T/none" && PEERS_COORD="$T/down.mjs" PEERS_SESSION=bbbb2222-0 node "$peers" unclaim TASK-6 2>&1 >/dev/null) || true)
check 'down: one warning' "$(echo "$err" | grep -c 'coord store .* failing')" '1'
(cd "$T/none" && PEERS_COORD="$T/down.mjs" PEERS_SESSION=aaaa1111-0 node "$peers" queue add TASK-3 >/dev/null 2>&1)
check 'down: the ops wait' "$(outbox)" '2'
calm
# an offline take: the files pick TASK-1; meanwhile the store's head changes
(cd "$T/none" && PEERS_COORD="$T/down.mjs" PEERS_SESSION=bbbb2222-0 node "$peers" serve >/dev/null 2>&1)
st "await st.queueAdd(['TASK-2'], { lane: 'main', at: 'top' })"
check 'down: next takes from the files' "$( (cd "$T/none" && PEERS_COORD="$T/down.mjs" PEERS_SESSION=bbbb2222-0 node "$peers" next --json 2>/dev/null) | field item.task)" 'TASK-1'
calm
check 'up: replayed' "$(flushed | cut -d, -f1)" 'ok: 3 ops'
check 'up: the offline take holds; the store row it missed went back' "$(sheld)|$(sq)" 'TASK-1:m1/two-dev-bbbb TASK-4:m1/one-dev-aaaa|TASK-2 TASK-5 TASK-3'
check 'up: level' "$(flushed | sed 's/^ok: [0-9]* ops, //')" '0 diffs'
check 'up: queue.json as the store' "$(order)" 'TASK-2 TASK-5 TASK-3'
check 'diff log: the take fix only' "$(grep -c '"kind":"take"' "$R/coord-diff.jsonl")|$(grep -c '"kind":"holders"\|"kind":"release"\|"kind":"lost"' "$R/coord-diff.jsonl" || true)" '1|0'
# the listener: a store change reaches queue.json with no flush
if st "if (!st.listen) process.exitCode = 1"; then
  as aaaa1111-0 coord listen >/dev/null 2>&1 &
  lp=$!
  sleep 3
  st "await st.queueAdd(['TASK-6'], { lane: 'main' })"
  sleep 2
  check 'listen: a store change reaches queue.json' "$(order)" 'TASK-2 TASK-5 TASK-3 TASK-6'
  kill $lp 2>/dev/null; lp=
else
  echo "info listen: the store has none ($PEERS_COORD)"
fi
check 'coord: mode shown' "$(as aaaa1111-0 coord | head -1 | grep -c '(through')" '1'
[ $fails -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
