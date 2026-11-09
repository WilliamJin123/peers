// Demo feed: a seeded story in the office model, for the page with no view server (Pages) or ?demo.
// ?demo=empty: no sessions. ?demo=many: 9 repos, 22 sessions, long names, a full room (layout and overflow checks).
import { createModel, statusOf } from './model.js'

const COLORS = ['#4a86e8', '#e8590c', '#37b24d', '#be4bdb', '#e64980', '#15aabf', '#f08c00', '#7950f2']
const STORY = {
  repos: { wren: ['packages/variants/store.ts', 'packages/variants/collect.ts', 'packages/portal/shell.tsx', 'packages/portal/chat.tsx', 'db/schema.ts', 'scripts/push.sh'],
    peers: ['lib/core.mjs', 'lib/lines.mjs', 'lib/hook.mjs', 'bin/peers.mjs'], vireo: ['src/index.ts', 'src/stats.ts', 'drizzle/0007_ships.sql'],
    engine: ['birdwatch/brief.ts', 'birdwatch/follow.ts', 'read/ladder.ts', 'read/video.ts'] },
  sessions: [
    ['wren work', 'wren', 'WA-1154', 'Vireo chat agent'], ['portal ui', 'wren', 'WA-1144', 'Shell side chat'], ['peers dev', 'peers', 'WA-1181', 'Ledger size cap'],
    ['devsite', 'vireo', 'WA-1140', 'Hero batch 5'], ['birdwatch dev', 'engine', 'WA-1157', 'Follow by person'], ['runs', 'engine', null, ''],
  ],
  late: ['sweep fix', 'peers', 'WA-1178', 'Claims sweep'],
}
const LINES = ['can you leave store.ts to me?', 'pushed, CI green', 'drizzle files are yours', 'taking lines 40-80', 'rebased on main']
const COMMITS = ['fix race in collect', 'add ship ledger', 'cap ledger size', 'side chat skeleton', 'follow --as posts', 'batch 5 tones']
const WHY = ['permission: git push', 'asks: which tone?', 'permission: rm -rf dist']

const WORDS = { n: ['ledger', 'batch', 'rows', 'session', 'hold', 'claim', 'variant', 'ship', 'brief', 'page'], f: ['load', 'merge', 'sweep', 'collect', 'emit', 'take', 'drop', 'read', 'cap'], k: ['id', 'size', 'at', 'who', 'sha', 'repo'] }
const pickW = (g, k) => { const a = WORDS[k] ?? WORDS.n; return a[Math.floor(g() * a.length)] }
const SNIP = {
  ts: ['const $n = await $f($n.$k)', 'if (!$n) return null', 'export function $f($n: $N) {', '  return $n.filter((x) => x.$k)', '  $n.$k = Date.now()', '}', "import { $f } from './$n'", '  const $k = $n.$k ?? 0', '  await db.insert($n).values({ $k })'],
  tsx: ['  <$N $k={$n.$k} />', 'const [$n, set] = useState(0)', 'return <div className="$n">{$n.$k}</div>', '  onClick={() => $f($n)}', "import { $f } from './$n'"],
  mjs: ['const $n = $f($n)', "if ($n.$k) throw new Error('$n')", 'export async function $f($n) {', '  for (const x of $n) x.$k++', '}', '  return { $k: $n.$k }'],
  sql: ['ALTER TABLE $n ADD COLUMN $k text;', 'CREATE INDEX $n_$k ON $n ($k);', 'UPDATE $n SET $k = now();', '-- $f $n'],
  sh: ['set -euo pipefail', '$f "$n" || exit 1', 'echo "$n: $k"', 'git -C "$n" push'],
}
SNIP.mjs = SNIP.mjs.map((x) => x.replace('$N', 'Map'))
for (const k of Object.keys(SNIP)) SNIP[k] = SNIP[k].map((x) => x.replace(/\$N/g, 'Row'))
const HEADS = { ts: (g) => `function ${pickW(g, 'f')}${pickW(g, 'n')}()`, tsx: (g) => `function ${pickW(g, 'n')}Card()`, mjs: (g) => `export function ${pickW(g, 'f')}()` }

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

