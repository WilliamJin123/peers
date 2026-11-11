#!/bin/sh
# peers check end to end: the real CLI on a throwaway HOME. Checks that the gate sees HEAD plus this session's
# uncommitted hunks, never a peer's, needs no commit first, and that two checks at once take turns.
set -e
peers="$(cd "$(dirname "$0")/.." && pwd)/bin/peers.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home" GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
unset CLAUDE_CODE_SESSION_ID BACKLOG_CWD
mkdir -p "$HOME/.claude/sessions" "$HOME/.claude/peers" "$T/r"
echo "{\"pid\":$$,\"sessionId\":\"aaaa1111-0\"}" >"$HOME/.claude/sessions/1.json"
echo "{\"pid\":$$,\"sessionId\":\"bbbb2222-0\"}" >"$HOME/.claude/sessions/2.json"
# The gate: print both files; a run marks its start and end so overlap shows.
cat >"$HOME/.claude/peers/config.json" <<'J'
{"check":"echo start >>../log; sleep 1; sed 's/^[^=]*= //' a b; echo end >>../log"}
J
cd "$T/r" && git init -q && echo 'const first = the original line of a' >a && echo 'const second = the original line of b' >b && git add a b && git commit -qm init
fails=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2], want [$3]"; fails=$((fails + 1)); fi; }
A() { PEERS_SESSION=aaaa1111-0 node "$peers" "$@"; }
B() { PEERS_SESSION=bbbb2222-0 node "$peers" "$@"; }
echo 'const first = a line session A wrote' >a && A take a >/dev/null
echo 'const second = a line session B wrote' >b && B take b >/dev/null
check 'check: your hunks in, the peer'"'"'s out, no commit' "$(A check | tail -2 | tr '\n' ' ')" 'a line session A wrote the original line of b '
check 'check: the peer sees its own, not yours' "$(B check | tail -2 | tr '\n' ' ')" 'the original line of a a line session B wrote '
check 'check: the shared tree is untouched' "$(sed "s/^[^=]*= //" a b | tr '\n' ' ')" 'a line session A wrote a line session B wrote '
check 'check: HEAD did not move' "$(git log --oneline | wc -l | tr -d ' ')" '1'
rm -f "$HOME/worktrees/log"
A check >/dev/null & B check >/dev/null; wait
check 'check: two at once take turns' "$(tr '\n' ' ' <"$HOME/worktrees/log")" 'start end start end '
[ "$fails" = 0 ] && echo "all ok" || { echo "$fails failed"; exit 1; }
