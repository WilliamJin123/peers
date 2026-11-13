// `peers view`: a live page of every session's uncommitted edits, each line in its author's color.
// The /peers pane reads the same server. Listens on 127.0.0.1 only.
// Started detached by `peers view` (exits after 15 min with no page open), or by launchd with --keep.
// PEERS_VIEW_HOST names the public host a tunnel sends (peers.wrenautomation.com): requests that carry
// it see only repos public on GitHub. Private repos (tasks, sops, artifacts, boards) never leave the Mac.
import { execFile, execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import { createServer, get, request } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CLAIMS, SESSIONS, core, holding, idOf, isLive, overlay, shortTicket } from './core.mjs'
import { claimsSync, configSync, nodeIo, runningSync, statusSync } from './io.mjs'
import { store } from './queue-files.mjs'
import { docLines, editTimes, stamp } from './doc.mjs'
import { homeOf, slash } from './path.mjs'
import { platform } from './platform.mjs'
import { onlyQuery, pick, terms } from './rows.mjs'
import { key, statusPaths } from './lines.mjs'

const PORT = +(process.env.PEERS_VIEW_PORT || 6421)
const URL = `http://127.0.0.1:${PORT}/`
const PUBLIC = process.env.PEERS_VIEW_HOST || ''
// PEERS_VIEW_VERSION: tests only, to play an older server.
export const VERSION = process.env.PEERS_VIEW_VERSION || JSON.parse(readFileSync(new globalThis.URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version
// a < b, as dotted numbers.
// one run in flight, callers share it. The slot clears in a .finally callback (always a later microtask), never
// in the run's own finally: a run that never awaits ends before `slot = ...` stores it, and the slot kept a
// settled promise forever (board froze 7.7 h, 11-13; the 21 h of 11-12 too)
export const oneRun = fn => {
  let slot = null
  return () => slot ?? (slot = Promise.resolve().then(fn).finally(() => (slot = null)))
}

export const older = (a, b) => {
  const x = String(a).split('.').map(Number)
  const y = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0)
  return false
}
const LEDGERS = join(homedir(), '.claude', 'peers')
const MAX_TEXT = 1 << 20
const MAX_HEADS = 256 * 1024
const isMd = rel => /\.(md|mdx|markdown)$/i.test(rel)

// A failure goes to stderr (the launchd log): a blocked read must not look like "no changes".
const git = (root, args, quiet = false) => {
  try {
    return execFileSync('git', ['--no-optional-locks', '-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28, windowsHide: true })
  } catch (e) {
    if (!quiet) console.error(`git ${args[0]} in ${root}: ${String(e.stderr || e.message).trim()}`)
    return ''
  }
}
// The same, off the event loop: a rebuild never holds up a request.
const gitAsync = (root, args, quiet = false) =>
  new Promise(res =>
    execFile('git', ['--no-optional-locks', '-C', root, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, windowsHide: true }, (e, out, err) => {
      if (e && !quiet) console.error(`git ${args[0]} in ${root}: ${String(err || e.message).trim()}`)
      res(e ? '' : out)
    }),
  )
// Parsed once per file change: ~30 MB of ledgers re-parsed on every pass blocked the loop for seconds. Callers never mutate.
const parsed = new Map() // path -> { at: mtime:size, v }
const readJson = p => {
  try {
    const st = statSync(p), at = `${st.mtimeMs}:${st.size}`, c = parsed.get(p)
    if (c?.at === at) return c.v
    const v = JSON.parse(readFileSync(p, 'utf8'))
    parsed.set(p, { at, v })
    return v
  } catch {
    parsed.delete(p)
    return null
  }
}

// What each session is on (lib/core.mjs sessionTitle), kept by a pass in the background: state() reads it, never waits.
const said = new Map()
const labels = new Map() // session -> the name the person gave it
let sayer = null
const sayAll = async () => {
  sayer ??= core({ home: homedir(), session: '', backlog: process.env.BACKLOG_CWD })
  const k = sayer(nodeIo)
  let changed = false
  for (const { root, ledgers } of live())
    for (const l of ledgers) {
      const t = await k.sessionAbout(l).catch(() => null)
      const label = await k.sessionLabel(l).catch(() => null)
      if (said.get(`${root}\0${l.session}`) !== t || labels.get(l.session) !== label) changed = true
      said.set(`${root}\0${l.session}`, t)
      labels.set(l.session, label)
    }
  return changed
}

// Public = the origin is a GitHub repo that answers without a login. No remote, a private repo
// or a failed lookup: private. Looked up in the background, again every 6 hours.
const shown = new Map() // root -> { ok, at }
const isPublic = root => {
  const v = shown.get(root)
  if (!v || Date.now() - v.at > 6 * 3600 * 1000) {
    shown.set(root, { ok: v?.ok ?? false, at: Date.now() })
    const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(git(root, ['remote', 'get-url', 'origin'], true).trim())
    if (m)
      fetch(`https://api.github.com/repos/${m[1]}/${m[2]}`, { headers: { 'user-agent': 'peers-view' } })
        .then(r => (r.ok ? r.json() : { private: true }))
        .then(j => shown.set(root, { ok: j.private === false, at: Date.now() }))
        .catch(() => {})
  }
  return shown.get(root).ok
}

// Live: a running session's ledger with work in it (core.mjs isLive).
const live = () => {
  const now = Date.now()
  const running = runningSync(homedir())
  const claims = claimsSync(homedir())
  const repos = []
  if (!existsSync(LEDGERS)) return repos
  for (const enc of readdirSync(LEDGERS)) {
    const root = decodeURIComponent(enc)
    if (!existsSync(join(root, '.git'))) continue
    const ledgers = overlay(
      readdirSync(join(LEDGERS, enc))
        .filter(f => f.endsWith('.json'))
        .map(f => readJson(join(LEDGERS, enc, f))),
      claims,
    ).filter(l => isLive(l, now, running))
    if (ledgers.length) repos.push({ root, ledgers })
  }
  return repos
}

// Who wrote a line: the session whose ledger holds it, the latest edit first.
// a ledger's key list as a Set, built once per list (lists are new on each ledger read)
const sets = new WeakMap()
const has = (arr, k) => {
  let s = sets.get(arr)
  if (!s) sets.set(arr, (s = new Set(arr)))
  return s.has(k)
}
const authorOf = (ledgers, rel, k, side) => {
  if (!k) return null
  let best = null
  for (const l of ledgers) {
    const e = l.files[rel]
    if (e?.[side] && has(e[side], k) && (!best || e.last > best.last)) best = { id: l.session, last: e.last }
  }
  return best?.id ?? null
}

// Markdown headings outside code fences: { line (1-based), d (depth), h (text) }.
const headingsOf = text => {
  const out = []
  let fence = false
  text.split('\n').forEach((x, i) => {
    if (/^\s*(```|~~~)/.test(x)) fence = !fence
    const m = !fence && /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(x)
    if (m) out.push({ line: i + 1, d: m[1].length, h: m[2] })
  })
  return out
}
const heads = new Map() // abs path -> { mtime, list }
const headingsAt = abs => {
  try {
    const st = statSync(abs)
    if (st.size > MAX_HEADS) return []
    const v = heads.get(abs)
    if (v?.mtime === st.mtimeMs) return v.list
    const list = headingsOf(readFileSync(abs, 'utf8'))
    heads.set(abs, { mtime: st.mtimeMs, list })
    return list
  } catch {
    return []
  }
}

// Every file git shows in a repo (tracked and untracked, never an ignored one), kept 5 s.
const listed = new Map() // root -> { at, paths }
const filesIn = async root => {
  const v = listed.get(root)
  if (v && Date.now() - v.at < 5000) return v.paths
  const paths = (await gitAsync(root, ['ls-files', '-co', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
  listed.set(root, { at: Date.now(), paths })
  return paths
}

// A hunk's title: the line its author wrote before the edit (the ledger's `edits`), else where it is:
// the heading above it in Markdown, git's function line in code.
const titleOf = (ledgers, rel, h, list) => {
  const keys = new Set(h.lines.filter(x => x.t !== ' ').map(x => key(x.s)).filter(Boolean))
  let best = null
  for (const l of ledgers) for (const e of l.files[rel]?.edits ?? []) if ((!best || e.at > best.at) && e.k.some(k => keys.has(k))) best = e
  if (best) return { t: best.t, said: true, when: best.at }
  if (list) {
    let line = h.new
    for (const x of h.lines) {
      if (x.t !== ' ') break
      line++
    }
    const above = list.filter(x => x.line <= line).pop()
    if (above) return { t: above.h, said: false }
  }
  return { t: h.at, said: false }
}

// The author owning most of a hunk's changed lines.
const ownerOf = h => {
  const n = new Map()
  for (const x of h.lines) if (x.t !== ' ' && x.a) n.set(x.a, (n.get(x.a) ?? 0) + 1)
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

// Titled edits and commits, newest first; one session's run of edits under one title is one row.
// The commits a session sends: the list shows 5 and opens to all of these; `peers log` has the rest.
const COMMITS_SENT = 100
// Commit subjects by sha: a sha never changes its subject, so one git call per new sha.
const subjects = new Map()
const subjectsOf = async (root, shas) => {
  const want = shas.filter(x => !subjects.has(x))
  if (want.length) {
    for (const line of (await gitAsync(root, ['log', '--no-walk', '--ignore-missing', '--format=%H %s', ...want], true)).split('\n')) {
      const i = line.indexOf(' ')
      if (i > 0) for (const x of want) if (line.startsWith(x)) subjects.set(x, line.slice(i + 1))
    }
    for (const x of want) if (!subjects.has(x)) subjects.set(x, '')
  }
  if (subjects.size > 2000) subjects.clear()
}

// Newest first, the last `keep` entries of each session (its box's scrollback). Untitled edits keep t = ''; the page names them by their files.
// memo per root: same ledger contents (cached parses), same keep, no new subjects → last feed
const feeds = new Map()
const feedOf = async (root, ledgers, keep) => {
  await subjectsOf(root, ledgers.flatMap(l => (l.commits ?? []).map(c => c.sha)))
  const parts = ledgers.flatMap(l => [l.session, l.files, l.commits])
  const hit = feeds.get(root)
  if (hit && hit.keep === keep && hit.subs === subjects.size && hit.parts.length === parts.length && hit.parts.every((x, i) => x === parts[i])) return hit.out
  const out = feedRows(ledgers, keep)
  feeds.set(root, { keep, subs: subjects.size, parts, out })
  return out
}
const feedRows = (ledgers, keep) => {
  const rows = []
  for (const l of ledgers) {
    for (const [rel, e] of Object.entries(l.files)) for (const x of e.edits ?? []) rows.push({ kind: 'edit', at: x.at, a: l.session, t: x.t, rels: [rel] })
    for (const c of l.commits ?? []) rows.push({ kind: 'commit', at: c.at, a: l.session, t: subjects.get(c.sha) ?? '', sha: c.sha.slice(0, 8), rels: c.files })
  }
  rows.sort((a, b) => b.at - a.at)
  const out = []
  const count = new Map()
  for (const r of rows) {
    const p = out[out.length - 1]
    if (p && p.kind === 'edit' && r.kind === 'edit' && p.a === r.a && p.t === r.t) {
      if (!p.rels.includes(r.rels[0])) p.rels.push(r.rels[0])
      continue
    }
    const n = (count.get(r.a) ?? 0) + 1
    if (n > keep) continue
    count.set(r.a, n)
    out.push(r)
  }
  return out
}

const hunksOf = text => {
  const files = new Map()
  let f = null
  let h = null
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      f = null
      continue
    }
    if (line.startsWith('+++ ')) {
      const rel = line.slice(4).replace(/^b\//, '')
      if (rel !== '/dev/null') files.set(rel, (f = []))
      continue
    }
    if (line.startsWith('--- ') && !f) {
      const rel = line.slice(4).replace(/^a\//, '')
      if (rel !== '/dev/null') files.set(rel, (f = []))
      continue
    }
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(line)
    if (m && f) {
      f.push((h = { old: +m[1], new: +m[2], at: m[3].trim(), lines: [] }))
      continue
    }
    if (!h || !f) continue
    const t = line[0]
    if (t === '+' || t === '-' || t === ' ') h.lines.push({ t, s: line.slice(1) })
  }
  return files
}

const BULK = 40
// A repo's files are built again only after its tree (a watcher's bump), its index or HEAD, or one of its ledgers moved.
const gens = new Map() // root -> count of watcher events
let epoch = 0 // every repo again: the minute's rebuild, for an event a watcher missed
const bump = root => gens.set(root, (gens.get(root) ?? 0) + 1)
const builtFiles = new Map() // root -> { key, files, next }
const building = new Map() // root -> the build in flight: requests share it
// a build's git output turned into strings blocks the loop: wait ~3 s per MB before the next (tasks: 15 MB of JSONL lines)
const GAP_PER_MB = 3000, GAP_MAX = 60_000
const DIFF_MAX = 128 * 1024 // bytes on disk; a bigger file is listed without hunks
const rows = new Map() // root -> Map(rel -> { sig, row }): a file whose inputs did not move keeps its row
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const filesKey = (root, ledgers) => {
  const at = p => {
    try {
      return statSync(join(root, '.git', p)).mtimeMs
    } catch {
      return 0
    }
  }
  return [epoch, gens.get(root) ?? 0, at('index'), at('HEAD'), ...ledgers.map(l => `${l.session}:${l.updated}`)].join(',')
}
const filesOf = (root, ledgers) => {
  const k = filesKey(root, ledgers)
  const hit = builtFiles.get(root)
  if (hit?.key === k || (hit && Date.now() < hit.next)) return Promise.resolve(hit.files)
  let b = building.get(root)
  if (!b) building.set(root, (b = buildFiles(root, ledgers, k).finally(() => building.delete(root))))
  return b
}
const buildFiles = async (root, ledgers, k) => {
  // a repo with no commit yet diffs against the empty tree
  const head = (await gitAsync(root, ['rev-parse', '--verify', '-q', 'HEAD'], true)).trim()
  const base = head || EMPTY_TREE
  const [st, others, added, dirs] = await Promise.all([
    gitAsync(root, ['status', '--porcelain', '-z', '--untracked-files=all']),
    gitAsync(root, ['ls-files', '--others', '--exclude-standard', '-z']),
    gitAsync(root, ['diff', base, '--name-only', '--diff-filter=A', '-z']),
    gitAsync(root, ['ls-files', '--others', '--exclude-standard', '--directory', '-z']),
  ])
  const dirty = statusPaths(st)
  // a big file stays out of the diff: its row shows, its hunks do not (tasks' JSONL ledgers made 15 MB of diff per build)
  const heavy = [...new Set(dirty)].filter(rel => { try { return statSync(join(root, rel)).size > DIFF_MAX } catch { return false } })
  const diff = await gitAsync(root, ['diff', base, '--no-color', '--no-ext-diff', '-U3', '--', '.', ...heavy.map(rel => `:(exclude,literal)${rel}`)])
  const untracked = new Set(others.split('\0').filter(Boolean))
  // Added to the index counts as new, as an untracked file does.
  const staged = new Set(added.split('\0').filter(Boolean))
  const diffs = hunksOf(diff)
  const files = []
  // A new folder of many files (a vendored library, a build) is one row: its files would swamp both views.
  const bulk = dirs.split('\0').filter(d => d.endsWith('/'))
  const big = new Map(bulk.map(d => [d, [...untracked].filter(u => u.startsWith(d))]).filter(([, us]) => us.length > BULK))
  const inBig = rel => [...big.keys()].some(d => rel.startsWith(d))
  for (const [d, us] of big) {
    const mtime = Math.max(0, ...us.slice(0, 200).map(u => { try { return statSync(join(root, u)).mtimeMs } catch { return 0 } }))
    const touch = ledgers.filter(l => Object.keys(l.files).some(f => f.startsWith(d)))
    files.push({ rel: d, hunks: [], authors: touch.map(l => l.session), isNew: true, kind: 'add', count: us.length, mtime, titles: [] })
  }
  const was = rows.get(root) ?? new Map()
  const now = new Map()
  rows.set(root, now)
  for (const rel of new Set(dirty)) {
    if (inBig(rel)) continue
    const st = (() => {
      try {
        return statSync(join(root, rel))
      } catch {
        return null
      }
    })()
    let hunks = diffs.get(rel) ?? []
    // same file, same diff base, same ledger entries: the last build's row (a busy repo rebuilds often)
    const lsig = ledgers.map(l => {
      const e = l.files[rel]
      return e ? `${l.session}:${e.last}:${e.edits?.length ?? 0}:${e.added?.length ?? 0}:${e.removed?.length ?? 0}:${(l.commits ?? []).length}` : ''
    })
    const sig = [st?.size, st?.mtimeMs, base, untracked.has(rel), staged.has(rel), hunks.reduce((n, h) => n + h.lines.length, 0), ...lsig].join(',')
    const old = was.get(rel)
    if (old?.sig === sig) {
      now.set(rel, old)
      files.push(old.row)
      continue
    }
    // one read: the body (a binary file has none) and its length in lines
    let body = ''
    if (st?.isFile() && st.size <= MAX_TEXT)
      try {
        const b = readFileSync(join(root, rel))
        if (!b.subarray(0, 8000).includes(0)) body = b.toString('utf8')
      } catch {}
    if (untracked.has(rel)) {
      const lines = body.replace(/\n$/, '').split('\n')
      hunks = body ? [{ old: 0, new: 1, at: 'new file', lines: lines.map(s => ({ t: '+', s })) }] : []
    }
    // Each changed line gets its author; a line too plain to own (a brace, a blank) takes its neighbour's.
    const by = new Set()
    for (const h of hunks) {
      let prev = null
      for (const x of h.lines) {
        if (x.t === ' ') {
          prev = null
          continue
        }
        x.a = authorOf(ledgers, rel, key(x.s), x.t === '+' ? 'added' : 'removed') ?? (key(x.s) ? null : prev)
        prev = x.a
        if (x.a) by.add(x.a)
      }
    }
    const times = editTimes(ledgers, rel)
    for (const h of hunks) stamp(h.lines, times, x => (x.t === ' ' ? '' : x.t))
    const list = isMd(rel) ? headingsAt(join(root, rel)) : null
    for (const h of hunks) Object.assign(h, titleOf(ledgers, rel, h, list), { a: ownerOf(h) })
    // Sessions that name the file but hold no line in it (edits too plain, an old mod).
    // The diff's keys: a session whose lines are all in HEAD (committed by any route) holds nothing here.
    // No hunks (binary, a folder): no line data, held while dirty.
    const keysOf = t => hunks.flatMap(h => h.lines.filter(x => x.t === t).map(x => key(x.s))).filter(Boolean)
    const live = hunks.length ? { added: keysOf('+'), removed: keysOf('-') } : null
    const touch = ledgers.filter(l => holding(l, rel, live))
    const mtime = st?.mtimeMs ?? 0
    const said = [...new Set(hunks.filter(h => h.said).map(h => h.t))]
    const isNew = untracked.has(rel) || staged.has(rel)
    const kind = isNew ? 'add' : existsSync(join(root, rel)) ? 'edit' : 'delete'
    // A nested repo, a submodule or a linked folder is one row; it shows with a slash.
    // The file's length in lines, so the views can show the lines after the last hunk.
    const size = body ? body.replace(/\n$/, '').split('\n').length : 0
    const row = { rel, hunks, authors: [...new Set([...by, ...touch.map(l => l.session)])], isNew, kind, mtime, size, titles: said, ...(st?.isDirectory() ? { isDir: true } : {}) }
    now.set(rel, { sig, row })
    files.push(row)
  }
  files.sort((a, b) => b.mtime - a.mtime)
  const mb = (st.length + others.length + added.length + diff.length + dirs.length) / 2 ** 20
  builtFiles.set(root, { key: k, files, next: Date.now() + Math.min(GAP_MAX, mb * GAP_PER_MB) })
  return files
}

let stage = '' // the step a build is on: a hung build names it
const state = async () => {
  const repos = []
  const states = statusSync(homedir())
  const { boxScrollback } = configSync(homedir())
  for (const { root, ledgers } of live()) {
    stage = `files ${root}`
    const files = await filesOf(root, ledgers)
    stage = `feed ${root}`
    repos.push({
      root,
      name: root.split('/').pop(),
      sessions: ledgers
        .sort((a, b) => a.started - b.started)
        .map(l => {
          const last = Object.values(l.files)
            .flatMap(e => (e.edits ?? []).filter(x => x.t))
            .sort((a, b) => b.at - a.at)[0]
          return {
            id: l.session,
            name: idOf(l),
            label: labels.get(l.session) ?? null,
            ...(states.get(l.session) ?? {}),
            ticket: shortTicket(l.ticket),
            title: said.get(`${root}\0${l.session}`) ?? null,
            doing: last?.t ?? null,
            started: l.started,
            updated: l.updated,
            commitCount: (l.commits ?? []).length,
            commits: (l.commits ?? []).slice(-COMMITS_SENT).reverse().map(c => ({ sha: c.sha, at: c.at, files: c.files.length, t: subjects.get(c.sha) ?? '' })),
          }
        }),
      files,
      feed: await feedOf(root, ledgers, Math.max(1, Number(boxScrollback) || 50)),
    })
  }
  stage = 'queue'
  // The work board's own columns: the queue and the board's waiting tasks. Private titles: the pub scope drops them.
  const q = store(CLAIMS(homedir()))
  const w = q.waiting()
  // a live session's other held tasks (claim `also`): ledgers carry only the current one
  const running = runningSync(homedir())
  const held = claimsSync(homedir())
    .filter(c => c?.session && (!running || running.has(c.session)))
    .flatMap(c => (c.also ?? []).map(a => ({ id: shortTicket(a.ticket), title: a.title ?? null, session: c.session })))
  return { at: Date.now(), repos, held, queue: q.read().map(i => ({ id: i.task, title: i.title ?? null, lane: i.lane, pin: i.pin ?? null })), waiting: Array.isArray(w?.items) ? w.items : [] }
}

// Only a file git lists in a shown repo: never an ignored one (an env file) or one outside the repo.
const fileDoc = async (st, root, rel) => {
  if (!st.repos.some(r => r.root === root) || !(await filesIn(root)).includes(rel)) return null
  const repo = live().find(r => r.root === root)
  if (!repo) return null
  const read = () => {
    try {
      return statSync(join(root, rel)).size <= MAX_TEXT ? readFileSync(join(root, rel), 'utf8') : ''
    } catch {
      return ''
    }
  }
  const authors = { added: {}, removed: {} }
  for (const l of repo.ledgers) {
    const e = l.files[rel]
    if (!e) continue
    for (const side of ['added', 'removed']) for (const k of e[side] ?? []) authors[side][k] = l.session
  }
  const now = read()
  const lines = docLines(await gitAsync(root, ['show', `HEAD:${rel}`], true), now, authors)
  return { text: now, lines: stamp(lines, editTimes(repo.ledgers, rel), x => (x.k === '=' ? '' : x.k)) }
}

// Every session in start order, over all repos: the one color order for the page, the pane, the TUI and the
// band. A match (`only`) keeps it, so a session's color never changes with the filter.
const orderOf = repos => {
  const first = new Map()
  for (const s of repos.flatMap(r => r.sessions)) first.set(s.id, Math.min(first.get(s.id) ?? Infinity, s.started ?? 0))
  return [...first.keys()].sort((a, b) => first.get(a) - first.get(b))
}

// The file list without line data, for the pane; sig changes when anything shown changes.
// A row object is reused while its file is unchanged (filesOf), so its index row and its JSON are worked out once.
const rowIndex = new WeakMap() // file row -> { f: index row, s: its row JSON }
const indexRow = row => {
  let v = rowIndex.get(row)
  if (!v) {
    const { hunks, ...f } = row
    const changes = hunks.map(h => ({
      line: h.new,
      t: h.t,
      said: h.said,
      ...(h.when ? { when: h.when } : {}),
      a: h.a,
      adds: h.lines.filter(x => x.t === '+').length,
      dels: h.lines.filter(x => x.t === '-').length,
    }))
    v = { f: { ...f, changes, adds: changes.reduce((n, c) => n + c.adds, 0), dels: changes.reduce((n, c) => n + c.dels, 0) }, s: JSON.stringify(row) }
    rowIndex.set(row, v)
  }
  return v
}
const indexOf = st => {
  const h = createHash('sha1')
  const repos = st.repos.map(({ files, ...r }) => {
    h.update(JSON.stringify(r))
    return { ...r, files: files.map(row => { const v = indexRow(row); h.update(v.s); return v.f }) }
  })
  const queue = st.queue ?? [], waiting = st.waiting ?? [], held = st.held ?? []
  h.update(JSON.stringify([queue, waiting, held]))
  return { sig: h.digest('hex').slice(0, 16), at: st.at, repos, order: orderOf(repos), queue, waiting, held }
}
// the index as sent: one JSON per build, shared by every reader
const sent = new WeakMap()
const indexJson = ix => {
  let s = sent.get(ix)
  if (!s) sent.set(ix, (s = JSON.stringify(ix)))
  return s
}

const serve = keep => {
  // Read once: a plugin update may delete this version's folder under a running server.
  const page = readFileSync(new globalThis.URL('./view.html', import.meta.url), 'utf8')
  const TYPES = { mjs: 'text/javascript; charset=utf-8', js: 'text/javascript; charset=utf-8', html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', woff2: 'font/woff2', json: 'application/json', svg: 'image/svg+xml' }
  const walk = (dir, pre = '') => readdirSync(new globalThis.URL(dir, import.meta.url), { withFileTypes: true }).flatMap(d => (d.isDirectory() ? walk(`${dir}${d.name}/`, `${pre}${d.name}/`) : [`${pre}${d.name}`]))
  const three = walk('./vendor/three/', 'three/').filter(f => f.endsWith('.js'))
  const icons = readdirSync(new globalThis.URL('./vendor/material-icons/', import.meta.url)).map(f => `material-icons/${f}`)
  const vendor = new Map(
    ['marked.mjs', 'wunderbaum.mjs', 'wunderbaum.css', 'fuse.mjs', 'idiomorph.mjs', 'highlight.mjs', 'split-grid.mjs', 'hljs-light.css', 'hljs-dark.css', 'github-markdown.css', 'bootstrap-icons.css', 'fonts/bootstrap-icons.woff2', 'fonts/fredoka.woff2', 'material-icons.json', ...icons, ...three].map(f => [
      `/vendor/${f}`,
      { type: TYPES[f.split('.').pop()], body: readFileSync(new globalThis.URL(`./vendor/${f}`, import.meta.url)) },
    ]),
  )
  // The shared row rules (gaps, names), served to the page as the pane and `peers tui` import them; no cache, as they change on upgrade.
  const libs = new Map(
    ['rows.mjs', 'path.mjs', 'doc.mjs', 'lines.mjs', 'vendor/diff.mjs'].map(f => [`/lib/${f}`, readFileSync(new globalThis.URL(`./${f}`, import.meta.url))]),
  )
  // The office (3D view): its page and modules, read once like the page.
  const office = new Map(readdirSync(new globalThis.URL('./office/', import.meta.url)).filter(f => /\.(js|html)$/.test(f)).map(f => [`/office/${f === 'index.html' ? '' : f}`, { type: TYPES[f.split('.').pop()], body: readFileSync(new globalThis.URL(`./office/${f}`, import.meta.url)) }]))
  const clients = new Map() // SSE response -> { priv: sees private repos, only: its filter terms }
  // A filter keeps the repos it matches and says what it asked for (paths under home as ~) and what is live.
  const home = homeOf(homedir())
  const only = (st, terms) =>
    !terms.length
      ? st
      : { ...st, repos: pick(st.repos, terms, home), only: terms.map(t => (t.startsWith(`${home}/`) ? `~${t.slice(home.length)}` : t)), live: st.repos.map(r => r.name) }
  // One state for every reader, built in the background, one build at a time. A read takes the last build and
  // never waits for a new one; only the first read waits.
  let cache = null
  let took = 0 // the last build, ms: the next waits 3x that, so a busy repo never holds the loop
  let dirty = true
  const rebuild = oneRun(async () => {
    try {
      while (dirty) {
        dirty = false
        const t0 = Date.now()
        // a build that never settles: drop it after 60 s, name its step
        let hung
        const st = await Promise.race([state(), new Promise((_, no) => (hung = setTimeout(() => no(new Error(`build hung 60 s at ${stage}`)), 60_000)))]).finally(() => clearTimeout(hung))
        const pub = { ...st, repos: st.repos.filter(r => isPublic(r.root)), queue: [], waiting: [], held: [] }
        cache = { all: st, pub, index: { all: indexOf(st), pub: indexOf(pub) } }
        took = Date.now() - t0
      }
    } catch (e) {
      console.error(`state: ${e.stack || e.message}`)
    }
    return cache
  })
  const current = async () => {
    if (dirty) void rebuild()
    return cache ?? (await rebuild()) ?? { all: { repos: [] }, pub: { repos: [] }, index: { all: indexOf({ repos: [] }), pub: indexOf({ repos: [] }) } }
  }
  let last = ''
  let idle = Date.now()
  const push = async () => {
    if (!clients.size) return
    const c = await rebuild()
    if (!c) return
    if (c.index.all.sig === last) return
    last = c.index.all.sig
    let all, pub
    for (const [res, v] of clients)
      if (v.sig) res.write(`data: ${c.index[v.priv ? 'all' : 'pub'].sig}\n\n`)
      else res.write(`data: ${v.only.length ? JSON.stringify(only(v.priv ? c.all : c.pub, v.only)) : v.priv ? (all ??= JSON.stringify(c.all)) : (pub ??= JSON.stringify(c.pub))}\n\n`)
  }
  let timer = null
  const soon = () => {
    dirty = true
    clearTimeout(timer)
    timer = setTimeout(() => void push().catch(e => console.error(`push: ${e.message}`)), Math.max(400, 3 * took))
  }
  // FSEvents on the ledgers and each live repo; build output and git internals are noise.
  const watched = new Set()
  const NOISE = /(^|\/)(node_modules|\.git|\.turbo|dist|build|coverage|\.next|storybook-static)(\/|$)/
  const watchAll = () => {
    // Claude Code's session files and the claims too: a session that goes busy, idle or waits, claims or closes redraws the views.
    const roots = new Set(live().map(r => r.root))
    for (const dir of [LEDGERS, SESSIONS(homedir()), CLAIMS(homedir()), ...roots]) {
      if (watched.has(dir) || !existsSync(dir)) continue
      watched.add(dir)
      try {
        watch(dir, { recursive: true }, (_, f) => {
          if (f && NOISE.test(String(f).replace(/\\/g, '/'))) return
          if (roots.has(dir)) bump(dir)
          soon()
        })
      } catch (e) {
        console.error(`watch ${dir}: ${e.message}`)
      }
    }
  }
  watchAll()
  const say = () => void sayAll().then(c => c && soon(), () => {})
  say()
  setInterval(say, 10000)
  // The watchers miss a session going stale and a transcript's new title: a rebuild every 10 s when a ledger
  // or a session file moved, else every minute.
  let seen = ''
  let built = 0
  const sigNow = () => {
    const out = []
    for (const dir of [SESSIONS(homedir()), CLAIMS(homedir()), ...(existsSync(LEDGERS) ? readdirSync(LEDGERS).map(e => join(LEDGERS, e)) : [])])
      try {
        for (const f of readdirSync(dir)) if (f.endsWith('.json')) out.push(`${f}:${statSync(join(dir, f)).mtimeMs}`)
      } catch {}
    return out.join(',')
  }
  // The board's waiting column: through the CLI (only it talks to the board), each minute while a page is open.
  let waitAt = 0
  const waitNow = () => {
    if (waitAt > Date.now() - 60_000) return
    waitAt = Date.now()
    execFile(process.execPath, [fileURLToPath(new globalThis.URL('../bin/peers.mjs', import.meta.url)), 'waiting', '--write'], { cwd: homedir(), timeout: 60_000, env: { ...process.env, PEERS_SESSION: 'view' } }, e => e && console.error(`waiting: ${e.message.split('\n')[0]}`))
  }
  waitNow()
  // A new install (live.sh) replaces this code: exit one tick after the version on disk moved (rsync writes
  // plugin.json first), and the supervisor starts the new one. A server without one starts again on the next `peers view`.
  let newer = 0
  const diskVersion = () => {
    try {
      return JSON.parse(readFileSync(new globalThis.URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version
    } catch {
      return VERSION
    }
  }
  setInterval(() => {
    if (!process.env.PEERS_VIEW_VERSION && diskVersion() !== VERSION) {
      if (newer) {
        console.error(`view: ${VERSION} -> ${diskVersion()} installed; exiting so the new code runs`)
        process.exit(0)
      }
      newer = Date.now()
    } else newer = 0
    if (clients.size) waitNow()
    watchAll()
    const sig = sigNow()
    if (sig !== seen || Date.now() - built > 60_000) {
      if (Date.now() - built > 60_000) epoch++
      seen = sig
      built = Date.now()
      soon()
    }
    if (!keep && !clients.size && Date.now() - idle > 15 * 60 * 1000) process.exit(0)
  }, 10000)
  // Cloudflare drops a quiet stream after about 100 s.
  setInterval(() => {
    for (const res of clients.keys()) res.write(': ping\n\n')
  }, 25000)

  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  const server = createServer((req, res) =>
    void handle(req, res).catch(e => {
      console.error(`request ${req.url}: ${e.stack || e.message}`)
      if (!res.headersSent) res.writeHead(500)
      res.end()
    }),
  )
  const handle = async (req, res) => {
    // A page from elsewhere that rebinds its name to 127.0.0.1 sends its own Host: refuse it.
    const host = req.headers.host ?? ''
    const priv = [`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(host)
    if (!priv && !(PUBLIC && host === PUBLIC)) return res.writeHead(403).end()
    idle = Date.now()
    const u = new globalThis.URL(req.url, URL)
    const scope = priv ? 'all' : 'pub'
    if (u.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(page)
    }
    const lib = libs.get(u.pathname)
    if (lib) {
      res.writeHead(200, { 'content-type': TYPES.mjs, 'cache-control': 'no-cache' })
      return res.end(lib)
    }
    if (u.pathname === '/office') return res.writeHead(301, { location: `/office/${u.search}` }).end()
    const o = office.get(u.pathname)
    if (o) {
      res.writeHead(200, { 'content-type': o.type, 'cache-control': 'no-cache' })
      return res.end(o.body)
    }
    const v = vendor.get(u.pathname)
    if (v) {
      res.writeHead(200, { 'content-type': v.type, 'cache-control': 'max-age=86400' })
      return res.end(v.body)
    }
    if (u.pathname === '/api/ping') return json(res, 200, { app: 'peers', version: VERSION, pid: process.pid, keep })
    // A newer client stops an older server. This Mac only, and a header a page on another site cannot send without a preflight.
    if (u.pathname === '/api/stop') {
      if (!priv || req.method !== 'POST' || req.headers['x-peers'] !== 'stop') return res.writeHead(403).end()
      res.end('stopping')
      return setImmediate(() => process.exit(0))
    }
    // The band's colors: small, polled each tick.
    if (u.pathname === '/api/order') {
      const ix = (await current()).index[scope]
      if (u.searchParams.get('sig') === ix.sig) return res.writeHead(204).end()
      return json(res, 200, { sig: ix.sig, order: ix.order })
    }
    if (u.pathname === '/api/index') {
      const ix = (await current()).index[scope]
      if (u.searchParams.get('sig') === ix.sig) return res.writeHead(204).end()
      const terms = u.searchParams.getAll('only')
      if (terms.length) return json(res, 200, only(ix, terms))
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      return res.end(indexJson(ix))
    }
    const root = u.searchParams.get('root') ?? ''
    const rel = u.searchParams.get('rel') ?? ''
    if (u.pathname === '/api/hunks') {
      const f = (await current())[scope].repos.find(r => r.root === root)?.files.find(x => x.rel === rel)
      return json(res, f ? 200 : 404, f?.hunks ?? null)
    }
    // The tree and the finder: every listed path, and the headings of each Markdown file.
    if (u.pathname === '/api/files') {
      if (!(await current())[scope].repos.some(r => r.root === root)) return json(res, 404, null)
      const paths = await filesIn(root)
      const heads = paths.filter(isMd).flatMap(rel => headingsAt(join(root, rel)).map(x => ({ rel, ...x })))
      return json(res, 200, { paths, heads })
    }
    if (u.pathname === '/api/doc') {
      const body = await fileDoc((await current())[scope], root, rel)
      return json(res, body ? 200 : 404, body)
    }
    if (u.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      const terms = u.searchParams.getAll('only')
      // ?sig=1: only the new sig on each change, for the band: it then reads what it needs.
      const sig = u.searchParams.has('sig')
      const c = await current()
      res.write(`data: ${sig ? c.index[scope].sig : JSON.stringify(only(c[scope], terms))}\n\n`)
      clients.set(res, { priv, only: terms, sig })
      req.on('close', () => {
        clients.delete(res)
        idle = Date.now()
      })
      return
    }
    res.writeHead(404).end()
  }
  let tries = 0
  server
    .on('error', async e => {
      console.error(`listen ${PORT}: ${e.message}`)
      // The supervised server owns the port: it stops a detached one, or an older supervised one, and listens again.
      const p = e.code === 'EADDRINUSE' && keep && tries++ < 5 ? await ping() : null
      if (p && !p.old && (!p.keep || older(p.version, VERSION)) && (await stopServer())) return setTimeout(() => server.listen(PORT, '127.0.0.1'), 500)
      process.exit(1)
    })
    .listen(PORT, '127.0.0.1')
}

// The server on the port: { app, version, pid, keep }, { old: true } for one before 0.16.7 (it answers plain text), or null.
export const ping = () =>
  new Promise(ok => {
    const r = get(`${URL}api/ping`, { agent: false }, res => {
      let body = ''
      res.on('data', d => (body += d))
      res.on('end', () => {
        if (res.statusCode !== 200) return ok(null)
        try {
          ok(JSON.parse(body))
        } catch {
          ok({ old: true })
        }
      })
    })
    r.on('error', () => ok(null))
    r.setTimeout(1000, () => (r.destroy(), ok(null)))
  })
const stopServer = () =>
  new Promise(ok => {
    const r = request(`${URL}api/stop`, { method: 'POST', headers: { 'x-peers': 'stop' }, agent: false }, res => (res.resume(), ok(res.statusCode === 200)))
    r.on('error', () => ok(false))
    r.setTimeout(1000, () => (r.destroy(), ok(false)))
    r.end()
  })
const waitFor = async (want, ms) => {
  for (let t = 0; t < ms; t += 100) {
    if (want(await ping())) return true
    await sleep(100)
  }
  return false
}

// One server, at least this version. Every client runs it: `peers view`, the TUI and the pane (through `peers view --no-open`).
// An older server stops; a supervised one comes back on the new code through ~/.local/bin/peers, else this
// starts one. At most about 9 s: the pane waits 10.
export const ensure = async () => {
  let p = await ping()
  if (p?.old) return console.error(`peers: a peers view server from before 0.16.7 holds port ${PORT} and cannot be stopped from here. Stop it once by hand (see README, Install).`)
  if (p && older(p.version, VERSION) && (await stopServer())) {
    await waitFor(x => !x || x.pid !== p.pid, 2000)
    p = p.keep && (await waitFor(x => x && x.pid !== p.pid, 3000)) ? await ping() : null
  }
  if (p) return
  spawn(process.execPath, [fileURLToPath(new globalThis.URL('../bin/peers.mjs', import.meta.url)), 'view', '--serve'], { detached: true, stdio: 'ignore', env: process.env, windowsHide: true }).unref()
  await waitFor(Boolean, 4000)
}

const up = async () => !!(await ping())

// `peers view --install [--host <public host>]`: the OS supervisor (lib/platform.mjs: launchd, systemd, the Windows
// Startup folder) keeps the server up. It runs the stable shim, so a restart picks up the newest version.
const sleep = ms => new Promise(r => setTimeout(r, ms))
const os = platform(process.platform)
export const supervision = (host = '') => {
  const vars = {}
  if (host) vars.PEERS_VIEW_HOST = host
  if (process.env.BACKLOG_CWD) vars.BACKLOG_CWD = process.env.BACKLOG_CWD
  const home = homeOf(homedir())
  const appData = process.env.APPDATA ? slash(process.env.APPDATA, true) : undefined
  const base = { home, node: process.execPath, uid: process.getuid?.(), appData, vars }
  return { sv: os.supervisor, c: { ...base, log: os.supervisor.log(base) } }
}
const quiet = ([cmd, ...args]) => {
  try {
    execFileSync(cmd, args, { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}
export const loaded = ({ sv, c } = supervision()) => quiet(sv.loaded(c))
const stopSupervisor = async ({ sv, c }) => {
  for (const a of sv.stop(c)) quiet(a)
  for (let i = 0; i < 50 && loaded({ sv, c }); i++) await sleep(100)
  // Windows: stopping wscript's loop leaves its server running.
  if ((await ping())?.keep) await stopServer()
}
const install = async host => {
  const s = supervision(host)
  const { sv, c } = s
  const path = sv.path(c)
  mkdirSync(dirname(path), { recursive: true })
  mkdirSync(dirname(c.log), { recursive: true })
  writeFileSync(path, sv.text(c))
  await stopSupervisor(s)
  // A detached server from `peers view` may hold the port; the new server stops it over /api/stop.
  for (let i = 0; i < 5 && !loaded(s); i++) {
    for (const [cmd, ...args] of sv.start(c))
      if (sv.detach) spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
      else quiet([cmd, ...args])
    for (let j = 0; j < 10 && !loaded(s); j++) await sleep(100)
  }
  for (let i = 0; i < 50 && !(await up()); i++) await sleep(300)
  if (!(await up())) {
    console.error(`peers view: ${sv.name} did not bring the server up; log ${c.log}`)
    process.exit(1)
  }
  console.log(`peers view: ${sv.name} keeps the server up${host ? `, public host ${host}` : ''}; log ${c.log}`)
}
const uninstall = async () => {
  const s = supervision()
  await stopSupervisor(s)
  rmSync(s.sv.path(s.c), { force: true })
  console.log(`peers view: removed from ${s.sv.name}`)
}

export const view = async () => {
  const argv = process.argv
  if (argv.includes('--serve')) return serve(argv.includes('--keep'))
  if (argv.includes('--install')) return install(argv.includes('--host') ? argv[argv.indexOf('--host') + 1] : '')
  if (argv.includes('--uninstall')) return uninstall()
  await ensure()
  // `peers view wren ..`: the page shows only the repos those words match.
  const words = argv.slice(3).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--host')
  const q = onlyQuery(terms(words, process.cwd(), homedir())).replace('&', '?')
  // --office: the 3D office (rooms per repo, a desk per session, the task board) over the same data
  const to = `${URL}${argv.includes('--office') ? 'office/' : ''}${q}`
  console.log(to)
  const [cmd, ...args] = os.opener(to)
  if (!process.argv.includes('--no-open')) spawn(cmd, args, { stdio: 'ignore', windowsHide: true }).unref()
}

