#!/bin/sh
# peers check end to end: the real CLI on a throwaway HOME. The gate runs in place with this session's files in
# PEERS_FILES; a failure only in a peer's file does not fail the check; one in yours, or with no file named, does.
set -e
peers="$(cd "$(dirname "$0")/.." && pwd)/bin/peers.mjs"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME="$T/home" GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
unset CLAUDE_CODE_SESSION_ID BACKLOG_CWD
mkdir -p "$HOME/.claude/sessions" "$HOME/.claude/peers" "$T/r/src"
echo "{\"pid\":$$,\"sessionId\":\"aaaa1111-0\"}" >"$HOME/.claude/sessions/1.json"
echo "{\"pid\":$$,\"sessionId\":\"bbbb2222-0\"}" >"$HOME/.claude/sessions/2.json"
# The gate: prints the files it got, then fails with whatever $T/fail holds (a file:line mark, or nothing).
cat >"$T/gate.sh" <<G
printf 'files: %s\n' "\$(printf '%s' "\$PEERS_FILES" | tr '\n' ' ')"
[ -s "$T/fail" ] || exit 0
cat "$T/fail"; exit 1
G
echo "{\"check\":\"sh $T/gate.sh\"}" >"$HOME/.claude/peers/config.json"
cd "$T/r" && git init -q && echo 'const first = the original line of a' >src/a.ts && echo 'const second = the original line of b' >src/b.ts && git add . && git commit -qm init
fails=0
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: got [$2], want [$3]"; fails=$((fails + 1)); fi; }
A() { PEERS_SESSION=aaaa1111-0 node "$peers" "$@"; }
B() { PEERS_SESSION=bbbb2222-0 node "$peers" "$@"; }
echo 'const first = a line session A wrote' >src/a.ts && A take src/a.ts >/dev/null
echo 'const second = a line session B wrote' >src/b.ts && B take src/b.ts >/dev/null
check 'check: the gate gets your files, not the peer'"'"'s' "$(A check | grep '^files:')" 'files: src/a.ts'
: >"$T/fail"; A check >/dev/null; check 'check: a green gate passes' "$?" '0'
echo 'src/b.ts:1:7 lint/style error' >"$T/fail"
set +e
out=$(A check); rc=$?
check 'check: a failure only in the peer'"'"'s file passes' "$rc" '0'
check 'check: and names the owner' "$(echo "$out" | grep -c 'src/b.ts (cc-bbbb)')" '1'
echo '@x/pkg:typecheck: src/a.ts(1,7): error TS2305' >"$T/fail"; A check >/dev/null; check 'check: a failure in your file fails (tsc form, package path)' "$?" '1'
printf 'src/b.ts:1:7 x\nsrc/a.ts:1:1 y\n' >"$T/fail"; A check >/dev/null; check 'check: yours plus theirs fails' "$?" '1'
echo 'something broke' >"$T/fail"; A check >/dev/null; check 'check: a failure with no file named fails' "$?" '1'
echo 'src/c.ts:3:1 committed code' >"$T/fail"; A check >/dev/null; check 'check: a failure in committed code fails' "$?" '1'
set -e
check 'check: no worktree' "$(ls "$HOME/worktrees" 2>/dev/null | wc -l | tr -d ' ')" '0'
[ "$fails" = 0 ] && echo "all ok" || { echo "$fails failed"; exit 1; }
