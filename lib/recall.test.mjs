// node lib/recall.test.mjs — recall over a fixture transcript: chapters, kinds, subagents, tool-results, around
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { recall, around } from './recall.mjs'

const results = []
const check = (name, got, want) => results.push([name, JSON.stringify(got) === JSON.stringify(want), got, want])

const home = mkdtempSync(join(tmpdir(), 'recall-'))
const sid = 'sess-1'
const proj = join(home, '.claude', 'projects', '-x')
mkdirSync(join(proj, sid, 'subagents'), { recursive: true })
mkdirSync(join(proj, sid, 'tool-results'), { recursive: true })
const at = i => `2026-11-10T10:00:${String(i).padStart(2, '0')}.000Z`
const user = (i, content, extra = {}) => ({ type: 'user', uuid: `u${i}`, timestamp: at(i), message: { role: 'user', content }, ...extra })
const asst = (i, content) => ({ type: 'assistant', uuid: `a${i}`, timestamp: at(i), message: { role: 'assistant', content } })
const lines = [
  user(1, 'the deploy key lives in vault slot "blue-7"'),
  asst(2, [{ type: 'text', text: 'Noted: blue-7.' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls deploy', description: 'List deploy dir' } }]),
  user(3, [{ type: 'tool_result', content: [{ type: 'text', text: 'deploy.sh migrate.sql' }] }]),
  { type: 'api-request-blob', uuid: 'r1', timestamp: at(4), body: 'blue-7 deploy copy' },
  { type: 'system', subtype: 'compact_boundary', uuid: 'c1', timestamp: at(5) },
  user(6, 'Summary: we listed the deploy dir.', { isCompactSummary: true }),
  asst(7, [{ type: 'tool_use', name: 'Bash', input: { command: 'peers recall blue-7' } }]),
  asst(8, [{ type: 'text', text: 'back to the migration' }]),
]
writeFileSync(join(proj, `${sid}.jsonl`), lines.map(l => JSON.stringify(l)).join('\n') + '\n')
writeFileSync(join(proj, sid, 'subagents', 'agent-z.jsonl'), JSON.stringify(asst(9, [{ type: 'text', text: 'subagent saw blue-7 too' }])) + '\n')
writeFileSync(join(proj, sid, 'tool-results', 'big.txt'), 'a long output that names blue-7 once')

const r = await recall({ home, session: sid, terms: ['blue-7'] })
check('every source, newest first; raw request copies and recall calls skipped', r.hits.map(h => `${h.source}:${h.kind}`).sort(), ['main:assistant', 'main:user', 'subagent:agent-z:assistant', 'tool-result:big.txt:result'].sort())
check('chapters count compactions', [r.chapters, r.hits.find(h => h.uuid === 'u1').chapter], [1, 0])
check('words are AND, any case', (await recall({ home, session: sid, terms: ['DEPLOY', 'dir'], subagents: false, results: false })).hits.map(h => `${h.uuid}:${h.kind}`), ['u6:summary', 'a2:tool:Bash'])
check('a quote in a word still matches', (await recall({ home, session: sid, terms: ['"blue-7"'] })).hits.map(h => h.uuid), ['u1'])
check('regex', (await recall({ home, session: sid, terms: ['migra(te|tion)'], regex: true, results: false })).hits.map(h => h.uuid), ['a8', 'u3'])
check('a long text is cut round the match', (await recall({ home, session: sid, terms: ['once'], width: 12 })).hits[0].text, '[…] blue-7 once')
const a = await around({ home, session: sid, uuid: 'a2', n: 1 })
check('around: the turn and one each side', a.turns.map(t => t.uuid), ['u1', 'a2', 'u3'])
check('no transcript', (await recall({ home, session: 'nope', terms: ['x'] })).error, 'no transcript for this session')
rmSync(home, { recursive: true })

let bad = 0
for (const [name, ok, got, want] of results) {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`)
}
process.exit(bad ? 1 : 0)
