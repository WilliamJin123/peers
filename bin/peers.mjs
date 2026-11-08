#!/usr/bin/env node
// peers: git scoped to the files this agent session touched.
// Ledger: ~/.claude/peers/<encodeURIComponent(repo root)>/<session>.json, written by the peers mod (Claude Code)
// or by `peers hook <agent>` (Codex, Cursor), both through lib/core.mjs.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname, userInfo } from 'node:os'
import { basename, join } from 'node:path'
import { actions } from '../lib/actions.mjs'
import { CLAIMS, compact, holding, isLive, joinEntry, nameOf, overlay } from '../lib/core.mjs'
import { boardOf } from '../lib/board.mjs'
import { awayLines, claimsOf, fromLedgers, heldLines, holderName, holdersOf, plan, whoOf } from '../lib/claims.mjs'
import { claimsSync, configSync, namesSync, runningSync } from '../lib/io.mjs'
import { slash, winOf } from '../lib/path.mjs'
import { platform } from '../lib/platform.mjs'
import { applyHunks, delta, keys, owner, parseDiff, statusPaths } from '../lib/lines.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const usage = `peers status | diff [--who [file...]] | commit -m "msg" [--whole] [-- paths] | take <file...> | drop <file...> | check | ls | ready | held | sweep | claim <task> | close [-r reason] [--force] | log [n] | files | view [match...] | tui [match...]
Scope: the files this session edited (ledger kept by the peers mod). In a file a peer also edits, only your hunks
(--whole takes the file as it is). held: who holds each task (from the ledgers). sweep: the board's In Progress, held to the
ledgers (ready runs it too). Tasks: Backlog.md by default (\`backlog\` on PATH), or Jira, GitHub Issues or your own module: README, Task boards.
view: a live page (127.0.0.1:6421) of every session's uncommitted edits, each in its author's color; /peers-view shows it in a pane.
tui: the same view full screen in any terminal (no agent session needed).
  match: only the repos it names. A path (., ../lander, ~/x) is that folder; a name is a repo name, part of one,
  or a folder in the path (wren_automation = every repo in it). Same words in /peers-view <match...>.
  view --install [--host <public host>] keeps it up (launchd, systemd or the Windows Startup folder); view --uninstall stops that.
  doctor checks node, git, the shim, PATH, the server's version, the supervisor and the board.
Other agents: peers install codex|cursor [--project] [--uninstall] adds the hooks; the agent runs peers hook <agent>.
Output: one summary line; -v lists each file, --json (status, take) prints one object. A file list may be - (read from stdin).
Env: PEERS_SESSION overrides the session id.`

if (!cmd || cmd === '-h' || cmd === '--help') die(usage, 0)
if (cmd === 'hook') {
  const { handle } = await import('../lib/hook.mjs')
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  // A hook must never stop the agent: any failure answers "go on".
  let out = {}
  try {
    out = (await handle(argv[1], JSON.parse(input), { home: homedir() })).out
  } catch (err) {
    process.stderr.write(`peers hook: ${err?.message ?? err}\n`)
  }
  process.stdout.write(JSON.stringify(out) + '\n')
  process.exit(0)
}
if (cmd === 'install') {
  const { AGENTS, install } = await import('../lib/hook.mjs')
  if (!AGENTS[argv[1]]) die(`peers install: one of ${Object.keys(AGENTS).join(', ')}`)
  let root
  if (argv.includes('--project')) root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const path = install(argv[1], { home: homedir(), root, remove: argv.includes('--uninstall') })
  console.log(`${argv.includes('--uninstall') ? 'removed from' : 'hooks in'} ${path}`)
  process.exit(0)
}
if (cmd === 'doctor') process.exit(await (await import('../lib/doctor.mjs')).doctor())
const session = process.env.PEERS_SESSION || process.env.CLAUDE_CODE_SESSION_ID || (await import('../lib/hook.mjs')).findSession(homedir())
if (cmd === 'tui') await (await import('../lib/tui.mjs')).tui()
if (cmd === 'view') {
  await (await import('../lib/view.mjs')).view()
  if (!argv.includes('--serve')) process.exit(0)
  await new Promise(() => {}) // the server runs until stopped
}
if (!session) die('peers: no session id. Run it from an agent session (Claude Code, or one with peers install), or set PEERS_SESSION.')

const root = (() => {
  try {
    return slash(git(['rev-parse', '--show-toplevel']).trim(), winOf(homedir()))
  } catch {
    die(`peers: ${process.cwd()} is not in a git repo. cd into the repo you work in.`)
  }
})()
// Ledger paths are relative to the root: run every git call from there.
process.chdir(root)
const dir = join(homedir(), '.claude', 'peers', encodeURIComponent(root))
const own = join(dir, `${session}.json`)
// The action log and the board's outbox: lib/actions.mjs.
const act = actions(join(dir, `${session}.actions.jsonl`))

// Output like git's oneline: a summary line by default, each file under -v, a JSON object under --json.
const FLAGS = new Set(['-v', '--verbose', '--json'])
const verbose = argv.includes('-v') || argv.includes('--verbose')
const asJson = argv.includes('--json')
// Paths from args; `-` reads more from stdin, one per line: `git diff --name-only | peers take -`.
function pathsOf(list) {
  const out = []
  for (const a of list) {
    if (FLAGS.has(a)) continue
    if (a === '-') out.push(...readFileSync(0, 'utf8').split('\n').map(s => s.trim()).filter(Boolean))
    else out.push(a)
  }
  return out.map(p => slash(p, winOf(p)).replace(/^\.\//, ''))
}
const few = (xs, n = 3) => xs.slice(0, n).join(', ') + (xs.length > n ? ` and ${xs.length - n} more` : '')

function die(msg, code = 1) {
  process.stderr.write(msg + '\n')
  process.exit(code)
}
// No optional locks: a read never takes index.lock from a peer's commit or a release script.
function git(args, opts = {}) {
  return execFileSync('git', ['--no-optional-locks', ...args], { encoding: 'utf8', stdio: [opts.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], maxBuffer: 1 << 28, ...opts })
}
// The ledger as on disk; null when there is none. A torn read (the mod mid-write) is read again, never taken as empty.
function readOwn() {
  for (let i = 0; ; i++) {
    let t
    try {
      t = readFileSync(own, 'utf8')
    } catch (e) {
      if (e.code === 'ENOENT') return null
      die(`peers: ${own} unreadable (${e.code}); nothing written.`)
    }
    try {
      return JSON.parse(t)
    } catch {
      if (i >= 4) die(`peers: ${own} does not parse; nothing written. Run the command again.`)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15)
    }
  }
}
function load() {
  const now = Date.now()
  return readOwn() ?? { v: 1, session, root, started: now, updated: now, files: {}, commits: [] }
}
// The mod records this session's edits while a command runs (a parallel tool call): its newer entries and commits stay.
// gone: files `drop` took out, not merged back.
function save(l, gone = []) {
  const disk = readOwn()
  for (const [f, e] of Object.entries(disk?.files ?? {})) {
    if (gone.includes(f)) continue
    if (!l.files[f] || e.last > l.files[f].last) l.files[f] = l.files[f] ? joinEntry(l.files[f], e) : e
  }
  for (const c of disk?.commits ?? []) if (!l.commits.some(x => x.sha === c.sha)) l.commits.push(c)
  l.commits.sort((a, b) => a.at - b.at)
  compact(l, dirtySet())
  l.updated = Date.now()
  mkdirSync(dir, { recursive: true })
  const tmp = `${own}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(l))
  renameSync(tmp, own)
}
// A peer's ledger caught mid-write (the mod has no rename) parses on a retry; dropped, the peer's lines go unseen.
function readParsed(path) {
  for (let i = 0; i < 6; i++) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch (e) {
      if (e.code === 'ENOENT') return null
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    }
  }
  return null
}
function peers() {
  if (!existsSync(dir)) return []
  const now = Date.now()
  const running = runningSync(homedir())
  return overlay(
    readdirSync(dir)
      .filter(f => f.endsWith('.json') && f !== `${session}.json`)
      .map(f => readParsed(join(dir, f))),
    claimsSync(homedir()),
  ).filter(l => l && isLive(l, now, running))
}
function dirtySet() {
  return new Set(statusPaths(git(['status', '--porcelain', '-z', '--untracked-files=all'])))
}
// A file stays mine while I hold it as a peer would (holding): an entry with no lines, older than a commit
// of the file by any route, is not (WA-1067.10: a 10-28 entry put a peer's new hunk in a commit).
function mineDirty(l) {
  const d = dirtySet()
  return Object.keys(l.files).filter(f => d.has(f) && holding(l, f, liveOf(f)))
}
// Task board: lib/board.mjs, picked by `board` in ~/.claude/peers/config.json (Backlog.md by default).
const config = configSync(homedir())
// This machine on the board: holders are `<who>/<session name>`; the board writes touch only this machine's.
const who = whoOf(config, userInfo().username, hostname())
// A board that will not load fails its own calls, never `peers status` or `diff`.
const board = await boardOf(config, join(homedir(), '.claude', 'peers'), who).catch(e => {
  const no = () => {
    throw new Error(`board "${config.board}" did not load: ${e.message}`)
  }
  return { name: String(config.board), on: () => true, ready: no, claim: no, note: no, open: no, openHint: () => '', close: no }
})
// A board call that fails warns and never undoes the git work around it.
const tryBoard = async (what, f) => {
  try {
    return await f()
  } catch (e) {
    process.stderr.write(`peers ${what}: ${e.message}\n`)
    return null
  }
}
// The outbox: board writes that failed go again, oldest first, before the next board call.
const send = (call, args) => board[call](...args)
const drain = async () => {
  for (const r of await act.drain(send))
    if (!r.ok) process.stderr.write(`peers: ${r.s.call} to ${r.s.args[0]} not sent${r.last ? ', gave up' : ', tries again on the next peers command'}: ${r.err}\n`)
}
// Every ledger in every repo, mine too: the one truth for who holds which task.
const allLedgers = () => {
  const base = join(homedir(), '.claude', 'peers')
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .flatMap(d =>
      readdirSync(join(base, d.name))
        .filter(f => f.endsWith('.json'))
        .map(f => {
          try {
            return JSON.parse(readFileSync(join(base, d.name, f), 'utf8'))
          } catch {
            return null
          }
        }),
    )
    .filter(Boolean)
}
// Claims (lib/claims.mjs): one file per session, written only here and only under the board lock.
const claimDir = CLAIMS(homedir())
const claimPath = id => join(claimDir, `${id}.json`)
const readClaim = id => {
  try {
    const c = JSON.parse(readFileSync(claimPath(id), 'utf8'))
    return c?.ticket ? c : null
  } catch {
    return null
  }
}
const writeClaim = c => {
  mkdirSync(claimDir, { recursive: true })
  const tmp = `${claimPath(c.session)}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(c))
  renameSync(tmp, claimPath(c.session))
}
const dropClaim = id => rmSync(claimPath(id), { force: true })
// The board lock: a claim (claim file, then board), a close (board, then claim file) and each sweep run one at a time
// on this machine. Without it a sweep that read the claims before a claim landed sends the claimed task back to To Do.
// mkdir is atomic. A holder that died (pid gone) or hung (2 min) loses it.
const LOCK = join(claimDir, '.lock')
const sleepMs = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const stale = () => {
  try {
    const pid = Number(readFileSync(join(LOCK, 'pid'), 'utf8'))
    if (pid) process.kill(pid, 0)
    return Date.now() - statSync(LOCK).mtimeMs > 120_000
  } catch (e) {
    return e.code === 'ESRCH' || (e.code === 'ENOENT' && existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs > 5000)
  }
}
let locked = false
const lock = waitMs => {
  if (locked) return true
  mkdirSync(claimDir, { recursive: true })
  for (const end = Date.now() + waitMs; ; ) {
    try {
      mkdirSync(LOCK)
      writeFileSync(join(LOCK, 'pid'), String(process.pid))
      locked = true
      if (!process.listeners('exit').includes(unlock)) process.on('exit', unlock)
      return true
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      if (stale()) {
        rmSync(LOCK, { recursive: true, force: true })
        continue
      }
      if (Date.now() > end) return false
      sleepMs(100)
    }
  }
}
const unlock = () => {
  if (!locked) return
  locked = false
  rmSync(LOCK, { recursive: true, force: true })
}
const withLock = async (waitMs, what, f) => {
  if (!lock(waitMs)) {
    if (what) die(`peers ${what}: another peers command holds the board lock (${LOCK}). Run it again.`)
    return null
  }
  try {
    return await f()
  } finally {
    unlock()
  }
}
// 0.20 kept claims in the ledgers: moved once, under the lock, on the first command that needs claims.
const MOVED = join(claimDir, '.from-ledgers')
const migrate = () => {
  if (existsSync(MOVED)) return
  for (const c of fromLedgers(allLedgers())) if (!readClaim(c.session)) writeClaim(c)
  writeFileSync(MOVED, '')
}
const now3 = () => [Date.now(), runningSync(homedir(), true), namesSync(homedir())]
// Other sessions whose claim on ticket holds now.
const holders = ticket => {
  const [now, running] = now3()
  return holdersOf(claimsSync(homedir()), allLedgers(), ticket, now, running, session)
}
// The board's In Progress, held to the claims: holder marks follow them; a task only a dead claim names goes back to
// To Do, once: the dead claim goes with the write. Skipped, not waited on, while another command holds the lock.
// Many machines: this one changes only its own holders; a task another machine holds stays, and its dead claim stays
// until the last machine out sends the task back (release says whether it did).
let boardHeld = null
const sweep = async () => {
  if (!board.held || !board.on()) return []
  return (
    (await withLock(15_000, null, async () => {
      const held = (boardHeld = await tryBoard('sweep', () => board.held()))
      if (!held) return []
      const [now, running, names] = now3()
      const { writes, notes, dead } = plan(held, claimsOf(claimsSync(homedir()), allLedgers(), now, running, names, who), board.covers, who)
      const failed = new Set()
      for (const w of writes) {
        const r = await tryBoard('sweep', () => (w.call === 'hold' ? board.hold(w.ticket, w.holders) : board.release(w.ticket, w.queue)))
        // false: another machine holds it (seen now or at the sweep's read): the task and its dead claim stay.
        if (r === null || (w.call === 'release' && r === false)) failed.add(w.ticket)
        if (r === null) continue
        act.log('sweep', w.call === 'release' ? { ...w, queued: r !== false } : w)
        const what = w.call === 'hold' ? `held by ${w.holders.join(', ')}` : r === false ? 'this machine lets go; another still holds it' : 'back to To Do (no session holds it)'
        process.stderr.write(`peers sweep: ${w.ticket} ${what}\n`)
      }
      // Read again: a session that came back (/resume) moved its claim to a new id, and the old file has no ticket.
      for (const c of dead) if (!failed.has(c.ticket) && readClaim(c.session)?.claimed === c.claimed) dropClaim(c.session)
      return notes
    })) ?? []
  )
}
// This machine's claims, then other machines' holds from the board (the sweep's read, else one now).
const heldNow = async () => {
  const [now, running, names] = now3()
  const away = board.held && board.on() ? (boardHeld ?? (await tryBoard('held', () => board.held())) ?? []) : []
  return [...heldLines(claimsSync(homedir()), allLedgers(), now, running, names), ...awayLines(away, who)]
}
// Line sets of a file: mine, and every live peer's that has not committed it yet.
// f's lines that differ from HEAD: a peer whose lines are all in HEAD (committed by any route) holds nothing.
const liveOf = f => ({
  ...delta(spawnSync('git', ['show', `HEAD:${f}`], { encoding: 'utf8' }).stdout ?? '', existsSync(f) ? readFileSync(f, 'utf8') : ''),
  at: Number(spawnSync('git', ['log', '-1', '--format=%ct', 'HEAD', '--', f], { encoding: 'utf8' }).stdout?.trim()) * 1000 || 0,
})
function lineSets(f, peers) {
  const mine = { added: new Set(l.files[f]?.added ?? []), removed: new Set(l.files[f]?.removed ?? []) }
  const theirs = { added: new Set(), removed: new Set(), who: [], blind: false }
  let live
  for (const p of peers) {
    const e = p.files[f]
    if (!e || !holding(p, f, (live ??= liveOf(f)), l.files[f])) continue
    theirs.who.push(nameOf(p))
    // A peer on an old mod, or whose edits held no distinctive line: nothing to split by.
    if (!e.added?.length && !e.removed?.length) theirs.blind = true
    for (const k of e.added ?? []) theirs.added.add(k)
    for (const k of e.removed ?? []) theirs.removed.add(k)
  }
  return { mine, theirs }
}
// Split a dirty file into my hunks and a peer's. `whole` when no peer has uncommitted edits in it,
// or when hunks cannot be split (binary, new, deleted, no final newline).
function split(f, live) {
  const { mine, theirs } = lineSets(f, live)
  if (!theirs.who.length) return { whole: true }
  // No line of ours at all: the file is the peers' (a command only brushed it), unless --whole.
  const none = !mine.added.size && !mine.removed.size
  const d = parseDiff(git(['diff', '-U0', '--no-color', '--no-ext-diff', '--no-renames', 'HEAD', '--', f]))
  const cut = !d.binary && d.hunks.length && !d.hunks.some(h => h.noEol) && d.head.every(x => !/^(new|deleted) file/.test(x))
  if (!cut) return { whole: true, who: theirs.who, uncut: true, none }
  // A peer with no line data: hunks holding our lines are ours, the rest theirs.
  const by = { mine: [], theirs: [], mixed: [], none: [] }
  for (const h of d.hunks) by[owner(h, mine, theirs, theirs.blind)].push(h)
  return { whole: false, who: theirs.who, head: d.head, ...by }
}
// The ticket's commits as they stand at close: by trailer, reachable from HEAD, in each repo this session has a ledger in.
// A sha kept at commit dies in a squash or a rebase (WA-970, WA-975); the trailer survives them.
function ticketShas(ticket) {
  const peersDir = join(homedir(), '.claude', 'peers')
  const roots = existsSync(peersDir) ? readdirSync(peersDir).filter(d => existsSync(join(peersDir, d, `${session}.json`))).map(decodeURIComponent) : [root]
  const esc = ticket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = []
  for (const r of roots) {
    const out = spawnSync('git', ['--no-optional-locks', '-C', r, 'log', '-E', `--grep=^Ticket: ${esc}$`, '--format=%h', '-n', '8', 'HEAD'], { encoding: 'utf8' })
    const shas = out.status === 0 ? out.stdout.split('\n').filter(Boolean).reverse() : []
    if (shas.length) found.push({ name: basename(r), shas })
  }
  // No trailer (a commit made without a bound ticket): the ledger's last sha, while HEAD still has it.
  // Only a commit made after the claim: a claim then close with no work names no sha.
  if (!found.length) {
    const c = l.commits.at(-1), last = c && c.at >= (mine?.claimed ?? 0) ? c.sha : null
    return last && spawnSync('git', ['--no-optional-locks', 'merge-base', '--is-ancestor', last, 'HEAD']).status === 0 ? ` (${last.slice(0, 7)})` : ''
  }
  return ` (${found.map(f => (found.length > 1 ? `${f.name} ` : '') + f.shas.join(', ')).join('; ')})`
}
function withIndexRetry(fn) {
  for (let i = 0; ; i++) {
    try {
      return fn()
    } catch (e) {
      const msg = String(e.stderr || e.message || '')
      if (i < 8 && /index\.lock/.test(msg)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
        continue
      }
      throw e
    }
  }
}

const l = load()
if (['ready', 'held', 'sweep', 'claim', 'commit', 'close'].includes(cmd) && !existsSync(MOVED)) await withLock(30_000, 'claims', migrate)
// One task per session, in every repo: its claim file.
const mine = readClaim(session)
const bound = mine?.ticket
if (['ready', 'claim', 'commit', 'close'].includes(cmd)) await drain()

switch (cmd) {
  case 'take': {
    // The file's uncommitted lines become yours too: for a file a command of a peer took by mistake
    // (it ran while you wrote it). Their ledger keeps it; a line you both hold counts as yours in commit.
    const named = pathsOf(argv.slice(1))
    if (!named.length) die('peers take <file...|->: name the files, or - to read them from stdin')
    const dirty = dirtySet()
    const now = Date.now()
    const took = []
    const skipped = named.filter(f => !dirty.has(f))
    for (const f of named.filter(f => dirty.has(f))) {
      const untracked = git(['ls-files', '--others', '--exclude-standard', '--', f]).trim()
      const d = untracked ? null : parseDiff(git(['diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD', '--', f]))
      const added = [...(d ? keys(d.hunks.flatMap(h => h.plus).join('\n')) : existsSync(f) ? keys(readFileSync(f, 'utf8')) : [])]
      const removed = [...(d ? keys(d.hunks.flatMap(h => h.minus).join('\n')) : [])]
      const e = (l.files[f] ??= { first: now })
      Object.assign(e, { from: now, last: now, named: true, added, removed })
      took.push({ file: f, added: added.length, removed: removed.length })
    }
    if (took.length) {
      save(l)
      act.log('take', { files: took.map(t => t.file) })
    }
    if (asJson) console.log(JSON.stringify({ took, skipped }))
    else {
      if (verbose) for (const t of took) console.log(`${t.file}: +${t.added} -${t.removed} lines, now yours`)
      const sum = (k) => took.reduce((n, t) => n + t[k], 0)
      if (took.length) console.log(`took ${took.length} file${took.length === 1 ? '' : 's'} (+${sum('added')} -${sum('removed')} lines)`)
      if (skipped.length) process.stderr.write(`skipped ${skipped.length}, no uncommitted change (paths are from the repo root): ${few(skipped)}\n`)
    }
    if (!took.length) process.exitCode = 1
    break
  }
  case 'drop': {
    // Take's reverse: a file a command of yours took from a peer leaves your ledger; the peer's record stands.
    const named = pathsOf(argv.slice(1))
    if (!named.length) die('peers drop <file...|->: name the files, or - to read them from stdin')
    const dropped = named.filter(f => l.files[f])
    for (const f of dropped) delete l.files[f]
    if (dropped.length) {
      save(l, dropped)
      act.log('drop', { files: dropped })
    }
    if (asJson) console.log(JSON.stringify({ dropped }))
    else console.log(`dropped ${dropped.length} file${dropped.length === 1 ? '' : 's'}${dropped.length < named.length ? `; not yours: ${few(named.filter(f => !l.files[f] && !dropped.includes(f)))}` : ''}`)
    if (!dropped.length) process.exitCode = 1
    break
  }
  case 'files': {
    // Uncommitted only: the list to hand a formatter, `biome check --write $(peers files)`.
    for (const f of mineDirty(l)) console.log(f)
    break
  }
  case 'status': {
    const all = dirtySet()
    const live = peers()
    const peerFiles = new Set(live.flatMap(p => Object.keys(p.files)))
    const mine = mineDirty(l)
    const shared = mine.filter(f => peerFiles.has(f))
    const others = [...all].filter(f => !mine.includes(f))
    const orphans = others.filter(f => !peerFiles.has(f))
    const sh = shared.map(f => ({ f, s: split(f, live) })).filter(x => x.s.who)
    if (asJson) {
      console.log(JSON.stringify({
        mine,
        shared: sh.map(({ f, s }) => ({ file: f, with: s.who, whole: !!s.whole, none: !!s.none, mine: s.mine?.length ?? 0, theirs: s.theirs?.length ?? 0, mixed: s.mixed?.length ?? 0, unrecorded: s.none?.length ?? 0 })),
        hidden: others.length - orphans.length,
        orphans,
      }))
      break
    }
    const CAP = 20
    if (mine.length) {
      const rows = git(['status', '--short', '--', ...mine]).trimEnd().split('\n')
      console.log((verbose ? rows : rows.slice(0, CAP)).join('\n'))
      if (!verbose && rows.length > CAP) console.log(`... ${rows.length - CAP} more (-v)`)
    } else console.log('nothing of yours is uncommitted')
    const note = []
    if (others.length - orphans.length) note.push(`${others.length - orphans.length} peer file(s) hidden`)
    if (orphans.length) note.push(`${orphans.length} file(s) nobody claims`)
    const whole = sh.filter(x => x.s.whole)
    const none = whole.filter(x => x.s.none)
    if (verbose)
      for (const { f, s } of sh)
        note.push(s.whole ? `${f} shared with ${s.who.join(', ')} (whole file${s.none ? ', no lines of yours: commit skips it' : ''})` : `${f}: ${s.mine.length} hunk(s) yours, ${s.theirs.length} ${s.who.join(', ')}'s${s.mixed.length ? `, ${s.mixed.length} mixed` : ''}${s.none.length ? `, ${s.none.length} no one's` : ''}`)
    else if (sh.length) {
      const who = [...new Set(sh.flatMap(x => x.s.who))].join(', ')
      note.push(`${sh.length} shared with ${who}: ${sh.length - whole.length} by hunk, ${whole.length} whole` + (none.length ? `, ${none.length} with no lines of yours (commit skips them: ${few(none.map(x => x.f))})` : '') + ' (-v for each)')
    }
    if (note.length) console.log(`(${note.join('; ')})`)
    break
  }
  case 'diff': {
    if (argv.includes('--who')) {
      // Every hunk of the named files (default: all of yours), headed by whose it is.
      const named = pathsOf(argv.slice(1).filter(a => a !== '--who'))
      const live = peers()
      for (const f of named.length ? named : mineDirty(l)) {
        const s = split(f, live)
        if (s.whole) {
          console.log(`# ${f}: whole file, ${s.who ? `yours and ${s.who.join(', ')}'s${s.none ? ' (no lines of yours)' : ''}` : 'yours'}`)
          continue
        }
        const tagged = [...s.mine.map(h => [h, 'yours']), ...s.theirs.map(h => [h, `${s.who.join(', ')}'s`]), ...s.mixed.map(h => [h, 'mixed']), ...s.none.map(h => [h, "no one's"])]
        console.log(`# ${f}`)
        for (const [h, who] of tagged.sort((x, y) => x[0].a - y[0].a)) console.log([`## ${who}`, ...h.text].join('\n'))
      }
      break
    }
    const mine = mineDirty(l)
    if (!mine.length) break
    const live = peers()
    const parts = mine.map(f => ({ f, s: split(f, live) }))
    const whole = parts.filter(p => p.s.whole).map(p => p.f)
    if (whole.length) process.stdout.write(git(['diff', 'HEAD', '--', ...whole]))
    for (const { f, s } of parts.filter(p => !p.s.whole)) {
      if (!s.mine.length && !s.mixed.length) continue
      console.log([...s.head, ...[...s.mine, ...s.mixed].sort((x, y) => x.a - y.a).flatMap(h => h.text)].join('\n'))
      console.log(`(${f}: ${s.theirs.length} hunk(s) of ${s.who.join(', ')}${s.none.length ? `, ${s.none.length} of no one's` : ''} not shown)`)
    }
    break
  }
  case 'commit': {
    const i = argv.indexOf('-m')
    const msg = i > 0 ? argv[i + 1] : null
    if (!msg?.trim()) die('peers commit -m "message" [--whole]: the message is empty')
    // A message file a blocked command never rewrote still holds the last one: never reuse it.
    const subject = msg.split('\n')[0].trim()
    const last = l.commits.at(-1)?.sha
    // Our last commit counts only while HEAD holds it: after a reset it is gone, and its subject is free again.
    const held = last && spawnSync('git', ['merge-base', '--is-ancestor', last, 'HEAD']).status === 0
    const used = [git(['log', '-1', '--format=%s', 'HEAD']).trim(), held ? spawnSync('git', ['log', '-1', '--format=%s', last], { encoding: 'utf8' }).stdout?.trim() : '']
    if (used.includes(subject)) die(`peers commit: "${subject}" is the subject of the last commit. Write a new message.`)
    // `-- <paths>`: only these of your files (with --whole, a regenerated file stays out).
    // --whole with paths: every dirty file under them, in the ledger or not (an untracked file it missed).
    const dash = argv.indexOf('--')
    const only = dash > 0 ? pathsOf(argv.slice(dash + 1)).map(p => p.replace(/\/$/, '')) : null
    const under = f => only.some(p => f === p || f.startsWith(`${p}/`))
    const mine = only && argv.includes('--whole') ? [...dirtySet()].filter(under) : mineDirty(l).filter(f => !only || under(f))
    // A named path also takes its dirty files that no live session holds: one written earlier in this same
    // command is in no ledger yet (it lands after the command ends). A peer's file stays out, and is named.
    const left = []
    if (only && !argv.includes('--whole')) {
      const others = peers()
      for (const f of [...dirtySet()].filter(under)) {
        if (mine.includes(f)) continue
        const who = others.filter(p => p.files[f] && holding(p, f, liveOf(f), l.files[f])).map(nameOf)
        if (who.length) left.push(`${f} (${who.join(', ')})`)
        else mine.push(f)
      }
      if (left.length) process.stderr.write(`left out, a peer holds them (peers take <file>, or --whole): ${few(left, 5)}\n`)
    }
    if (!mine.length) die(only ? `none of ${only.join(', ')} is an uncommitted file of yours (peers status)` : 'nothing of yours to commit (edited in this same command? the ledger lands after it ends: run peers commit on its own)')
    // The subject names another task of the bound one's kind (`(WA-1010)` while WA-1012 is bound): the trailer follows the subject.
    // Only `KEY-12` ids: a GitHub `(#12)` in a subject is a PR number.
    const pre = bound?.match(/^([A-Za-z]+-)\d+$/)?.[1]
    // Only ids in parentheses: prose like "regression from WA-932" names no target.
    const said = pre ? [...new Set((subject.match(/\([^)]*\)/g) ?? []).flatMap(x => x.match(new RegExp(`\\b${pre}\\d+\\b`, 'gi')) ?? []).map(t => t.toUpperCase()))] : []
    const tickets = said.length && !said.includes(bound?.toUpperCase()) ? said : bound ? [bound] : []
    if (tickets[0] !== bound && bound) process.stderr.write(`peers commit: the subject names ${tickets.join(', ')}, not the bound ${bound}: the trailer says ${tickets.join(', ')}\n`)
    const body = [msg, '', ...tickets.map(t => `Ticket: ${t}`)].join('\n')
    // A private index built from HEAD: a peer's staged files never ride along, and the
    // update-ref below lands only if HEAD did not move under us.
    const index = git(['rev-parse', '--path-format=absolute', '--git-path', `peers-${session}.index`]).trim()
    const env = { ...process.env, GIT_INDEX_FILE: index }
    process.on('exit', () => rmSync(index, { force: true }))
    let sha
    let notes
    let at
    for (let attempt = 0; ; attempt++) {
      notes = []
      // Before the files are read: an edit after this is not in the commit, so its file stays uncommitted.
      at = Date.now()
      const live = peers()
      const head = git(['rev-parse', 'HEAD']).trim()
      git(['read-tree', head], { env })
      const whole = []
      const files = []
      for (const f of mine) {
        const s = argv.includes('--whole') ? { whole: true } : split(f, live)
        if (s.whole && s.none && s.who) {
          notes.push(`${f}: skipped, no lines of yours (${s.who.join(', ')} edited it); --whole takes it`)
          continue
        }
        if (s.whole) {
          whole.push(f)
          files.push(f)
          if (s.who) notes.push(`${f}: whole file, it also carries uncommitted lines of ${s.who.join(', ')}${s.uncut ? ' (cannot split this file)' : s.blind ? ' (no line data for a peer)' : ''}`)
          continue
        }
        const take = [...s.mine, ...s.mixed]
        if (s.theirs.length) notes.push(`${f}: left ${s.theirs.length} hunk(s) of ${s.who.join(', ')} uncommitted`)
        if (s.none.length) notes.push(`${f}: left ${s.none.length} hunk(s) no session recorded (peers take ${f}, or --whole)`)
        if (s.mixed.length) notes.push(`${f}: ${s.mixed.length} hunk(s) mix your lines with ${s.who.join(', ')}'s; committed whole`)
        if (!take.length) continue
        const blob = git(['hash-object', '-w', '--stdin'], { input: applyHunks(git(['show', `${head}:${f}`]), take) }).trim()
        const mode = git(['ls-tree', head, '--', f]).split(/\s/)[0] || '100644'
        git(['update-index', '--add', '--cacheinfo', `${mode},${blob},${f}`], { env })
        files.push(f)
      }
      if (whole.length) git(['add', '-A', '--', ...whole], { env })
      const tree = git(['write-tree'], { env }).trim()
      if (tree === git(['rev-parse', `${head}^{tree}`]).trim()) die(`nothing of yours to commit${notes.length ? `\n${notes.join('\n')}` : ''}`)
      const commit = git(['commit-tree', tree, '-p', head, '-F', '-'], { input: body }).trim()
      try {
        git(['update-ref', '-m', `commit: ${msg}`, 'HEAD', commit, head])
      } catch (e) {
        if (attempt < 5) continue // a peer committed meanwhile: build again on the new HEAD
        throw e
      }
      sha = commit
      // The shared index catches up for these paths only; a peer's hunks stay in the worktree.
      withIndexRetry(() => git(['reset', '-q', '--', ...files]))
      l.commits.push({ sha, at, files })
      break
    }
    // Keep only lines that are still uncommitted: committed ones are no longer anyone's.
    for (const f of mine) {
      const e = l.files[f]
      if (!e?.added && !e?.removed) continue
      // An untracked file has no diff against HEAD: all its lines are still uncommitted.
      const untracked = git(['ls-files', '--others', '--exclude-standard', '--', f]).trim()
      const d = untracked ? null : parseDiff(git(['diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD', '--', f]))
      const plus = d ? keys(d.hunks.flatMap(h => h.plus).join('\n')) : existsSync(f) ? keys(readFileSync(f, 'utf8')) : new Set()
      const minus = d ? keys(d.hunks.flatMap(h => h.minus).join('\n')) : new Set()
      e.added = (e.added ?? []).filter(k => plus.has(k))
      e.removed = (e.removed ?? []).filter(k => minus.has(k))
    }
    // An edit's line keys find its hunk's title while the hunk is uncommitted. Once committed they only fill
    // the ledger (whole lines, rewritten on each edit): keep the time and title, drop the keys.
    for (const [f, e] of Object.entries(l.files)) {
      if (!e.edits?.some(x => x.k?.length)) continue
      const left = l.commits.some(c => c.at >= e.last && c.files.includes(f)) ? new Set() : new Set([...(e.added ?? []), ...(e.removed ?? [])])
      for (const x of e.edits) x.k = (x.k ?? []).filter(k => left.has(k))
    }
    save(l)
    spawnSync('git', ['hook', 'run', '--ignore-missing', 'post-commit'], { stdio: 'inherit' })
    // Co-author and session trailers add nothing to the board or the log.
    const told = msg.replace(/^(Co-Authored-By|Claude-Session):.*\n?/gim, '').trimEnd()
    const n = l.commits.at(-1).files.length
    console.log(`${sha.slice(0, 7)} ${told} (${n} file${n === 1 ? '' : 's'})`)
    for (const x of verbose ? notes : notes.slice(0, 3)) console.log(`note: ${x}`)
    if (!verbose && notes.length > 3) console.log(`note: ${notes.length - 3} more (-v)`)
    act.log('commit', { sha, files: l.commits.at(-1).files, ticket: tickets.join(', ') || undefined, t: told.split('\n')[0] })
    for (const t of tickets) {
      const r = await act.send('note', [t, `${sha.slice(0, 7)} ${told}`], send)
      if (!r.ok) process.stderr.write(`peers commit: note to ${t} not sent, tries again on the next peers command: ${r.err}\n`)
    }
    break
  }
  case 'check': {
    const last = l.commits.at(-1)
    if (!last) die('no commit of yours yet: peers commit first')
    const wt = join(homedir(), 'worktrees', `${basename(root)}-check`)
    if (!existsSync(wt)) {
      mkdirSync(join(homedir(), 'worktrees'), { recursive: true })
      git(['worktree', 'add', '--detach', wt, last.sha], { stdio: 'inherit' })
    } else {
      git(['-C', wt, 'checkout', '-q', '--detach', last.sha])
    }
    console.log(`peers check: ${wt} at ${git(['-C', wt, 'log', '-1', '--format=%h %s']).trim()}`)
    // Every run: a commit that moves the lockfile or a package.json needs fresh node_modules; a no-op otherwise.
    if (existsSync(join(wt, 'pnpm-lock.yaml'))) {
      const pn = platform(process.platform).npmCommand('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'])
      const i = spawnSync(pn.cmd, pn.args, { cwd: wt, stdio: 'inherit', shell: pn.shell })
      if (i.status !== 0) die(`peers check: pnpm install failed in ${wt}`)
    }
    // `check` in the config (a shell line, as `npm test`), else the repo's gate script, else the commit's stat.
    // The gate goes through bash: Windows runs no .sh by itself (Git for Windows brings bash).
    const gate = join(wt, 'scripts', 'gates.sh')
    const r = config.check
      ? spawnSync(config.check, { cwd: wt, stdio: 'inherit', shell: true })
      : existsSync(gate)
        ? spawnSync('bash', [gate, 'changed'], { cwd: wt, stdio: 'inherit' })
        : spawnSync('git', ['-C', wt, 'show', '--stat', '--oneline', 'HEAD'], { stdio: 'inherit' })
    act.log('check', { sha: last.sha, status: r.status ?? 1 })
    process.exit(r.status ?? 1)
  }
  case 'ls': {
    const rows = [{ ...l, me: true }, ...peers()]
    const now = Date.now()
    const dirty = dirtySet()
    for (const p of rows) {
      // Open files, as the band and the guard count them: dirty, not taken by their own commit, lines not in HEAD.
      const files = Object.keys(p.files).filter(f => dirty.has(f) && holding(p, f, liveOf(f)))
      const last = Object.keys(p.files).reduce((m, f) => Math.max(m, p.files[f].last), p.updated)
      console.log(
        `${p.me ? '*' : ' '} ${nameOf(p).padEnd(12)} ${String(files.length).padStart(3)} open  ${Math.round((now - last) / 60000)}m ago  ${p.commits.length} commits`,
      )
    }
    break
  }
  case 'ready': {
    const out = await tryBoard('ready', () => board.ready())
    if (out === null) process.exit(1)
    console.log(String(out).trimEnd())
    const notes = await sweep()
    const held = await heldNow()
    if (held.length) console.log(`\nHeld:\n${held.map(x => `  ${x}`).join('\n')}`)
    for (const n of notes) process.stderr.write(`peers: ${n}\n`)
    break
  }
  case 'held': {
    const held = await heldNow()
    console.log(held.length ? held.join('\n') : 'no session holds a task')
    break
  }
  case 'sweep': {
    const notes = await sweep()
    for (const n of notes) console.log(n)
    break
  }
  case 'claim': {
    if (!argv[1]) die('peers claim <task>')
    // Jira keys are upper case: a trailer with `proj-1` links to nothing.
    const id = board.key ? board.key(argv[1]) : argv[1]
    // Claim file first, then the board, under the lock: a sweep never sees the board's mark without the claim behind it.
    await withLock(60_000, 'claim', async () => {
      const was = readClaim(session)
      const [now, running, names] = now3()
      const c = { v: 1, session, agent: l.agent, ticket: id, title: null, claimed: now, updated: now }
      c.name = holderName(c, names)
      writeClaim(c)
      const { live } = claimsOf(claimsSync(homedir()), allLedgers(), now, running, names, who)
      const all = live.get(id) ?? [`${who}/${c.name}`]
      let got
      try {
        got = await board.claim(id, all)
      } catch (e) {
        // The board said no: the claim before it stands.
        if (was) writeClaim(was)
        else dropClaim(session)
        die(`peers claim: ${id} not claimed: ${e.message}`)
      }
      // The title travels in the claim: the views show it without asking the board.
      writeClaim({ ...c, title: got?.title ?? null, updated: Date.now() })
      act.log('claim', { ticket: id, title: got?.title ?? null })
      const others = [...all.filter(n => n !== `${who}/${c.name}`).map(n => n.slice(who.length + 1)), ...(got?.others ?? [])]
      console.log(`claimed ${id}${others.length ? ` (also held by ${others.join(', ')})` : ''}`)
    })
    break
  }
  case 'close': {
    if (!bound) die('no ticket bound: peers claim <ticket> first')
    const i = argv.indexOf('-r')
    const reason = (i > 0 ? argv[i + 1] : 'done') + ticketShas(bound)
    await withLock(60_000, 'close', async () => {
      // Read again under the lock: a parallel command of this session may have moved the claim.
      if (readClaim(session)?.ticket !== bound) die(`peers close: the claim moved off ${bound} while this ran. Run it again.`)
      if (!argv.includes('--force')) {
        // This machine's other sessions, then other machines and people (the board: marks, comments, assignees).
        const still = [...holders(bound).map(p => holderName(p, namesSync(homedir()))), ...((board.others && (await tryBoard('close', () => board.others(bound)))) || [])]
        if (still.length) die(`peers close: ${still.join(', ')} also works on ${bound}. Close it there last, or --force.`)
        const open = (await tryBoard('close', () => board.open(bound))) ?? []
        if (open.length) die(`peers close: ${bound} has ${open.length} unchecked item(s):\n${open.join('\n')}\n${board.openHint(bound)} --force closes anyway.`)
      }
      if ((await tryBoard('close', () => board.close(bound, reason))) === null && board.on()) die(`peers close: ${bound} stays bound; fix the board error, then run it again.`)
      dropClaim(session)
      act.log('close', { ticket: bound, reason })
      console.log(`closed ${bound}: ${reason}`)
    })
    break
  }
  case 'log': {
    // The trace: this session's last actions, oldest first.
    const n = Number(argv[1]) || 20
    const sends = new Map()
    for (const a of act.read().slice(-n * 3)) {
      const t = new Date(a.at).toLocaleString('sv-SE').slice(5, 16)
      if (a.op === 'send') sends.set(a.id, a)
      const s = a.op === 'sent' ? sends.get(a.id) : null
      const what =
        a.op === 'send' ? null
        : a.op === 'sent' ? `${s?.call ?? 'send'} ${s?.args?.[0] ?? ''} ${a.ok ? 'sent' : `failed: ${a.err}`}`
        : a.op === 'commit' ? `commit ${a.sha.slice(0, 7)} ${a.t ?? ''}${a.ticket ? ` (${a.ticket})` : ''}`
        : a.op === 'check' ? `check ${a.sha.slice(0, 7)} ${a.status === 0 ? 'passed' : `failed (${a.status})`}`
        : a.op === 'claim' ? `claim ${a.ticket}${a.title ? ` ${a.title}` : ''}`
        : a.op === 'close' ? `close ${a.ticket}: ${a.reason}`
        : a.op === 'take' || a.op === 'drop' ? `${a.op} ${a.files.join(', ')}`
        : a.op === 'sweep' ? `sweep ${a.ticket} ${a.call === 'hold' ? `held by ${a.holders.join(', ')}` : a.queued === false ? 'let go, another machine holds it' : 'back to To Do'}`
        : a.op
      if (what) console.log(`${t}  ${what}`)
    }
    const p = act.pending()
    if (p.length) console.log(`${p.length} board write(s) wait to send: ${p.map(s => `${s.call} ${s.args[0]}`).join(', ')}`)
    break
  }
  default:
    die(usage)
}
