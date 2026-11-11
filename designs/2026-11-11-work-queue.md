# Work queue (WA-1308)

## Goal

William plans work in one session and hands tasks to others. Today the order lives only in each session's chat: compaction blurs it, a restart loses it, the board does not show it, and he must message a session to change it. William 11-11: make it an explicit queue; per topic or global; pins to one session as metadata; the hand-off message "well designed", no needless messages, never missed (at least once), exactly once if we can.

Target state:

- One ordered work queue in peers. Each item: a task, a lane, an optional pin.
- A session that serves a lane gets its next task by itself when it is idle and holds no task.
- Each task goes to exactly one session. That session's model reads it once (one rare exception: Delivery).
- The board shows what is queued, and for which lane or session.
- No session sends another a message to make this work.

## Terms

- **Session**: one Claude Code (or Codex, Cursor) chat. Its name is the one `/rename` gave it; its id changes on `/resume`.
- **Mod**: the peers plugin code that runs inside each Claude Code session (`hooks/register.tsx`).
- **Board**: the task tracker (Backlog.md here; Jira and GitHub Issues are also supported). Columns To Do, In Progress, Done.
- **Claim**: a session's record that it holds a task, `~/.claude/peers-claims/<session>.json`: its current task and `also` (other held tasks).
- **Lock**: the one peers lock (`~/.claude/peers-claims/.lock`, "board lock" in error text). Every claim write takes it.
- **Sweep**: `peers sweep` (also run by `ready`, `unclaim`): sets board In Progress to the live claims; a dead session's task goes back to To Do.
- **View server**: the local peers server (127.0.0.1:6421). It watches the claim folder, the session files and the ledgers, and sends an event on `/events` on each change.
- **Work queue**: the new thing. (Board comments from older peers say "back to the queue" for To Do: `QUEUE_TEXT` in `lib/claims.mjs`. It stays: GitHub and Jira replay those comments.)
- **Lane**: a free word for a topic (`sop`, `ui`). `main` when none is given.
- **Pin**: an item meant for one session, by its exact `/rename` name.
- **Serve**: a session's choice to take items of some lanes.

## What exists

- Claims and the lock: above. `peers close` moves the session to its next `also` task, else deletes the claim file (`bin/peers.mjs:259`).
- The mod wakes on the view server's event stream and on a 2 s tick (one read in 15 while the stream is up).
- Each running session's file gives `status` (busy, idle) and `waitingFor` (a question or a permission prompt it waits on) (`lib/io.mjs:80-117`).
- The engine lets a mod:
  - `$.prompt.submit({ text })`: a prompt into its own session, run once the session is idle. It resolves when the prompt has entered and its turn started (or queued behind the running turn), or with `{ drop }`.
  - `$.prompt.read()`: the prompt box draft.
  - `$.session.messages()`: its own transcript, newest 4096 entries.
  - `turn.start`, `turn.complete` events.

## Options

### Where the queue lives

| | Truth | Pro | Con |
|---|---|---|---|
| **Q1. peers file**, board mirrors | `~/.claude/peers-claims/queue.json` under the lock | Same model as claims: the file is the truth, the board follows. Atomic take under the lock claims already use. The view server already watches that folder. | A hand edit on the board does not change the queue. |
| Q2. the board | Backlog labels and `ordinal` | One store. | A take is read, then write: two sessions can take one task unless peers holds a lock anyway, and then the lock is the truth. Jira and GitHub order tasks in different ways. |

### How a session gets its next task

| | How | Pro | Con |
|---|---|---|---|
| D1. push | The queueing session sends a cross-session message | Exists today. | Needs the receiver at queue time. A message to a busy session waits, and a later task can overtake it. A dead receiver loses it. A resend cannot know if the first arrived: no exactly once. |
| **D2. pull, submit** | The receiver's own mod takes the head item and submits it as a prompt into its own session | No message between sessions. Arrives only when the receiver is ready. The receiver's transcript is its own record of what it read. | Only sessions with the mod (Codex and Cursor: `peers next` by hand). The model sees "The peers plugin sent a message". |
| D3. pull, suggest | The mod puts the task in the box as a dim suggestion (`$.prompt.suggest`); William presses Tab | William sees each start. | Needs William at each session: fails "by itself". Shows nothing while a turn runs. Later, as `serve --suggest`, if he wants it. |

