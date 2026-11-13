#!/bin/sh
# The work queue end to end: the real CLI on a throwaway HOME and a Backlog.md board. Needs `backlog` on PATH.
# Lanes and pins, the quiet gate, exactly one taker under a race, told marks, claim/unclaim by hand, a dead holder.
set -e
peers="$(cd "$(dirname "$0")/.." && pwd)/bin/peers.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home" BACKLOG_CWD="$T/board" GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
unset CLAUDE_CODE_SESSION_ID
mkdir -p "$HOME/.claude/sessions" "$HOME/.claude/peers" "$BACKLOG_CWD" "$T/none"
(cd "$BACKLOG_CWD" && git init -q && backlog init smoke --defaults </dev/null >/dev/null 2>&1)
for t in one two three four five six seven; do backlog task create $t >/dev/null; done
echo '{"who":"m1","queueQuietSec":60}' >"$HOME/.claude/peers/config.json"
C="$HOME/.claude/peers-claims"
old=$(($(date +%s) * 1000 - 600000))
# A running session: name, status, and when that status began.
up() { echo "{\"pid\":$$,\"sessionId\":\"$1\",\"name\":\"$2\",\"nameSource\":\"user\",\"status\":\"${3:-idle}\",\"statusUpdatedAt\":${4:-$old}}" >"$HOME/.claude/sessions/$1.json"; }
up aaaa1111-0 'sop dev'
up bbbb2222-0 'ui dev'
up cccc3333-0 'pin dev'
up dddd4444-0 'race one'
up eeee5555-0 'race two'
fails=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2], want [$3]"; fails=$((fails + 1)); fi; }
# From a folder that is no git repo: the mod's case.
as() { s=$1; shift; (cd "$T/none" && PEERS_SESSION=$s node "$peers" "$@"); }
task() { backlog task view "$1" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).task;console.log(t.status+"|"+(t.labels??[]).join(","))})'; }
order() { as aaaa1111-0 queue --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).map(i=>i.task).join(" ")))'; }
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s);console.log(v===null?"null":process.argv[1].split(".").reduce((o,k)=>o?.[k],v))})' "$1"; }

as aaaa1111-0 queue add TASK-1 TASK-2 --lane sop >/dev/null
as aaaa1111-0 queue add TASK-3 --lane ui >/dev/null
as aaaa1111-0 queue add TASK-4 --lane sop --pin 'pin dev' >/dev/null
as aaaa1111-0 queue add TASK-5 --top --lane sop >/dev/null
check 'add: order, --top first' "$(order)" 'TASK-5 TASK-1 TASK-2 TASK-3 TASK-4'
check 'add: board labels' "$(task TASK-4)" 'To Do|queued,lane:sop,pin:pin-dev'
check 'add: a task not To Do is refused' "$(backlog task edit TASK-6 -s 'In Progress' >/dev/null; as aaaa1111-0 queue add TASK-6 2>&1 | grep -c 'not To Do')" '1'
check 'add: --pin with an id is refused' "$(as aaaa1111-0 queue add TASK-7 --pin aaaa1111-1111-1111-1111-111111111111 2>&1 | grep -c 'not an id')" '1'

as aaaa1111-0 serve sop >/dev/null
as bbbb2222-0 serve ui >/dev/null
check 'next --auto: nothing for a session that does not serve' "$(as cccc3333-0 next --auto --json | field item.task)" 'TASK-4'
check 'next --json: the board view hint' "$(as cccc3333-0 next --json 2>/dev/null | field view)" 'backlog task view TASK-4 --plain'
check 'pin: reaches its session without serve; others skip it' "$(order)" 'TASK-5 TASK-1 TASK-2 TASK-3'
up aaaa1111-0 'sop dev' busy
check 'next --auto: a busy session gets nothing' "$(as aaaa1111-0 next --auto --json)" 'null'
up aaaa1111-0 'sop dev' idle $(($(date +%s) * 1000 - 5000))
check 'next --auto: idle 5 s, inside the quiet time: nothing' "$(as aaaa1111-0 next --auto --json)" 'null'
up aaaa1111-0 'sop dev'
got=$(as aaaa1111-0 next --auto --json)
check 'next --auto: the head of its lane' "$(echo "$got" | field item.task)" 'TASK-5'
check 'next --auto: untold' "$(node -p "require('$C/aaaa1111-0.json').queued.told")" 'false'
check 'next: the board, In Progress, labels off' "$(task TASK-5)" 'In Progress|'
check 'next --auto again: the same delivery, not a new task' "$(as aaaa1111-0 next --auto --json | field again)" 'true'
as aaaa1111-0 next --told "$(echo "$got" | field id)"
check 'told: marked' "$(node -p "require('$C/aaaa1111-0.json').queued.told")" 'true'
check 'next --auto: a session that holds a task gets no second' "$(as aaaa1111-0 next --auto --json)" 'null'
check 'next --auto: the other lane' "$(as bbbb2222-0 next --auto --json | field item.task)" 'TASK-3'
check 'queue: what is left' "$(order)" 'TASK-1 TASK-2'

# A hand claim of a queued task takes it out of the queue; unclaim puts it back at the head.
(cd "$T/none" && git init -q 2>/dev/null; true)
as bbbb2222-0 claim TASK-2 >/dev/null 2>&1
check 'claim by hand: out of the queue' "$(order)" 'TASK-1'
as bbbb2222-0 unclaim TASK-2 >/dev/null 2>&1
check 'unclaim: back at the head' "$(order)" 'TASK-2 TASK-1'
check 'unclaim: labels back' "$(task TASK-2 | cut -d'|' -f2)" 'queued,lane:sop'

# Two sessions on one lane at once: each gets a different task.
as dddd4444-0 serve sop >/dev/null
as eeee5555-0 serve '*' >/dev/null
as dddd4444-0 next --auto --json >"$T/d" &
as eeee5555-0 next --auto --json >"$T/e" &
wait
check 'race: two takers, two tasks' "$( (field item.task <"$T/d"; field item.task <"$T/e") | sort | tr '\n' ' ')" 'TASK-1 TASK-2 '
check 'race: queue empty' "$(order)" ''

# A dead holder: its session file gone, its claim past the 2 h grace. The sweep puts its task back at the head.
rm "$HOME/.claude/sessions/dddd4444-0.json"
node -e 'const fs=require("fs"),p=process.argv[1],c=JSON.parse(fs.readFileSync(p));c.updated=c.claimed=Date.now()-3*3600e3;fs.writeFileSync(p,JSON.stringify(c))' "$C/dddd4444-0.json"
dead=$(field item.task <"$T/d")
as aaaa1111-0 sweep >/dev/null 2>&1
check 'sweep: a dead holder'"'"'s task back in the queue' "$(order)" "$dead"
check 'sweep: its serve file goes' "$(ls "$C/serve" | grep -c dddd4444)" '0'
check 'sweep: board To Do with labels' "$(task "$dead" | cut -d'|' -f1)" 'To Do'

# Manual next: told at once (the model reads it in the Bash result).
check 'next by hand: told at once, even while holding a task' "$(as aaaa1111-0 next --json | field told)" 'true'
check 'next by hand: the old task stays held' "$(node -p "require('$C/aaaa1111-0.json').also[0].ticket")" 'TASK-5'
as aaaa1111-0 queue add TASK-7 >/dev/null
check 'rm: says so' "$(as aaaa1111-0 queue rm TASK-7)" 'out of the work queue: TASK-7'
check 'rm: queue empty, labels off' "$(order)|$(task TASK-7)" '|To Do|'

[ $fails -eq 0 ] && echo "all passed" || { echo "$fails failed"; exit 1; }
