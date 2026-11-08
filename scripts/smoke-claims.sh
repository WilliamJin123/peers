#!/bin/sh
# Claims end to end: the real CLI on a throwaway HOME, Backlog.md board and two repos. Needs `backlog` on PATH.
# Checks the claim paths and their races: a sweep during a slow claim, two claims at once, a crashed session, a failed claim.
set -e
peers="$(cd "$(dirname "$0")/.." && pwd)/bin/peers.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
real=$(command -v backlog)
# The board, slowed on demand: an edit lands, then 3 s pass (the push hook) before the command returns.
mkdir -p "$T/bin"
cat >"$T/bin/backlog" <<W
#!/bin/sh
"$real" "\$@"; s=\$?
case "\$*" in *"task edit"*) [ -f "$T/slow" ] && sleep 3;; esac
exit \$s
W
chmod +x "$T/bin/backlog"
export PATH="$T/bin:$PATH" HOME="$T/home" BACKLOG_CWD="$T/board" GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
unset CLAUDE_CODE_SESSION_ID
mkdir -p "$HOME/.claude/sessions" "$BACKLOG_CWD" "$T/r1" "$T/r2"
(cd "$BACKLOG_CWD" && git init -q && backlog init smoke --defaults </dev/null >/dev/null 2>&1)
for t in one two three four five six; do backlog task create $t >/dev/null; done
for r in r1 r2; do (cd "$T/$r" && git init -q && echo "the first line of the file" >f && git add f && git commit -qm init); done
C="$HOME/.claude/peers-claims"
# A running session: its file in the running list, with a live pid (this shell).
up() { echo "{\"pid\":${3:-$$},\"sessionId\":\"$1\"}" >"$HOME/.claude/sessions/$2.json"; }
up aaaa1111-0 1
up bbbb2222-0 2
fails=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2], want [$3]"; fails=$((fails + 1)); fi; }
who() { backlog task view "$1" --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const t=JSON.parse(s).task;console.log(t.status+"|"+t.assignees.join(","))})'; }
as() { s=$1 r=$2; shift 2; (cd "$T/$r" && PEERS_SESSION=$s node "$peers" "$@"); }
A() { as aaaa1111-0 "$@"; }
B() { as bbbb2222-0 "$@"; }
# A claim file's last write, n hours ago: past the 2 h grace for a session off the running list.
age() { node -e 'const fs=require("fs"),p=process.argv[1],c=JSON.parse(fs.readFileSync(p));c.updated=c.claimed=Date.now()-process.argv[2]*3600e3;fs.writeFileSync(p,JSON.stringify(c))' "$C/$1.json" "$2"; }

# 0.20 kept the claim in a ledger: the first command moves it to a claim file.
mkdir -p "$HOME/.claude/peers/old"
echo '{"v":1,"session":"dddd4444-0","root":"/old","ticket":"TASK-6","claimed":5,"updated":5,"files":{},"commits":[]}' >"$HOME/.claude/peers/old/dddd4444-0.json"
echo '{"v":1,"session":"aaaa1111-0","root":"/old","ticket":"TASK-9","updated":1,"files":{},"commits":[]}' >"$HOME/.claude/peers/old/aaaa1111-0.json"
A r1 claim TASK-1 >/dev/null
check 'migrate: a 0.20 claim becomes a file' "$(node -p "require('$C/dddd4444-0.json').ticket")" 'TASK-6'
check 'migrate: a ticket with no claimed time is not a claim' "$(cat "$C"/*.json | grep -c TASK-9)" '0'
check 'claim: In Progress, marked' "$(who TASK-1)" 'In Progress|@peers:cc-aaaa'
echo "a changed line that is long enough" >"$T/r2/f"
A r2 take f >/dev/null
A r2 commit -m 'edit f' >/dev/null 2>&1
check 'a claim binds a commit in another repo' "$(git -C "$T/r2" log -1 --format='%(trailers:key=Ticket,valueonly)' | head -1)" 'TASK-1'
check 'second holder is told and joins the marks' "$(B r2 claim TASK-1)" 'claimed TASK-1 (also held by cc-aaaa)'
check 'second holder: marks' "$(who TASK-1)" 'In Progress|@peers:cc-aaaa,@peers:cc-bbbb'
check 'close waits for the peer' "$(A r2 close -r x 2>&1 | grep -c 'cc-bbbb also works on TASK-1')" '1'

