# Nested compaction with peek-back (WA-1271)

2026-11-10. William: "nested compaction with the ability to peek back, for our own agents and for Claude Code sessions". Later: "leave it a bit decoupled from peers".

## Goal

A long session keeps a small context. Each compaction adds one short part to a ladder of parts. No part is summarized again and again. The model can open any part and read the full text.

## What the research found

1. **We own no agent loop that grows a conversation.** No code in engine, wren or autobrowse holds a `messages` array with `tool_use` turns. `engine/packages/models` makes single calls. The Wren agent panel (`wren/packages/agent/src/relay.ts`) and `models/src/command.ts` start a `claude` child. So "our agents" and "Claude Code sessions" are the same host. The task's step 1 (an adapter in the models package) has no caller. autobrowse's explorer (`autobrowse/src/agent/explorer.ts`) is its own loop, but it builds each prompt from the last steps and stops at 25: nothing to fold.
2. **Claude Code gives one seam to rewrite the conversation:** the `session.compact` event of the mod API. A hook gets the transcript, can change what the summarizer reads and is told, and returns any message list. A message returned with its `handle` stays byte for byte. `turn.step` pins the messages, so a mod cannot fold on each request.
3. **acp-kernel (the fold planner of billion-context, MIT) folds on each request.** `processTurn` rebuilds the visible messages every turn, and the model calls a `compress` tool with ranges. That needs a loop we own or a proxy between Claude Code and the API. Its 19k lines are mostly wire safety for many hosts: tool pairs, reasoning pairs, lenient argument parsing.
4. **A stable block prefix saves little here.** The parts total at most ~8k tokens. The system prompt and tools (~30k) are cached already. The gain of a ladder is fidelity and peek-back, not cache hits.

## Options

| | A. Ladder in the compaction mod | B. Same seam, acp-kernel as planner | C. Local proxy on acp-kernel | D. Leave as is |
|---|---|---|---|---|
| How | `session.compact` hook keeps earlier parts word for word, adds one part, saves the folded text to a file | Map `SessionMessage` to `CoreMessage`, call `applyCompression` and `processTurn` at each compaction | `ANTHROPIC_BASE_URL` to our proxy; fold on each request | compact-focus 0.3.0 + `peers recall` |
| Folds | at compaction | at compaction | each request | at compaction |
| Old summaries | written once from the full text | written once | written once | summarized again at each compaction |
| Peek-back | Read or Grep one file per part | `decompress` + our store | `decompress`, `search` | `peers recall` (needs peers) |
| New code | ~150 lines in one mod | adapter + 19k lines pinned and read | proxy + adapter + 19k lines | none |
| Risk | engine changes the event (guarded: pass through) | the kernel plans per turn; we call it once per ~200k tokens, so most of it is dead weight | subscription traffic through a proxy that rewrites requests: terms are grey; Claude Code's token counts no longer match the wire; its own compaction must be off | old detail fades |
| Saves tokens | same as D at one trigger; lets the trigger go lower safely | same as A | most: folds tool output early | base |

"Our own from the paper" (the task's third option) is A: the paper's ideas that fit the seam (parts written once, young parts merged into an old one, unfold), without the per-turn planner.

## Priorities, in order

1. Stay inside Claude Code's supported API. No proxy on the subscription.
2. Keep what was said: rules and state must not fade.
3. Tokens per request.
4. Code small enough to read in full.
5. No tie to peers.

## Choice: A

B adds a large dependency to make one decision per compaction. C wins on tokens only, and loses on priority 1. On an API key the terms problem goes (Wren agent children already pass a gate, `wren/packages/egress`), but Claude Code's token counts still would not match the wire and its own compaction must be off. D fails priority 2.

Pushback kept: the task says "on acp-kernel". The kernel does not fit a host that folds only at compaction, and we have no other host. If we later write our own agent loop, B's adapter is the right tool there, and the audit of the kernel done for WA-1270 stands.

## Design

One mod, `compact-focus` 0.4.0, experimental: on by default, `COMPACT_LADDER=off` folds as 0.3.0 did (William 11-10: "togglable on and off, and on for now"). It moves to the engine package `@wrenautomation/compaction` (WA-1287; William chose it over a folder in wren and wj_skills). `hooks/ladder.ts` holds the pure functions (plain messages in and out, tested alone). `hooks/register.tsx` is the Claude Code hook.

After a compaction the conversation reads, oldest first (0.5.0, WA-1304):

```
[recap]  one user message: a header line, then RULES, NOW, DONE (this fold), its file,
         then each earlier fold's file and DONE lines, oldest first. Rebuilt each fold.
[tail]   the newest messages, word for word.
```

0.4.0 left three to ten messages in the user's voice (parts, the engine's summary with its "continue without asking" prose, a pointer). William 11-11: they dilute his instructions. So 0.5.0:

- **One recap message** in place of parts, summary and pointer. Its header says it is not typed by the user and that its RULES are the user's.
- **Rules first**, in the recap, not in the system prompt. The system prompt was the other option (a `prompt.compose` section): more weight, but a summarizer error then carries system weight, and the rules need a second home. William left it to me; one place won.
- **No engine prose.** The hook keeps the summary from its first heading to END and the engine's `<system-reminder>` blocks (its tool record); the wrapper lines go.
- **No KEYS.** DONE lines carry the rare words a search needs.
- **Re-read files as one line.** After a fold the engine attaches again each file read before it (a `file` attachment, 7k tokens in one session). A `prompt.attachment` hook replaces each with "<path> was read before the last compaction". A file the user @-mentioned (`prompt.mention`) keeps its text. Skill bodies (`invoked_skills`) stay whole: their rules still hold mid-task.
- **Move-over.** A session with 0.4.0 parts and pointer reads them as earlier folds at its next fold.