## Priorities, in order

1. A task is never lost and never done twice.
2. The board shows the queue.
3. No needless prompts or messages. Never interrupt a session that is working or that William is talking to.
4. Survives compaction, restart, `/resume`, rename.
5. Few new parts.

## Choice: Q1 + D2

Q2 fails 1 without a lock in peers. D1 fails 1 and 3. D3 fails the goal.

## Design

### Files (all under `~/.claude/peers-claims/`, written under the lock, tmp then rename)

`queue.json`, the order is the array:

```json
{ "items": [ { "task": "WA-1310", "title": "...", "lane": "sop", "pin": null, "by": "peers dev", "at": 1762870000000 } ] }
```

`serve/<session>.json`: `{ "session": "...", "lanes": ["sop"] }` (`"lanes": "*"` for all). Apart from the claim, as a session with no task has no claim file. `/resume` moves it with the claim (`lib/core.mjs` `rename`). The sweep deletes it for a session no longer running.

The claim of a task taken from the queue carries the item and its delivery:

```json
"queued": { "item": { "task": "WA-1310", "lane": "sop", "pin": null, ... }, "id": "q-WA-1310-1762870000000", "told": false }
```

It lives and moves with the claim, so `/resume` keeps it.

### Commands

```
peers queue                                     the items in order, with lane, pin, and which live sessions serve each lane
peers queue add <id...> [--lane L] [--pin S] [--top | --after <id>]
peers queue rm <id...>
peers serve [L...]                              this session takes queued work: lanes L, or every lane
peers serve --off
peers next [--json]                             take the head item for this session now
```

- `add` checks that the task exists and is To Do and no session holds it. An id already queued moves to the new place.
- `--pin S`: S is an exact `/rename` name. `add` refuses when two running sessions share it, or when S is an id (ids change on `/resume`).
- `peers queue` says when no live session serves a lane, or a pinned session is not running.
- `peers next --json`: `{ "task", "title", "lane", "pin", "id" }`, or `null`.
- `peers ready` marks queued tasks (`queued: sop`, `queued for <name>`): a session picks from the rest.
- `peers claim` of a queued task takes it out of the queue in the same lock. No task is in the queue and claimed at once.
- `peers unclaim` of a task with `queued` puts the item back at the head of the queue.

### Who takes what

Session S may take item i when i is pinned to S's name, or i has no pin and S serves i's lane. A pin reaches its session whether it serves or not: a pin is an explicit hand-off. `next` takes the first item S may take.

### Delivery

**Task to exactly one session.** `peers next` runs under the lock. It reads the queue, takes the first item S may take, writes S's claim with `queued` (`told: false`) and writes the queue without the item. Two sessions can never take one item. The board edit (In Progress, labels off) goes after the lock through the outbox (`lib/actions.mjs`), as other board writes do: the lock never waits on the board. The mod's `next` waits at most 2 s for the lock; on a timeout it tries again on the next wake.

**Prompt read once.** The mod, on each wake (view server event, tick, `turn.complete`, `session.start`):

1. Gate. All of these:
   - no submit of its own in flight (an in-memory id, set before submit, cleared when submit resolves);
   - the session file says `idle` and `waitingFor` is empty;
   - the prompt box is empty;
   - at least `queueQuietSec` (default 60) since the last `turn.complete`, so a reply William reads is not covered over;
   - and either the claim has `queued.told: false`, or the session holds no task and an item waits that it may take (it serves, or a pin).