# B's session ends; its claim is 3 h old. The sweep drops its mark and deletes the dead claim.
rm "$HOME/.claude/sessions/2.json"
age bbbb2222-0 3
A r1 sweep >/dev/null 2>&1
check 'sweep drops the gone holder' "$(who TASK-1)" 'In Progress|@peers:cc-aaaa'
check 'sweep deletes the dead claim' "$(ls "$C" | grep -c bbbb)" '0'
check 'held lists one holder' "$(A r1 held | cut -d' ' -f1-3)" 'TASK-1  cc-aaaa'
A r2 close -r done >/dev/null
check 'close: Done, marks off' "$(who TASK-1)" 'Done|'
check 'close: claim file gone' "$(ls "$C" | grep -c aaaa)" '0'
check 'close: no holder left' "$(A r1 held)" 'no session holds a task'

# A gone holder's task goes back to To Do, once. A hand-set one stays, also when set again after the free.
up cccc3333-0 3
as cccc3333-0 r1 claim TASK-2 >/dev/null
rm "$HOME/.claude/sessions/3.json"
age cccc3333-0 3
backlog task edit TASK-3 -s 'In Progress' >/dev/null
check 'sweep reports the hand-set task' "$(A r1 sweep 2>/dev/null)" 'In Progress, no session holds it (set by hand? the sweep leaves it): TASK-3'
check 'sweep freed the gone holder' "$(who TASK-2)" 'To Do|'
check 'hand-set task stays' "$(who TASK-3)" 'In Progress|'
backlog task edit TASK-2 -s 'In Progress' >/dev/null
A r1 sweep >/dev/null 2>&1
check 'set again by hand after the free: stays' "$(who TASK-2)" 'In Progress|'

# A crash leaves the session file; its pid is gone. The claim does not hold forever.
up eeee5555-0 5 999999
as eeee5555-0 r1 claim TASK-4 >/dev/null
age eeee5555-0 3
A r1 sweep >/dev/null 2>&1
check 'crashed session (stale running list): freed' "$(who TASK-4)" 'To Do|'

# Race: C sweeps while A's claim is mid board write. The lock makes the sweep wait; it sees the claim.
up cccc3333-0 3
touch "$T/slow"
A r1 claim TASK-5 >/dev/null &
sleep 1.5
rm "$T/slow"
as cccc3333-0 r1 sweep >/dev/null 2>&1
wait
check 'sweep during a slow claim keeps the claim' "$(who TASK-5)" 'In Progress|@peers:cc-aaaa'

# Race: two sessions claim one task at once. Both marks land.
up bbbb2222-0 2
A r1 claim TASK-4 >/dev/null &
B r1 claim TASK-4 >/dev/null &
wait
check 'two claims at once: both marked' "$(who TASK-4)" 'In Progress|@peers:cc-aaaa,@peers:cc-bbbb'

# A claim the board refuses: the claim before it stands.
check 'failed claim says why' "$(A r1 claim TASK-99 2>&1 | grep -c 'TASK-99 not claimed')" '1'
check 'failed claim keeps the old claim' "$(node -p "require('$C/aaaa1111-0.json').ticket")" 'TASK-4'
check 'no lock left behind' "$(ls -a "$C" | grep -c '^.lock$')" '0'
# A killed command left its lock: a dead pid frees it.
mkdir "$C/.lock" && echo 999999 >"$C/.lock/pid"
check 'a dead holder frees the lock' "$(A r1 claim TASK-6)" 'claimed TASK-6'
exit $fails
