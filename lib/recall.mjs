// recall: search a Claude Code session's full transcript, compacted parts included (WA-1272). Read only.
// Sources: <project>/<session>.jsonl, its subagents/*.jsonl, its tool-results/* (outputs too big for the transcript).
// No index: a streamed scan, a raw-line prefilter before JSON.parse. Chapter = compactions before the turn.
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { createInterface } from 'node:readline'

export const PROJECTS = home => join(home, '.claude', 'projects')

// the session's transcript, in any project folder
export const transcriptOf = (home, session) => {
  const root = PROJECTS(home)
  if (!existsSync(root)) return null
  for (const d of readdirSync(root)) {
    const f = join(root, d, `${session}.jsonl`)
    if (existsSync(f)) return { file: f, dir: join(root, d, session) }
  }
  return null
}

// searchable blocks of one record: [{ kind, text }]
export const blocksOf = d => {
  if (d.type === 'system' && d.subtype === 'compact_boundary') return [{ kind: 'compaction', text: '' }]
  if (d.type !== 'user' && d.type !== 'assistant') return []
  const c = d.message?.content
  if (typeof c === 'string') return [{ kind: d.isCompactSummary ? 'summary' : d.type, text: c }]
  const out = []
  for (const b of c ?? []) {
    if (b.type === 'text') out.push({ kind: d.isCompactSummary ? 'summary' : d.type, text: b.text })
    else if (b.type === 'tool_use') {
      const i = b.input ?? {}
      // a recall call is not a memory: skip it
      if (b.name === 'Bash' && /\bpeers recall\b/.test(i.command ?? '')) continue
      out.push({ kind: `tool:${b.name}`, text: typeof i.command === 'string' ? `${i.description ? `# ${i.description}\n` : ''}${i.command}` : JSON.stringify(i, null, 1) })
    }
    else if (b.type === 'tool_result') {
      const t = typeof b.content === 'string' ? b.content : (b.content ?? []).filter(x => x.type === 'text').map(x => x.text).join('\n')
      out.push({ kind: 'result', text: t })
    }
  }
  return out
}

const matcher = (terms, regex) => {
  if (regex) {
    const re = new RegExp(terms.join(' '), 'i')
    return { raw: () => true, test: t => re.test(t), first: t => t.search(re) }
  }
  const low = terms.map(t => t.toLowerCase())
  // raw JSON line: escapes differ from the text, so the prefilter checks only escape-free terms
  const plain = low.filter(t => !/["\\\n\t]/.test(t))
  const res = plain.map(t => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')) // no lowercase copy of a 1 MB line
  return {
    raw: line => res.every(r => r.test(line)),
    test: t => { const l = t.toLowerCase(); return low.every(x => l.includes(x)) },
    first: t => t.toLowerCase().indexOf(low[0]),
  }
}

const snip = (text, at, width) => {
  if (text.length <= width) return text
  const s = Math.max(0, Math.min(text.length - width, at - Math.floor(width / 3)))
  return `${s ? '[…] ' : ''}${text.slice(s, s + width).trim()}${s + width < text.length ? ' […]' : ''}`
}

// raw request copies (record type first on the line): no new text, a quarter of a big transcript
const SKIP = /^\{"type":"(api-request[a-z-]*|file-history-[a-z]+)"/
// one transcript file: every hit, oldest first
async function scan(file, source, m, width, hits) {
  let chapter = 0
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    const head = line.slice(0, 300)
    if (SKIP.test(head)) continue
    const boundary = head.includes('"compact_boundary"') || line.includes('"subtype":"compact_boundary"')
    if (!boundary && !m.raw(line)) continue
    let d
    try { d = JSON.parse(line) } catch { continue }
    for (const b of blocksOf(d)) {
      if (b.kind === 'compaction') { chapter++; continue }
      if (!m.test(b.text)) continue
      hits.push({ source, uuid: d.uuid, at: d.timestamp, chapter, kind: b.kind, size: b.text.length, text: snip(b.text, m.first(b.text), width) })
    }
  }
  return chapter
}

// recall({ home, session, terms, regex, limit, width, subagents, results }) → { session, file, chapters, hits (newest first) }
export async function recall({ home, session, terms, regex = false, limit = 20, width = 600, subagents = true, results = true }) {
  const t = transcriptOf(home, session)
  if (!t) return { session, error: 'no transcript for this session' }
  const m = matcher(terms, regex)
  const hits = []
  const chapters = await scan(t.file, 'main', m, width, hits)
  const sub = join(t.dir, 'subagents')
  if (subagents && existsSync(sub))
    for (const f of readdirSync(sub).filter(f => f.endsWith('.jsonl'))) await scan(join(sub, f), `subagent:${basename(f, '.jsonl')}`, m, width, hits)
  const tr = join(t.dir, 'tool-results')
  if (results && existsSync(tr))
    for (const f of readdirSync(tr)) {
      const p = join(tr, f)
      const text = readFileSync(p, 'utf8')
      if (m.test(text)) hits.push({ source: `tool-result:${f}`, uuid: null, at: statSync(p).mtime.toISOString(), chapter: null, kind: 'result', size: text.length, text: snip(text, m.first(text), width), path: p })
    }
  hits.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  return { session, file: t.file, chapters, total: hits.length, hits: hits.slice(0, limit) }
}

// one turn in full, with `n` turns each side (same file, by uuid)
export async function around({ home, session, uuid, n = 2, source = 'main' }) {
  const t = transcriptOf(home, session)
  if (!t) return { session, error: 'no transcript for this session' }
  const file = source.startsWith('subagent:') ? join(t.dir, 'subagents', `${source.slice(9)}.jsonl`) : t.file
  const turns = [] // ring of the last n turns before the hit
  let hit = -1, chapter = 0, after = 0
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"') && !line.includes('compact_boundary')) continue
    let d
    try { d = JSON.parse(line) } catch { continue }
    const bs = blocksOf(d)
    if (bs[0]?.kind === 'compaction') { chapter++; continue }
    if (!bs.length) continue
    const turn = { uuid: d.uuid, at: d.timestamp, chapter, blocks: bs }
    if (hit < 0) {
      turns.push(turn)
      if (d.uuid === uuid) hit = turns.length - 1
      else if (turns.length > n) turns.shift()
    } else if (after < n) { turns.push(turn); after++ } else break
  }
  rl.close()
  return hit < 0 ? { session, error: `no turn ${uuid}` } : { session, source, turns }
}
