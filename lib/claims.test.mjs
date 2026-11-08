// node lib/claims.test.mjs — lib/claims.mjs: who holds a task, from the ledgers; the sweep's plan.
import { claimLive, claimsOf, current, GRACE, heldLines, holderName, plan } from './claims.mjs'

const results = []
const check = (name, got, want) => results.push([name, JSON.stringify(got) === JSON.stringify(want), got, want])
const H = 3600e3, now = 100 * H
const L = (session, ticket, x = {}) => ({ session, ticket, updated: now - 60e3, files: {}, commits: [], ...x })
const running = new Set(['aaaa1111', 'bbbb2222'])
const names = new Map([['aaaa1111', 'peers dev']])

check('name: the given name with the id', holderName(L('aaaa1111'), names), 'peers-dev-aaaa')
check('name: the id', holderName(L('bbbb2222'), names), 'cc-bbbb')
check('live: running, idle a day', claimLive(L('aaaa1111', 'A', { updated: now - 24 * H }), now, running), true)
check('live: gone, within grace', claimLive(L('gone0000', 'A', { updated: now - H }), now, running), true)
check('live: gone, past grace', claimLive(L('gone0000', 'A', { updated: now - GRACE - 1 }), now, running), false)
check('live: no running list, ended', claimLive(L('xxxx0000', 'A', { updated: now - 3 * H, ended: now - 3 * H }), now, null), false)

// One session, a ledger per repo: the latest claim wins; one claimed before 0.20.0 (no claimed) loses to any with it.
const a1 = L('aaaa1111', 'OLD', { updated: now - 30e3 }), a2 = L('aaaa1111', 'NEW', { claimed: now - H, updated: now - 2 * H })
check('current: latest claim', current([a1, a2]).map(x => x.map(l => l.ticket)), [['NEW'], ['OLD']])

const ledgers = [a1, a2, L('bbbb2222', 'NEW', { claimed: now - H }), L('gone0000', 'DEAD', { updated: now - 5 * H }), L('bbbb2222', 'X', { session: 'bbbb2222', claimed: 1 })]
const c = claimsOf(ledgers, now, running, names)
check('claims: live, two holders sorted', [...c.live], [['NEW', ['cc-bbbb', 'peers-dev-aaaa']]])
check('claims: dead and replaced', [...c.dead].sort(), ['DEAD', 'OLD', 'X'])

const held = [
  { id: 'NEW', holders: ['cc-bbbb'] },
  { id: 'DEAD', holders: [] },
  { id: 'OLD', holders: null },
  { id: 'HAND', holders: [] },
  { id: 'MARKED', holders: ['cc-zzzz'] },
]
const p = plan(held, { live: new Map([...c.live, ['ELSE', ['cc-bbbb']]]), dead: c.dead })
check('plan: writes', p.writes, [
  { call: 'hold', id: 'NEW', holders: ['cc-bbbb', 'peers-dev-aaaa'] },
  { call: 'release', id: 'DEAD' },
  { call: 'release', id: 'OLD' },
  { call: 'release', id: 'MARKED' },
])
check('plan: a hand-set task and a claim off the board are reported only', p.notes, [
  'HAND is In Progress, and no session holds it (set by hand?)',
  'ELSE: cc-bbbb holds it, and the board does not show it In Progress',
])
check('plan: board without marks, live claim: no write', plan([{ id: 'NEW', holders: null }], c).writes, [])

const lines = heldLines([L('aaaa1111', 'T-1', { claimed: now - 2 * H, title: 'Do it' }), L('gone0000', 'T-2', { updated: now - H })], now, running, names)
check('held lines', lines, ['T-1  peers-dev-aaaa  claimed 2h ago, active 1m ago  Do it', 'T-2  cc-gone (closed, holds for 2h)  active 1h ago'])

let bad = 0
for (const [name, ok, got, want] of results) {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
process.exit(bad ? 1 : 0)
