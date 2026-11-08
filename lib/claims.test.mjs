// node lib/claims.test.mjs — lib/claims.mjs: who holds a task, from the ledgers; the sweep's plan.
import { claimLive, claimsOf, current, GRACE, heldLines, heldText, holderName, holdersOf, plan } from './claims.mjs'

const results = []
const check = (name, got, want) => results.push([name, JSON.stringify(got) === JSON.stringify(want), got, want])
const H = 3600e3, now = 100 * H
const L = (session, ticket, x = {}) => ({ session, ticket, claimed: now - 3 * H, updated: now - 60e3, files: {}, commits: [], ...x })
const running = new Set(['aaaa1111', 'bbbb2222'])
const names = new Map([['aaaa1111', 'peers dev']])

check('name: the given name with the id', holderName(L('aaaa1111'), names), 'peers-dev-aaaa')
check('name: the id', holderName(L('bbbb2222'), names), 'cc-bbbb')
check('live: running, idle a day', claimLive(L('aaaa1111', 'A', { updated: now - 24 * H }), now, running), true)
check('live: gone, within grace', claimLive(L('gone0000', 'A', { updated: now - H }), now, running), true)
check('live: gone, past grace', claimLive(L('gone0000', 'A', { updated: now - GRACE - 1 }), now, running), false)
check('live: no running list, ended', claimLive(L('xxxx0000', 'A', { updated: now - 3 * H, ended: now - 3 * H }), now, null), false)

// One session, a ledger per repo: the latest claim wins. A ticket with no claimed (before 11-07) counts for nothing.
const a1 = L('aaaa1111', 'OLD', { claimed: now - 5 * H, updated: now - 30e3 }), a2 = L('aaaa1111', 'NEW', { claimed: now - H, updated: now - 2 * H })
const leg = L('aaaa1111', 'LEG', { claimed: undefined, updated: now })
check('current: latest claim; a leftover is neither', current([a1, a2, leg]).map(x => x.map(l => l.ticket)), [['NEW'], ['OLD']])

const ledgers = [a1, a2, leg, L('bbbb2222', 'NEW', { claimed: now - H }), L('gone0000', 'DEAD', { updated: now - 5 * H }), L('bbbb2222', 'X', { claimed: 1 })]
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
  { call: 'hold', ticket: 'NEW', holders: ['cc-bbbb', 'peers-dev-aaaa'] },
  { call: 'release', ticket: 'DEAD' },
  { call: 'release', ticket: 'OLD' },
  { call: 'release', ticket: 'MARKED' },
])
check('plan: a hand-set task and a claim off the board are reported only', p.notes, [
  'In Progress, no session holds it (set by hand? the sweep leaves it): HAND',
  'Held, but not In Progress on the board: ELSE (cc-bbbb)',
])
check('plan: a claim outside the board (another repo) is not reported', plan([], { live: new Map([['o/x#1', ['a']]]), dead: new Set() }, id => id.startsWith('acme/')).notes, [])
check('holders of: other sessions, current claims only', holdersOf(ledgers, 'NEW', now, running, 'aaaa1111').map(l => l.session), ['bbbb2222'])
check('holders of: a replaced claim holds nothing', holdersOf(ledgers, 'OLD', now, running, 'x'), [])
check('held text', [heldText(['a']), heldText(['a', 'b'])], ['peers: a holds this', 'peers: a, b hold this'])
check('plan: board without marks, live claim: no write', plan([{ id: 'NEW', holders: null }], c).writes, [])

const lines = heldLines([L('aaaa1111', 'T-1', { claimed: now - 2 * H, title: 'Do it' }), L('gone0000', 'T-2', { updated: now - H })], now, running, names)
check('held lines', lines, ['T-1  peers-dev-aaaa  claimed 2h ago, active 1m ago  Do it', 'T-2  cc-gone (closed, frees in 1h)  claimed 3h ago, active 1h ago'])

let bad = 0
for (const [name, ok, got, want] of results) {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
process.exit(bad ? 1 : 0)