2. Take, if no `queued.told: false` waits: `peers next --json`. `null`: stop.
3. Submit: `$.prompt.submit({ text })`. The text: `[peers work queue q-WA-1310-…] WA-1310: <title>. Queued by <by>, lane <lane>. Read it (backlog task view WA-1310 --plain) and do it.`
4. On `{ text }`: `peers next --told <id>` sets `told: true`. On `{ drop }`: nothing; the next wake tries again.

After a mod restart (reload, crash), a claim with `told: false` may be a prompt that entered before the mark. Before it submits again, the mod looks for the id in `$.session.messages()`. Found: it marks `told`, no prompt. One case gives a second prompt: the mod restarts after the prompt entered and before the mark, and a compaction removes the id before the next wake. The window is one tool call wide; the text says "If you already have this task, ignore this."

`close` does not take an item: the turn ends, and the mod hands over the next one after the quiet time. One path, one check.

### Failure cases

| Case | What happens |
|---|---|
| Mod crash after take, before submit | `told: false`; the gate passes on it; the transcript check finds nothing; it submits. |
| Mod crash after submit, before mark | The transcript check finds the id: marked, no second prompt. |
| Session dies holding a queued task | The sweep frees the claim. The item goes back to the head of the queue (from `queued.item`), not loose to To Do. This is after the 2 h grace a closed session gets to come back (`GRACE`, `lib/claims.mjs`). |
| `/resume` (new id) | The claim and the serve file move to the new id. Pins are by name: they still match. |
| Pinned session not live | The item waits. `peers queue` says so. |
| No live session serves a lane | `peers queue` says so. |
| William talks to a serving session | No prompt while a turn runs, a question waits, the box holds a draft, or within the quiet time. |
| Lock held by a long `commit` or `sweep` | `next` gives up after 2 s; the next wake tries again. |
| Board write fails | The outbox sends it again (as today). The queue file stands. |

### Board mirror (Backlog only)

On add: labels `queued`, `lane:<L>`, and `pin:<name>` when pinned. On take: the labels go, the task goes In Progress. On rm: the labels go. Through the outbox, after the lock. An optional `queue(id, labels)` in the board contract (`lib/board.mjs` `CONTRACT.more`); boards without it get no mirror. The view server shows the order.

## Non-goals

- One machine. `queue.json` is per Mac; another machine's sweep leaves the labels.
- Delivery by itself for Codex and Cursor sessions (no mod): they run `peers next`.
- Order on the board (`ordinal`): one git commit per task per move.
- Jira and GitHub label mirror.
- A broker (NATS, Redis Streams, a Postgres queue): one Mac, a few dozen items. The hard parts (the board, waking a session) are not what a broker does, and it would be a second store.
- Priority classes, deadlines, retry backoff.

## Risks

- The model reads "The peers plugin sent a message" and may give the task less weight than William's words. `asUser` would remove the frame but would hide that the queue, not William, sent it. The text names the task and who queued it.
- A session that serves starts work William did not watch. Only sessions that ran `peers serve`, or got a pin, get prompts.
- A plain-text question at the end of a reply is not a `waitingFor`. The quiet time covers the case where William answers within it. He can stop it with `peers serve --off`.

## Measure

- Two scripted sessions: queue three tasks in two lanes. Each gets only its lane, one prompt per task, in order.
- Kill the mod between take and submit, and between submit and mark: one prompt in each case.
- Two sessions on one lane take at once: no task twice.
- A `peers claim` of a queued task removes it from the queue.
- The model starts the task from a plugin-submitted prompt.

## Log

- 2026-11-11: William: queue per topic or global; pins as metadata; at least once, exactly once if we can. Chosen: Q1 + D2.
- 2026-11-11: goldfish review: 36 findings, 22 applied, 14 rejected (API missing: it exists; queue changes not signalled: the view server watches the folder; in-band `close` take dropped instead of fixed; `seq` skip, `move`, error strings, Jira/GitHub mirror cut). Open: none.