- **Now and Rules roll.** Each compaction writes them new: every rule that still stands, in the user's words, and one current state. So no stale "Now" and no rule that a later one reversed.
- **Done and Keys freeze.** At the next compaction the hook (no model) cuts DONE and KEYS out of the old index and makes a part of them, with the pointer's file in its marker. The summarizer is told: the parts are done; write DONE and KEYS only for the work after the last index.
- **Part file.** Each compaction writes the messages it folds (after the old pointer, before the tail) to `~/.claude/compact-parts/<session id>/<time>.md` as plain text: role, text, tool calls, tool results. It is a copy of what the session's `.jsonl` already holds, in a form Read and Grep can use. No new exposure.
- **Marker.** `[Folded part. Full text: <file>. Grep <folder> for any detail of earlier work.]` The markers are the only state. Resume, fork and reload need no store.
- **Cap, no model merge.** Parts get their own cap: 8 parts or 6k tokens. Over it, the oldest parts shrink to their marker lines in one message. A summary is never summarized. `BUDGET` (8k) covers the index and the tail only.
- **Precompute** gets the same instructions (they do not depend on the messages), so a reused summary follows the ladder. The tail and the pointer are added only at the real compaction.
- **Peek-back** uses the built-in Read and Grep. No new tool, no peers. `peers recall` still works on the raw transcript; the mod text no longer names it.

**Guards.** No handles, or no new message from the engine: the engine's result passes through. An index with no `DONE:` line freezes whole. No old index found: the fold works as 0.3.0 did. A failed file write does not stop the compaction; the marker then names no file.

## Risks

- The summarizer restates old parts in spite of the instruction. The measure run checks it.
- The engine may hand the hook only the newest messages of a very long transcript. Then old parts leave the context; their files stay, and each marker names the folder.
- Read outside the working folder may ask for permission. The measure run checks it.

## Measure

Headless Haiku session, three `/compact` runs:

1. Part 1 is byte for byte the same after runs 2 and 3.
2. A rule given before run 1 is in RULES after run 3.
3. The index after run 3 does not restate part 1's Done lines.
4. A part file holds a word that no index holds, and Grep finds it.
5. Tokens before and after each run.
6. A session that starts from a 0.3.0 summary (no marker) folds without error.

## Measured (2026-11-10, 0.4.0)

Headless Haiku, three `/compact` runs, 7 unit tests pass.

- Two frozen parts after run 3, each with its file; the hook cut DONE and KEYS at the `END` line.
- "never deploy on Fridays", given before run 1, is in RULES after run 3. Now and Rules are in the newest index only.
- The first run let Haiku restate part 1's Done lines in part 2. A boundary sentence (DONE and KEYS cover only the messages after the last pointer line) stopped it for Done. Haiku still repeats some Keys.
- Grep on the folder found `FTS5` in the first part file. No index held the full sentence.
- Tokens per run: 29.2k → 7.7k, 29.6k → 9.1k, 30.0k → 8.1k. Most of what is left is the system prompt.
- Not measured: the summarizer's cache share (the stream gives no usage for it), a precompute reuse (needs a ~207k session), and the Read permission in a normal session (the run allowed Grep and Read).

## Not built

- The proxy (C). Open again only if Anthropic's terms allow a rewriting proxy on a subscription.
- An adapter in `engine/packages/models`. No loop to serve.
- A `session.append` hook that moves large tool output to a file as it arrives. The engine already spills big results to `tool-results/`. A separate task if a measure shows tool output fills the window.

## William decides

- **Wren agent children.** They compact (`wren/packages/agent/src/launch.ts` copies the compact windows) but do not load this mod: they run with `--setting-sources ""` and take plugins only from `setup.plugins`. To reach them the mod must live in git and ship as a package or a folder in wren. Recommend: publish it from a git repo, then add it to the setups. Task WA-1287. Until then the ladder covers terminal sessions only.
- **The trigger.** It stays at ~207k (`autoCompactWindow` 240000 less the engine's 33k buffer, measured 10-26). With a ladder, a lower one (the setting's floor is 100000) costs less per request and loses less per fold, but each fold is one summary request and one cold rewrite of the tail.

## Log

- 2026-11-10: goldfish review: 29 findings, 17 applied, 12 rejected; open: Wren agent children, the trigger. Applied: precompute follows the ladder; no model merge (a merge would summarize summaries); Now and Rules roll, Done and Keys freeze; parts have their own cap; files named by time; three more measure cases. Rejected: secrets in part files (the `.jsonl` holds the same text), a glossary, unit-case lists in the doc.
- 2026-11-11: 0.5.0 (WA-1304): one recap message, rules first, no KEYS, no engine prose, re-read files as one line. Proof: headless Haiku, two folds: the rules, both folds' DONE and the codeword held; with the stricter boundary line the second DONE no longer copied the first; an @-mentioned file kept its text.
