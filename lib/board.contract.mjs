// The board contract cases (WA-1179), shared: built-in adapters (board.contract.test.mjs) and any custom board.
// A new board feature: add its case here; an adapter that lacks it fails.
// contract({ name, id, missing, make }): make(who) gives an adapter on one board where task `id` exists, titled 'One',
// open; `missing` names no task. Returns [{ name, ok, got, want }].
import { fit, gaps } from './board.mjs'

export const quiet = async f => {
  const w = process.stderr.write
  process.stderr.write = () => true
  try {
    return await f()
  } finally {
    process.stderr.write = w
  }
}
const heldOf = async (b, id) => (await b.held()).find(h => h.id === id)?.holders ?? 'not held'
export const throws = async f => {
  try {
    await f()
    return false
  } catch {
    return true
  }
}

export const contract = async A => {
  const results = []
  const c = (name, got, want) => results.push({ name: `${A.name}: ${name}`, ok: JSON.stringify(got) === JSON.stringify(want), got, want })
  const one = fit(A.make('w@one'), A.name), two = fit(A.make('k@two'), A.name)
  await quiet(async () => {
    const g = gaps(A.make('w@one'))
    c('meets the contract, sweep and all', [g.missing, g.half, g.sweeps], [[], [], true])
    c('ready lists the open task', (await one.ready()).includes('One'), true)
    // id: optional, the board's spelling
    c('claim gives the title, no others', (({ id, ...r }) => r)(await one.claim(A.id, ['w@one/a'])), { title: 'One', others: [] })
    c('held names the holder', await heldOf(one, A.id), ['w@one/a'])
    c('a held task leaves ready', (await one.ready()).includes('One'), false)
    c('a second machine is told of the first', (await two.claim(A.id, ['k@two/b'])).others, ['w@one/a'])
    c('others: the other machine', [await one.others(A.id), await two.others(A.id)], [['k@two/b'], ['w@one/a']])
    await two.hold(A.id, [])
    c('hold changes only its own machine', await heldOf(one, A.id), ['w@one/a'])
    await two.hold(A.id, ['k@two/b'])
    c('release while another holds: stays held', [await one.release(A.id, true), await heldOf(one, A.id)], [false, ['k@two/b']])
    c('the last one out queues it', [await two.release(A.id, true), await heldOf(one, A.id), (await one.ready()).includes('One')], [true, 'not held', true])
    await one.claim(A.id, ['w@one/a'])
    c('a quiet holder freed by another machine: queued', [await two.release(A.id, true, ['w@one/a']), await heldOf(one, A.id)], [true, 'not held'])
    await one.claim(A.id, ['w@one/a'])
    await one.note(A.id, 'abc1234 Fix the form')
    c('a note leaves the holders as they are', await heldOf(one, A.id), ['w@one/a'])
    c('open: unchecked items as text', (await one.open(A.id)).every(x => typeof x === 'string'), true)
    c('openHint: text', typeof one.openHint(A.id), 'string')
    c('viewHint: text', typeof one.viewHint(A.id), 'string')
    await one.close(A.id, 'shipped')
    c('close: neither held nor ready', [await heldOf(one, A.id), (await one.ready()).includes('One')], ['not held', false])
    c('a claim of a missing task fails loud', await throws(() => one.claim(A.missing, ['w@one/a'])), true)
  })
  return results
}
