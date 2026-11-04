#!/usr/bin/env bash
# Live check of the GitHub board: a private throwaway repo, one issue, then ready, claim, commit, close through the real CLI.
# Needs gh signed in with the repo and delete_repo scopes. The repo is deleted at the end, pass or fail.
# A throwaway HOME holds the board config and the ledger: the real ~/.claude/peers stays as it is.
#   scripts/smoke-github.sh [owner]
set -euo pipefail

PEERS="$(cd "$(dirname "$0")/.." && pwd)/bin/peers.mjs"
OWNER="${1:-$(gh api user -q .login)}"
REPO="$OWNER/peers-smoke-$(date +%s)"
REAL_HOME="$HOME"
T="$(mktemp -d)"
FAILS=0

ok() { echo "ok   $1"; }
bad() { echo "FAIL $1${2:+: $2}"; FAILS=$((FAILS + 1)); }
want() { if grep -q -- "$2" <<<"$3"; then ok "$1"; else bad "$1" "no '$2' in: $3"; fi; }

cleanup() {
  gh repo delete "$REPO" --yes >/dev/null 2>&1 || echo "note: delete $REPO by hand (gh repo delete $REPO)"
  rm -rf "$T"
}
trap cleanup EXIT

# gh and git keep the real login and identity; peers sees only the throwaway HOME.
# The keychain lookup follows HOME: take the token before HOME moves. Never printed.
export GH_TOKEN="${GH_TOKEN:-$(gh auth token)}"
export GIT_CONFIG_GLOBAL="$REAL_HOME/.gitconfig"
export HOME="$T/home" PEERS_SESSION="smoke-$$"
mkdir -p "$HOME/.claude/peers"
printf '{ "board": "github", "github": { "repo": "%s" } }\n' "$REPO" >"$HOME/.claude/peers/config.json"
peers() { node "$PEERS" "$@"; }

gh repo create "$REPO" --private --add-readme >/dev/null
ok "repo $REPO"
gh issue create --repo "$REPO" --title "Smoke task" --body $'Steps:\n- [ ] the box' >/dev/null
gh issue create --repo "$REPO" --title "Other task" --body "" >/dev/null

git clone -q "git@github.com:$REPO.git" "$T/repo"
cd "$T/repo"

want "ready lists open issues" "#1 - Smoke task" "$(peers ready)"
want "claim takes a bare number" "claimed $REPO#1" "$(peers claim 1)"
v="$(gh issue view 1 --repo "$REPO" --json labels,assignees -q '[.labels[].name, .assignees[].login] | join(",")')"
want "claim labels the issue" "in progress" "$v"
want "claim assigns me" "$(gh api user -q .login)" "$v"
want "ready leaves the claimed one out" "^#2 - Other task$" "$(peers ready)"

echo "smoke line one" >a.txt
peers take a.txt >/dev/null
peers commit -m "Smoke change" >/dev/null
SHA="$(git rev-parse HEAD)"
want "commit trailer names the issue" "Ticket: $REPO#1" "$(git log -1 --format=%B)"
git push -q origin HEAD
want "commit comments its sha" "${SHA:0:7}" "$(gh issue view 1 --repo "$REPO" --json comments -q '.comments[].body')"

if peers close -r "smoke" >/dev/null 2>&1; then bad "close refuses an unticked box"; else ok "close refuses an unticked box"; fi
gh issue edit 1 --repo "$REPO" --body $'Steps:\n- [x] the box' >/dev/null
want "close closes" "closed $REPO#1" "$(peers close -r "smoke")"
v="$(gh issue view 1 --repo "$REPO" --json state,labels,comments -q '[.state, (.labels[].name), .comments[-1].body] | join(",")')"
want "issue is closed" "CLOSED" "$v"
want "close comments the reason and sha" "Done: smoke (${SHA:0:7})" "$v"
if grep -q "in progress" <<<"$v"; then bad "close takes the label off" "$v"; else ok "close takes the label off"; fi

# GitHub links the pushed commit on the issue from its trailer, with some lag.
for _ in $(seq 1 15); do
  got="$(gh api "repos/$REPO/issues/1/timeline" -q '.[] | select(.event == "referenced") | .commit_id')"
  grep -q "$SHA" <<<"$got" && break
  sleep 2
done
want "issue timeline links the commit" "$SHA" "$got"

echo
[ "$FAILS" = 0 ] && echo "smoke: all passed" || { echo "smoke: $FAILS failed"; exit 1; }
