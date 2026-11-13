// The coordination port cases (WA-1369), shared: the file store (coord-files.test.mjs) and Aerie's Postgres store.
// A new port rule: add its case here; a store that lacks it fails.
// coordContract({ name, make }): make(ns) gives a store on an empty backing named ns; the same ns, a second handle on
// the same backing (two processes). Returns [{ name, ok, got, want }]. Takes about 1 s (two lease lapses).
const sleep = ms => new Promise(r => setTimeout(r, ms))
const LEASE = 60_000
const SHORT = 300

export const coordContract = async S => {
  const results = []
  const c = (name, got, want) => results.push({ name: `${S.name}: ${name}`, ok: JSON.stringify(got) === JSON.stringify(want), got, want })
  const run = String(Date.now() % 1e8)
  const fresh = k => S.make(`c${run}-${k}`)
  const holdersOf = async (s, id) => ((await s.held()).find(h => h.id === id)?.holders ?? []).map(l => l.holder).sort()
  const closingOf = async (s, id) => ((await s.held()).find(h => h.id === id)?.closing ?? []).map(x => [x.holder, x.reason])
  const ids = async s => (await s.queueList()).map(i => i.id)
  const done = []
  try {
    // claim, others, gen, fence
    const s = await fresh('claim')
    done.push(s)
    c('a store names itself and says who sets the status', [typeof s.name, typeof s.ownsStatus], ['string', 'boolean'])
    c('held: empty at first', await s.held(), [])
    const a = await s.claim('T-1', 'm1/a', LEASE)
    c('claim: no others, a number gen', [a.others, Number.isInteger(a.gen), a.title === null || typeof a.title === 'string'], [[], true, true])
    const b = await s.claim('T-1', 'm1/b', LEASE)
    c('a second holder is told of the first', b.others, ['m1/a'])
    c('gen grows', b.gen > a.gen, true)
    c('held: both, each with its lease', await holdersOf(s, 'T-1'), ['m1/a', 'm1/b'])
    const h = (await s.held()).find(x => x.id === 'T-1')
    c('held: expiry ahead, gen kept, no closing', [h.holders.every(l => l.expires > Date.now()), h.holders.find(l => l.holder === 'm1/a').gen, h.closing], [true, a.gen, []])
    c('fence: true at the current gen', await s.fence('T-1', 'm1/a', a.gen), true)
    c('fence: false for another holder or task', [await s.fence('T-1', 'm1/a', b.gen), await s.fence('T-2', 'm1/a', a.gen)], [false, false])
    const a2 = await s.claim('T-1', 'm1/a', LEASE)
    c('a re-claim fences out the old gen', [a2.gen > b.gen, await s.fence('T-1', 'm1/a', a.gen), await s.fence('T-1', 'm1/a', a2.gen)], [true, false, true])
    c('a re-claim: still one lease each', await holdersOf(s, 'T-1'), ['m1/a', 'm1/b'])
    const twin = await S.make(`c${run}-claim`)
    done.push(twin)
    c('a second handle sees the same holders', await holdersOf(twin, 'T-1'), ['m1/a', 'm1/b'])

    // release: the last-holder rule
    c('release while another holds: doing', await s.release('T-1', 'm1/a'), { last: false, closeNow: false, status: 'doing' })
    c('fence after release: false', await s.fence('T-1', 'm1/a', a2.gen), false)
    c('last out, no closing record: ready', await s.release('T-1', 'm1/b'), { last: true, closeNow: false, status: 'ready' })
    c('a settled task leaves held', await holdersOf(s, 'T-1'), [])
    c('release of a lease not held: no-op', await s.release('T-9', 'm1/a'), { last: true, closeNow: false, status: 'ready' })
    await s.claim('T-3', 'm1/a', LEASE)
    await s.claim('T-3', 'm1/b', LEASE)
    c('done while another holds: doing, record kept', [await s.release('T-3', 'm1/a', { done: { reason: 'part 1' } }), await closingOf(s, 'T-3')], [{ last: false, closeNow: false, status: 'doing' }, [['m1/a', 'part 1']]])
    c('last out after a done: done', await s.release('T-3', 'm1/b'), { last: true, closeNow: true, status: 'done' })
    c('records go when the task settles', (await s.held()).some(x => x.id === 'T-3'), false)
    await s.claim('T-4', 'm1/a', LEASE)
    await s.claim('T-4', 'm2/z', LEASE)
    c('expire frees the dead with no record', [await s.release('T-4', 'm1/a', { expire: ['m2/z'] }), await closingOf(s, 'T-4')], [{ last: true, closeNow: false, status: 'ready' }, []])
    await s.claim('T-5', 'm1/a', LEASE)
    c('a sweeper that holds nothing may expire', await s.release('T-5', 'm1/sweep', { expire: ['m1/a'] }), { last: true, closeNow: false, status: 'ready' })

    // queue
    const q = await fresh('queue')
    done.push(q)
    c('queue: empty at first', await q.queueList(), [])
    await q.queueAdd(['Q-1', 'Q-2'], { lane: 'dev' })
    await q.queueAdd(['Q-3'], { lane: 'dev', at: 'top' })
    await q.queueAdd(['Q-4'], { lane: 'ops', at: { after: 'Q-3' } })
    c('add: end, top, after', await ids(q), ['Q-3', 'Q-4', 'Q-1', 'Q-2'])
    c('list: pos 0..n-1, lane and pin', (await q.queueList()).map(i => [i.id, i.lane, i.pin, i.pos]), [
      ['Q-3', 'dev', null, 0],
      ['Q-4', 'ops', null, 1],
      ['Q-1', 'dev', null, 2],
      ['Q-2', 'dev', null, 3],
    ])
    await q.queueAdd(['Q-1'], { lane: 'dev', at: 'top' })
    c('add of a queued id moves it', await ids(q), ['Q-1', 'Q-3', 'Q-4', 'Q-2'])
    await q.queueRemove(['Q-3', 'Q-none'])
    c('remove: gone; an unknown id is no error', await ids(q), ['Q-1', 'Q-4', 'Q-2'])
    await q.queueAdd(['Q-5'], { lane: 'dev', pin: 'kai', at: 'top' })
    c('take: a pin reaches only its name', (await q.queueTake({ lanes: '*', pin: 'other' }, 'm1/o', LEASE))?.id, 'Q-1')
    c('take: lanes limit unpinned items', (await q.queueTake({ lanes: ['ops'], pin: null }, 'm1/p', LEASE))?.id, 'Q-4')
    const k = await q.queueTake({ lanes: ['none'], pin: 'kai' }, 'm1/kai', LEASE)
    c('take: a pin reaches its name in any lane', k?.id, 'Q-5')
    c('take: claims it, gen fences', [await holdersOf(q, 'Q-5'), await q.fence('Q-5', 'm1/kai', k.gen)], [['m1/kai'], true])
    c('take: the lease keeps lane and pin', (await q.held()).find(x => x.id === 'Q-5').holders[0].queued, { lane: 'dev', pin: 'kai' })
    c('take: nothing it may take → null', await q.queueTake({ lanes: ['ops'], pin: null }, 'm1/p', LEASE), null)
    c('take: gone from the queue', await ids(q), ['Q-2'])
    await q.queueAdd(['Q-6'], { lane: 'dev' })
    c('release with queue: back at the head, lane and pin kept', [await q.release('Q-5', 'm1/kai', { queue: true }), (await q.queueList())[0]], [
      { last: true, closeNow: false, status: 'queued' },
      { id: 'Q-5', lane: 'dev', pin: 'kai', pos: 0 },
    ])
    c('release without queue: ready, not queued', [(await q.release('Q-4', 'm1/p')).status, (await ids(q)).includes('Q-4')], ['ready', false])
    await q.queueAdd(['Q-7'], { lane: 'ops', pin: 'kai' })
    await q.claim('Q-7', 'm1/hand', LEASE)
    c('claim of a queued id: out of the queue, lane and pin kept', [(await ids(q)).includes('Q-7'), (await q.held()).find(x => x.id === 'Q-7').holders[0].queued], [false, { lane: 'ops', pin: 'kai' }])
    await q.claim('Q-7', 'm1/hand', LEASE)
    c('a re-claim keeps them', (await q.held()).find(x => x.id === 'Q-7').holders[0].queued, { lane: 'ops', pin: 'kai' })
    c('its release with queue: back at the head as it was', [(await q.release('Q-7', 'm1/hand', { queue: true })).status, (await q.queueList())[0]], ['queued', { id: 'Q-7', lane: 'ops', pin: 'kai', pos: 0 }])
    await q.queueRemove(['Q-7'])
    await q.claim('Q-8', 'm1/hand', LEASE)
    c('release with queue of a task never queued: ready', [(await q.release('Q-8', 'm1/hand', { queue: true })).status, (await ids(q)).includes('Q-8')], ['ready', false])
    c('a done task never goes back to the queue', (await q.release('Q-1', 'm1/o', { done: { reason: 'x' }, queue: true })).status, 'done')
    // two takers at once: one item, one winner
    const q2 = await S.make(`c${run}-queue`)
    done.push(q2)
    await q.queueRemove(await ids(q))
    await q.queueAdd(['R-1'], { lane: 'dev' })
    const race = await Promise.all([q.queueTake({ lanes: '*' }, 'm1/r1', LEASE), q2.queueTake({ lanes: '*' }, 'm1/r2', LEASE)])
    c('two takers at once: exactly one wins', race.filter(Boolean).map(r => r.id), ['R-1'])

    // leases lapse
    const l = await fresh('lease')
    done.push(l)
    const la = await l.claim('L-1', 'm1/a', SHORT)
    await l.claim('L-1', 'm1/b', SHORT)
    await l.claim('L-2', 'm1/a', SHORT)
    await sleep(SHORT / 2)
    c('renew of a live lease: nothing lost', await l.renew(['m1/a'], SHORT * 3), { lost: [] })
    await sleep(SHORT)
    c('held: a lapsed lease shows, past its expiry', (await l.held()).find(x => x.id === 'L-1').holders.find(x => x.holder === 'm1/b').expires < Date.now(), true)
    c('fence: false once lapsed', await l.fence('L-1', 'm1/b', (await l.held()).find(x => x.id === 'L-1').holders.find(x => x.holder === 'm1/b').gen), false)
    c('fence: true for the renewed lease', await l.fence('L-1', 'm1/a', la.gen), true)
    c('renew after a lapse: lost, released', [await l.renew(['m1/b'], SHORT * 3), await holdersOf(l, 'L-1')], [{ lost: [{ id: 'L-1', holder: 'm1/b' }] }, ['m1/a']])
    await l.release('L-1', 'm1/a')
    await l.release('L-2', 'm1/a')
  } finally {
    for (const s of done) await s.end?.()
  }
  return results
}
