// node lib/queue.test.mjs — lib/queue.mjs: the work queue's order, who may take an item, the quiet gate.
import { deliveryId, labelsOf, mayTake, pick, place, promptOf, queueLines, quiet } from './queue.mjs'
import { spread } from './core.mjs'

const results = []
const check = (name, got, want) => results.push([name, JSON.stringify(got) === JSON.stringify(want), got, want])
const I = (task, x = {}) => ({ task, title: `t ${task}`, lane: 'main', pin: null, by: 'plan', at: 1, ...x })
const ids = items => items.map(i => i.task)

{
  const q = [I('A'), I('B'), I('C')]
  check('place: last by default', ids(place(q, I('D'))), ['A', 'B', 'C', 'D'])
  check('place: --top', ids(place(q, I('D'), { top: true })), ['D', 'A', 'B', 'C'])
  check('place: --after', ids(place(q, I('D'), { after: 'a' })), ['A', 'D', 'B', 'C'])
  check('place: a queued task moves, no copy', ids(place(q, I('c'), { top: true })), ['c', 'A', 'B'])
  let threw = false
  try {
    place(q, I('D'), { after: 'X' })
  } catch {
    threw = true
  }
  check('place: --after a task not queued throws', threw, true)
}
{
  const sop = I('S', { lane: 'sop' })
  const pinned = I('P', { lane: 'sop', pin: 'ui dev' })
  check('mayTake: a lane it serves', mayTake(sop, 'x', ['sop']), true)
  check('mayTake: a lane it does not serve', mayTake(sop, 'x', ['ui']), false)
  check('mayTake: every lane', mayTake(sop, 'x', '*'), true)
  check('mayTake: no serve file', mayTake(sop, 'x', null), false)
  check('mayTake: a pin reaches its session without serve', mayTake(pinned, 'ui dev', null), true)
  check('mayTake: a pin is not for a session that serves its lane', mayTake(pinned, 'other', ['sop']), false)
  check('mayTake: a session with no name takes no pin', mayTake(pinned, null, '*'), false)
  check('pick: the first it may take, in order', pick([pinned, I('M'), sop], 'x', ['sop'])?.task, 'S')
  check('pick: none', pick([pinned], 'x', ['ui']), null)
}
{
  const i = I('WA-9', { lane: 'sop', pin: 'Peers Dev', at: 42 })
  check('deliveryId', deliveryId(i), 'q-WA-9-42')
  check('labelsOf', labelsOf(i), ['queued', 'lane:sop', 'pin:peers-dev'])
  check('promptOf carries the id', promptOf({ item: i, id: deliveryId(i) }).startsWith('[peers work queue q-WA-9-42] WA-9: t WA-9.'), true)
}
{
  check('quiet: idle long enough', quiet({ status: 'idle', waitingFor: null, statusAt: 0 }, 60_000, 60_000), true)
  check('quiet: idle, too soon', quiet({ status: 'idle', waitingFor: null, statusAt: 1 }, 60_000, 60_000), false)
  check('quiet: a background shell runs', quiet({ status: 'shell', waitingFor: null, statusAt: 0 }, 60_000, 60_000), true)
  check('quiet: busy', quiet({ status: 'busy', statusAt: 0 }, 1e9, 60_000), false)
  check('quiet: a question waits', quiet({ status: 'idle', waitingFor: 'question', statusAt: 0 }, 1e9, 60_000), false)
  check('quiet: no session file', quiet(null, 1e9, 0), false)
}
{
  const lines = queueLines([I('A', { lane: 'sop' }), I('B', { lane: 'ui' }), I('C', { pin: 'gone' })], new Map([['s1', ['sop']], ['dead', ['ui']]]), new Map([['s1', 'sop dev']]), new Set(['s1']))
  check('queueLines: served lane', lines[0].includes('served by sop dev'), true)
  check('queueLines: a lane only a dead session serves', lines[1].includes('no live session serves this lane'), true)
  check('queueLines: a pin not running', lines[2].includes('for gone (not running: waits)'), true)
}
{
  // An `also` task keeps its own queue item, not the current task's.
  const c = { session: 's', ticket: 'A', queued: { item: I('A'), id: 'q-A-1', told: true }, also: [{ ticket: 'B', queued: { item: I('B'), id: 'q-B-1', told: true } }, { ticket: 'C' }] }
  const [, b, cc] = spread(c)
  check('spread: also keeps its own queued', b.queued.id, 'q-B-1')
  check('spread: also with none has none', cc.queued, undefined)
}

let bad = 0
for (const [name, ok, got, want] of results) {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
process.exit(bad ? 1 : 0)