function many() {
  const names = ['wren', 'peers', 'vireo', 'engine', 'lander', 'autobrowse', 'credvault', 'a-very-long-repository-name-for-layout', 'strata']
  const repos = Object.fromEntries(names.map((n) => [n, ['src/index.ts', 'src/a-really-long-module-name-that-keeps-going.ts', 'README.md']]))
  const sessions = []
  const room = (r, k) => { for (let i = 0; i < k; i++) sessions.push([`${r} ${i ? `helper ${i}` : 'lead'}`, r, i % 2 ? null : `WA-${1200 + sessions.length}`, i % 3 ? 'Short task' : 'A task title long enough that it has to wrap onto a second line on the card']) }
  room('wren', 8); room('peers', 3); room('vireo', 2); room('engine', 2); room('lander', 1); room('autobrowse', 2); room('credvault', 1); room('a-very-long-repository-name-for-layout', 2); room('strata', 1)
  sessions[2][0] = 'williamjin@macmiller/peers-dev-session-with-a-long-name'
  return { repos, sessions }
}

export function createDemo(kind = 'story') {
  const m = createModel('demo')
  const r = rng(7)
  const pick = (a) => a[Math.floor(r() * a.length)]
  const src = kind === 'many' ? many() : kind === 'empty' ? { repos: {}, sessions: [] } : STORY
  let n = 0, sha = 0x3a91c
  const ad = new Map() // key → { adds, dels, edits }: uncommitted change per file
  const add = ([name, repo, taskId, task]) => {
    const x = { id: `cc-${(0x1000 + n * 977).toString(16)}`, name, color: COLORS[n % COLORS.length], repo, state: 'work', why: null, closed: false, holds: new Map(), focus: null, taskId, task, commits: 2 + ((n * 3) % 5), shas: [] }
    n++
    const fs = src.repos[repo]
    for (let i = 0; i < 2; i++) x.holds.set(`${repo}/${pick(fs)}`, 5 + Math.floor(r() * 30))
    m.byId[x.id] = x
    return x
  }
  for (const s of src.sessions) add(s)
  if (kind === 'many') Object.values(m.byId).forEach((x, i) => { x.state = ['work', 'work', 'idle', 'blocked'][i % 4]; if (x.state === 'blocked') x.why = WHY[i % 3] })
  const done = []
  const sync = () => {
    m.sessions = Object.values(m.byId)
    m.repos = Object.keys(src.repos).filter((id) => m.sessions.some((x) => x.repo === id)).map((id) => ({ id, name: id }))
    const tasks = new Map()
    for (const x of m.sessions) if (x.taskId) {
      const t = tasks.get(x.taskId) ?? m.taskById[x.taskId] ?? { id: x.taskId, files: new Set(), commits: [] }
      Object.assign(t, { title: x.task, repo: x.repo, holders: [...(tasks.get(x.taskId)?.holders ?? []), x.id] })
      for (const k of x.holds.keys()) t.files.add(k)
      tasks.set(x.taskId, t)
    }
    for (const t of tasks.values()) t.status = statusOf(t, m.byId)
    m.tasks = [...tasks.values(), ...done.filter((t) => !tasks.has(t.id)).slice(-6)]
    m.taskById = Object.fromEntries(m.tasks.map((t) => [t.id, t]))
  }
  sync()
  const emit = (e) => { m.emit(e); sync(); m.emit({ type: 'sync' }) }
  const setState = (x, st, why = null) => { if (x.state === st) return; x.state = st; x.why = why; x.since = t; emit({ type: 'state', who: x.id, state: st, why }) }
  let t = 0
  for (const x of m.sessions) x.since = 0

  function step() {
    t++
    if (kind === 'story' && t === 18) { const x = add(STORY.late); x.since = t; emit({ type: 'join', who: x.id }) }
    for (const x of [...m.sessions]) {
      const age = t - x.since
      if (x.state === 'blocked') { if (age > 9 && r() < 0.25) setState(x, 'work'); continue }
      if (x.state === 'idle') {
        if (age > 5 && r() < 0.2) {
          setState(x, 'work')
          if (!x.taskId && x.lastTask) { x.taskId = x.lastTask.id; x.task = x.lastTask.title; emit({ type: 'claim', who: x.id, id: x.taskId, task: x.task }) }
        }
        continue
      }
      const roll = r()
      const fs = src.repos[x.repo]
      if (roll < 0.42) {
        const key = `${x.repo}/${x.holds.size && r() < 0.65 ? pick([...x.holds.keys()]).slice(x.repo.length + 1) : pick(fs)}`
        const other = m.sessions.find((y) => y !== x && y.holds.has(key))
        if (other) { emit({ type: 'clash', who: x.id, other: other.id, key }); continue }
        const add = 1 + Math.floor(r() * 18), rem = Math.floor(r() * 8)
        x.holds.set(key, (x.holds.get(key) || 0) + add + rem)
        x.focus = key
        const d = ad.get(key) ?? { adds: 0, dels: 0, edits: [] }; d.adds += add; d.dels += rem; d.edits.push({ who: x.id, add, rem, at: t }); ad.set(key, d)
        emit({ type: 'edit', who: x.id, key, add, rem })
      } else if (roll < 0.5 && x.holds.size >= 2) {
        const keys = [...x.holds.keys()]
        for (const k of keys) ad.delete(k)
        x.holds.clear(); x.focus = null; x.commits++
        sha += 0x1f3 + Math.floor(r() * 0xfff)
        const s = sha.toString(16).slice(-7)
        x.shas.unshift(s)
        const tk = x.taskId && m.taskById[x.taskId]; if (tk) tk.commits.push(s)
        emit({ type: 'commit', who: x.id, keys, sha: s, msg: pick(COMMITS), task: x.taskId })
      } else if (roll < 0.56 && m.sessions.length > 1) {
        emit({ type: 'msg', from: x.id, to: pick(m.sessions.filter((y) => y !== x)).id, text: pick(LINES) })
      } else if (roll < 0.58) {
        setState(x, 'blocked', pick(WHY))
      } else if (roll < 0.62 && x.holds.size === 0 && x.taskId) {
        const tk = m.taskById[x.taskId]
        x.lastTask = { id: x.taskId, title: x.task }
        const id = x.taskId; x.taskId = null; x.task = ''
        if (tk && !m.sessions.some((y) => y.taskId === id)) done.push(Object.assign(tk, { holders: [], status: 'Done' }))
        emit({ type: 'close', who: x.id, id })
        setState(x, 'idle')
      }
    }
  }
  if (kind !== 'empty') setInterval(step, 1100)
  m.ready = Promise.resolve()
  m.fileInfo = (key) => {
    const hs = m.sessions.filter((x) => x.holds.has(key))
    if (!hs.length) return null
    const d = ad.get(key) ?? { adds: hs.reduce((a, x) => a + x.holds.get(key), 0), dels: 0, edits: hs.map((x) => ({ who: x.id, add: x.holds.get(key), rem: 0, at: 0 })) }
    return { lines: 40 + (key.length * 37) % 600, holders: hs.map((x) => x.id), adds: d.adds, dels: d.dels, edits: d.edits }
  }
  // synthetic hunks: code-like lines for the file type; + lines by the session that made each edit
  m.diff = async (key) => {
    const f = m.fileInfo(key)
    if (!f) return null
    const g = rng([...key].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, f.adds))
    const ext = key.split('.').pop(), L = SNIP[ext] ?? SNIP.ts
    const line = () => L[Math.floor(g() * L.length)].replace(/\$(\w)/g, (_, k) => pickW(g, k))
    const hunks = []
    let o = 12 + Math.floor(g() * 40), nn = o
    for (const e of f.edits.slice(-3)) {
      const lines = [], ctx = () => lines.push({ t: ' ', s: line(), a: null, o: o++, n: nn++ })
      ctx(); ctx()
      for (let i = 0; i < Math.min(e.rem, 4); i++) lines.push({ t: '-', s: line(), a: null, o: o++, n: null })
      for (let i = 0; i < Math.min(e.add, 7); i++) lines.push({ t: '+', s: line(), a: e.who, o: null, n: nn++ })
      ctx()
      hunks.push({ at: HEADS[ext]?.(g) ?? '', who: e.who, lines })
      const jump = 20 + Math.floor(g() * 30); o += jump; nn += jump
    }
    await new Promise((res) => setTimeout(res, 120))
    return hunks
  }
  return m
}
