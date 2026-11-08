// node lib/claims.test.mjs — lib/claims.mjs: who holds a task, from the claim files; the sweep's plan.
import { activity, claimLive, claimsOf, fromLedgers, GRACE, heldLines, heldText, holderName, holdersOf, overlay, plan } from './claims.mjs'

const results = []
const check = (name, got, want) => results.push([name, JSON.stringify(got) === JSON.stringify(want), got, want])
const H = 3600e3, now = 100 * H
const C = (session, ticket, x = {}) => ({ v: 1, session, ticket, claimed: now - 3 * H, updated: now - 3 * H, ...x })
const L = (session, x = {}) => ({ session, updated: now - 60e3, files: {}, commits: [], ...x })
const running = new Set(['aaaa1111', 'bbbb2222'])
const names = new Map([['aaaa1111', 'peers dev']])
const act = updated => ({ updated, ended: null })

check('name: the given name with the id', holderName(C('aaaa1111'), names), 'peers-dev-aaaa')
check('name: the id', holderName(C('bbbb2222'), names), 'cc-bbbb')
check('name: closed session keeps the name it claimed with', holderName(C('gone0000', 'A', { name: 'birdwatch-gone' }), names), 'birdwatch-gone')
check('live: running, idle a day', claimLive(C('aaaa1111', 'A', { updated: now - 24 * H }), act(now - 24 * H), now, running), true)
check('live: gone, ledger written within grace', claimLive(C('gone0000', 'A'), act(now - H), now, running), true)
check('live: gone, past grace', claimLive(C('gone0000', 'A'), act(now - GRACE - 1), now, running), false)
check('live: gone, no ledger, claimed within grace', claimLive(C('gone0000', 'A', { updated: now - H }), undefined, now, running), true)
check('live: no running list, ended after the claim', claimLive(C('xxxx0000', 'A'), { updated: now - 3 * H, ended: now - 3 * H }, now, null), false)
check('live: codex, active, not on the list', claimLive(C('codex_x1', 'A', { agent: 'codex' }), { updated: now - H, agent: 'codex' }, now, running), true)
check('activity: latest ledger per session', [...activity([L('a', { updated: 5 }), L('a', { updated: 9, ended: 9 }), L('b', { updated: 1 })])], [['a', { updated: 9, ended: 9 }], ['b', { updated: 1 }]].map(([k, v]) => [k, { ...v, ended: v.ended ?? null, agent: undefined }]))

const claims = [C('aaaa1111', 'NEW'), C('bbbb2222', 'NEW'), C('gone0000', 'DEAD'), C('gone1111', 'OTHER')]
const ledgers = [L('aaaa1111'), L('gone0000', { updated: now - 5 * H }), L('gone1111', { updated: now - 5 * H })]
const c = claimsOf(claims, ledgers, now, running, names)
check('claims: live, two holders sorted', [...c.live], [['NEW', ['cc-bbbb', 'peers-dev-aaaa']]])
check('claims: dead ones, to free and delete', c.dead.map(x => x.ticket), ['DEAD', 'OTHER'])

const held = [
  { id: 'NEW', holders: ['cc-bbbb'] },
  { id: 'DEAD', holders: null },
  { id: 'HAND', holders: [] },
  { id: 'MARKED', holders: ['cc-zzzz'] },
]
const p = plan(held, { live: new Map([...c.live, ['ELSE', ['cc-bbbb']]]), dead: c.dead })
check('plan: writes', p.writes, [
  { call: 'hold', ticket: 'NEW', holders: ['cc-bbbb', 'peers-dev-aaaa'] },
  { call: 'release', ticket: 'DEAD' },
  { call: 'release', ticket: 'MARKED' },
])
check('plan: dead claims this board answers for, freed or not on the board', p.dead.map(x => x.ticket), ['DEAD', 'OTHER'])
check('plan: a hand-set task and a claim off the board are reported only', p.notes, [
  'In Progress, no session holds it (set by hand? the sweep leaves it): HAND',
  'Held, but not In Progress on the board: ELSE (cc-bbbb)',
])
// A dead claim frees its task once: deleted after, the person's own In Progress later stays.
check('plan: hand-set again after a free, no dead claim: report only', plan([{ id: 'DEAD', holders: null }], { live: new Map(), dead: [] }).writes, [])
const gh = id => id.startsWith('acme/')
check('plan: a claim outside the board (another repo) is not reported', plan([], { live: new Map([['o/x#1', ['a']]]), dead: [] }, gh).notes, [])
check('plan: a dead claim outside the board stays for its own board', plan([], { live: new Map(), dead: [C('g', 'o/x#1')] }, gh).dead, [])
check('plan: board without marks, live claim: no write', plan([{ id: 'NEW', holders: null }], c).writes, [])
check('holders of: other sessions, live claims only', holdersOf(claims, ledgers, 'NEW', now, running, 'aaaa1111').map(x => x.session), ['bbbb2222'])
check('holders of: a dead claim holds nothing', holdersOf(claims, ledgers, 'DEAD', now, running, 'x'), [])
check('held text', [heldText(['a']), heldText(['a', 'b'])], ['peers: a holds this', 'peers: a, b hold this'])

// The views: a ledger shows its session's claim; a ticket a 0.20 ledger kept goes.
const ov = overlay([L('aaaa1111', { ticket: 'OLD', claimed: 1 }), L('cccc3333', { ticket: 'LEFT' }), L('dddd4444')], [C('aaaa1111', 'NEW', { title: 'T' })])
check('overlay: the claim wins, a leftover goes', ov.map(l => [l.ticket ?? null, l.title ?? null]), [['NEW', 'T'], [null, null], [null, null]])
check('from ledgers: latest claimed per session; no claimed, nothing', fromLedgers([L('a', { ticket: 'X', claimed: 1 }), L('a', { ticket: 'Y', claimed: 2 }), L('b', { ticket: 'Z' })]).map(x => [x.session, x.ticket]), [['a', 'Y']])

const lines = heldLines([C('aaaa1111', 'T-1', { claimed: now - 2 * H, title: 'Do it' }), C('gone0000', 'T-2')], [L('aaaa1111'), L('gone0000', { updated: now - H })], now, running, names)
check('held lines', lines, ['T-1  peers-dev-aaaa  claimed 2h ago, active 1m ago  Do it', 'T-2  cc-gone (closed, frees in 1h)  claimed 3h ago, active 1h ago'])

let bad = 0
for (const [name, ok, got, want] of results) {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
process.exit(bad ? 1 : 0)
