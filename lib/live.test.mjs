// node lib/live.test.mjs — live edits: line times from the ledger (doc.mjs) and arrivals, flags, carets (office/livefx.js).
import { editTimes, stamp } from './doc.mjs'
import { key } from './lines.mjs'
import { typeChars, createLive } from './office/livefx.js'

const results = []
const check = (name, got, want) => results.push([name, JSON.stringify(got) === JSON.stringify(want), got, want])

const ledgers = [{ session: 'a', files: { 'x.js': { edits: [{ at: 100, k: [key('const one = 1')] }, { at: 300, k: [key('const one = 1')] }] } } }, { session: 'b', files: { 'x.js': { edits: [{ at: 200, k: [key('let two = 2')] }] } } }]
const t = editTimes(ledgers, 'x.js')
check('a key takes its newest edit', t.get(key('const one = 1')), 300)
const ls = [{ t: ' ', s: 'ctx' }, { t: '+', s: 'const one = 1', a: 'a' }, { t: '+', s: '}', a: 'a' }, { t: '+', s: 'let two = 2', a: 'b' }, { t: ' ', s: 'ctx' }]
stamp(ls, t, x => (x.t === ' ' ? '' : x.t))
check('a plain line takes its run time; runs split by author', ls.map(x => x.at ?? null), [null, 300, 300, 200, null])

let now = 1000
const live = createLive({ sigOf: x => (x.t === ' ' ? null : x.t + x.s), now: () => now })
const v1 = [{ t: '+', s: 'old', a: 'a', at: 900 }]
check('the first read only learns', live.update('f', v1), 0)
now = 2000
const v2 = [...v1, { t: '+', s: 'n1', a: 'b' }, { t: '+', s: 'n2', a: 'b' }, { t: '-', s: 'gone', a: 'b' }]
check('new lines arrive', live.update('f', v2), 3)
now = 2500
const m = live.marks('f', v2, { nameOf: id => id.toUpperCase(), colorOf: () => '#123' })
check('arrivals type in, resumed by time', [m.get(v2[1]).cls, m.get(v2[1]).style], ['ln-in', '--el:-500ms;--st:0ms;--ty:28ms;--cs:14ms;'])
check('line by line: the next line starts when the one above ends', [m.get(v2[2]).style.match(/--st:(\d+)ms/)[1], m.get(v2[3]).style.match(/--st:(\d+)ms/)[1]], ['68', '136'])
check('one flag per run, with its counts', [/B \+2 −1/.test(m.get(v2[1]).flag), m.get(v2[2]).flag], [true, ''])
check('each author has one caret: their newest line', [...m.values()].filter(x => x.caret).length, 2)
check('the caret sits on the last line of the newest run', !!m.get(v2[3]).caret, true)
now = 9000
live.update('f', v2)
check('past the hold, no arrival', live.marks('f', v2, { nameOf: String, colorOf: String }).get(v2[1])?.cls ?? '', '')

let bad = 0
{ // an unchanged-here row between two parts of one arrival: still one flag; abs mode writes a stable --t0
  let n = 1000; const L = createLive({ sigOf: x => (x.t === ' ' ? null : x.t + x.s), now: () => n })
  const w1 = [{ t: '+', s: 'keep', a: 'a' }]; L.update('g', w1); n = 2000
  const w2 = [{ t: '-', s: 'x1', a: 'a' }, w1[0], { t: '+', s: 'y1', a: 'a' }, { t: '+', s: 'y2', a: 'a' }]; L.update('g', w2); n = 2300
  const mk = L.marks('g', w2, { nameOf: id => id, colorOf: () => '#123', abs: true })
  check('one flag per arrival across a gap', [...mk.values()].filter(v => v.flag).map(v => />(.*)</.exec(v.flag)[1]), ['a +2 −1'])
  check('abs mode keeps the HTML stable', mk.get(w2[0]).style, '--t0:2000;--st:0ms;--ty:28ms;--cs:14ms;')
}
check('typed: tags kept, an entity is one character', typeChars('<b>a</b>&lt;'), '<b><ln-c style="--k:0">a</ln-c></b><ln-c style="--k:1">&lt;</ln-c>')
for (const [name, ok, got, want] of results) {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`)
}
process.exit(bad ? 1 : 0)
