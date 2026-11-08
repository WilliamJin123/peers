#!/bin/sh
# Claims end to end: the real CLI on a throwaway HOME, Backlog.md board and two repos. Needs `backlog` on PATH.
# Checks: claim marks, a claim in one repo binds commits in another, close waits for a peer, the sweep frees a gone holder.
set -e
peers="$(cd "$(dirname "$0")/.." && pwd)/bin/peers.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home" BACKLOG_CWD="$T/board" GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
unset CLAUDE_CODE_SESSION_ID
mkdir -p "$HOME/.claude/sessions" "$BACKLOG_CWD" "$T/r1" "$T/r2"
(cd "$BACKLOG_CWD" && git init -q && backlog init smoke --defaults </dev/null >/dev/null 2>&1)
backlog task create one >/dev/null
backlog task create two >/dev/null
for r in r1 r2; do (cd "$T/$r" && git init -q && echo "the first line of the file" >f && git add f && git commit -qm init); done
up() { echo "{\"pid\":$2,\"sessionId\":\"$1\"}" >"$HOME/.claude/sessions/$2.json"; }
up aaaa1111-0 1
up bbbb2222-0 2
fails=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2], want [$3]"; fails=$((fails + 1)); fi; }
who() { backlog task view "$1" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).task;console.log(t.status+"|"+t.assignees.join(","))})'; }
A() { (cd "$T/$1" && shift && PEERS_SESSION=aaaa1111-0 node "$peers" "$@"); }
B() { (cd "$T/$1" && shift && PEERS_SESSION=bbbb2222-0 node "$peers" "$@"); }

A r1 claim TASK-1 >/dev/null
check 'claim: In Progress, marked' "$(who TASK-1)" 'In Progress|@peers:cc-aaaa'
echo "a changed line that is long enough" >"$T/r2/f"
A r2 take f >/dev/null
A r2 commit -m 'edit f' >/dev/null 2>&1
check 'a claim in r1 binds a commit in r2' "$(git -C "$T/r2" log -1 --format='%(trailers:key=Ticket,valueonly)' | head -1)" 'TASK-1'
B r2 claim TASK-1 >/dev/null
check 'second holder joins the marks' "$(who TASK-1)" 'In Progress|@peers:cc-aaaa,@peers:cc-bbbb'
check 'close waits for the peer' "$(A r2 close -r x 2>&1 | grep -c 'cc-bbbb also works on TASK-1')" '1'
# B's session ends; its last write was 3 h ago: past the 2 h grace.
rm "$HOME/.claude/sessions/2.json"
f=$(ls "$HOME"/.claude/peers/*/bbbb2222-0.json)
node -e 'const fs=require("fs"),p=process.argv[1],l=JSON.parse(fs.readFileSync(p));l.updated=Date.now()-3*3600e3;fs.writeFileSync(p,JSON.stringify(l))' "$f"
A r1 sweep >/dev/null 2>&1
check 'sweep drops the gone holder' "$(who TASK-1)" 'In Progress|@peers:cc-aaaa'
check 'held lists one holder' "$(A r1 held | cut -d' ' -f1-3)" 'TASK-1  cc-aaaa'
# A leftover from before 0.20.0: a ticket with no claimed field in a third repo's ledger.
mkdir -p "$HOME/.claude/peers/old"
echo '{"v":1,"session":"aaaa1111-0","root":"/old","ticket":"TASK-9","updated":1,"files":{},"commits":[]}' >"$HOME/.claude/peers/old/aaaa1111-0.json"
A r2 close -r done >/dev/null
check 'close clears the leftover' "$(grep -c TASK-9 "$HOME/.claude/peers/old/aaaa1111-0.json")" '0'
check 'close from r2: Done, marks off' "$(who TASK-1)" 'Done|'
check 'close unbinds the r1 ledger' "$(A r1 held)" 'no session holds a task'
# A gone holder's task goes back to To Do; a hand-set one stays.
up cccc3333-0 3
(cd "$T/r1" && PEERS_SESSION=cccc3333-0 node "$peers" claim TASK-2 >/dev/null)
rm "$HOME/.claude/sessions/3.json"
f=$(ls "$HOME"/.claude/peers/*/cccc3333-0.json)
node -e 'const fs=require("fs"),p=process.argv[1],l=JSON.parse(fs.readFileSync(p));l.updated=Date.now()-3*3600e3;fs.writeFileSync(p,JSON.stringify(l))' "$f"
backlog task create three >/dev/null
backlog task edit TASK-3 -s 'In Progress' >/dev/null
check 'sweep reports the hand-set task' "$(A r1 sweep 2>/dev/null)" 'In Progress, no session holds it (set by hand? the sweep leaves it): TASK-3'
check 'sweep freed the gone holder' "$(who TASK-2)" 'To Do|'
check 'hand-set task stays' "$(who TASK-3)" 'In Progress|'
exit $fails
