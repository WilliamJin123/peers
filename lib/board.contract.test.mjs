// node lib/board.contract.test.mjs — every built-in adapter through the same cases (WA-1179), each on a stateful fake of its board.
// A new board feature: add its case here; an adapter that lacks it fails. Adapter-only details stay in board.test.mjs.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backlog, CONTRACT, customOf, fit, gaps, github, jira, jiraAcli } from './board.mjs'
import { contract, throws } from './board.contract.mjs'

const results = []
const check = (name, got, want) => results.push([name, JSON.stringify(got) === JSON.stringify(want), got, want])

// One board in memory: status todo | doing | done, a comment log, assignees, a body with task-list items.
const store = ids => Object.fromEntries(ids.map(([id, title]) => [id, { title, status: 'todo', comments: [], assignees: [], body: '- [ ] tests pass' }]))
const flag = (args, f) => (args.includes(f) ? args[args.indexOf(f) + 1] : undefined)
const ok = stdout => ({ status: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout) })
const NO = { status: 1, stderr: 'not found' }

// Backlog.md: holders are `@peers:` assignee marks; status names.
const BL = { todo: 'To Do', doing: 'In Progress', done: 'Done' }
const backlogFake = db => args => {
  if (args[0] === '--version') return { status: 0 }
  const [, verb, id] = args
  const t = db[id]
  const shape = (i, x) => ({ id: i, title: x.title, status: BL[x.status], assignees: x.assignees })
  if (verb === 'view') return !t ? NO : args.includes('--plain') ? ok(`Task ${id} - ${t.title}\n${t.body.replace('- [ ]', '- [ ] #1')}`) : ok({ task: shape(id, t) })
  if (verb === 'list') {
    const s = Object.keys(BL).find(k => BL[k] === flag(args, '-s'))
    const hit = Object.entries(db).filter(([, x]) => x.status === s)
    return args.includes('--json') ? ok({ tasks: hit.map(([i, x]) => shape(i, x)) }) : ok(hit.map(([i, x]) => `${i} - ${x.title}`).join('\n'))
  }
  if (verb === 'edit') {
    if (!t) return NO
    const s = flag(args, '-s')
    if (s) t.status = Object.keys(BL).find(k => BL[k] === s)
    if (flag(args, '-a') !== undefined) t.assignees = flag(args, '-a') ? flag(args, '-a').split(',') : []
    if (flag(args, '--append-notes')) t.comments.push(flag(args, '--append-notes'))
    return ok('')
  }
  return ok('')
}

// Jira (acli and REST): holders are a comment log; status by name; JQL by status category.
const JIRA = { 'In Progress': 'doing', 'To Do': 'todo', Done: 'done' }
const byJql = (db, jql) => {
  const key = /key = (\S+)/.exec(jql)?.[1]
  if (key) return key in db && /assignee !=/.test(jql) ? [] : []
  const s = /statusCategory = "In Progress"/.test(jql) ? 'doing' : /statusCategory = "To Do"/.test(jql) ? 'todo' : null
  return Object.entries(db).filter(([, x]) => x.status === s)
}
const jiraIssue = (id, x) => ({ key: id, fields: { summary: x.title, status: { name: Object.keys(JIRA).find(k => JIRA[k] === x.status) }, comment: { total: x.comments.length, comments: x.comments.map(body => ({ body })) } } })

const acliFake = db => args => {
  const [, , verb] = args
  if (verb === 'view') return db[args[3]] ? ok(jiraIssue(args[3], db[args[3]])) : { status: 1, stderr: 'work item not found' }
  if (verb === 'search') return ok(byJql(db, flag(args, '--jql')).map(([i, x]) => jiraIssue(i, x)))
  const t = db[flag(args, '--key')]
  if (!t) return { status: 1, stderr: 'work item not found' }
  if (verb === 'transition') t.status = JIRA[flag(args, '--status')]
  if (verb === 'comment') t.comments.push(flag(args, '--body'))
  return ok('')
}

const restFake = db => async (url, { method = 'GET', body } = {}) => {
  const u = new URL(url)
  const p = u.pathname.replace('/rest/api/2', '')
  const send = (status, v) => ({ ok: status < 300, status, text: async () => (v === undefined ? '' : JSON.stringify(v)) })
  if (p === '/myself') return send(200, { accountId: 'me' })
  if (p.startsWith('/search')) return send(200, { issues: byJql(db, u.searchParams.get('jql')).map(([i, x]) => jiraIssue(i, x)) })
  const [, , id, sub] = p.split('/')
  const t = db[decodeURIComponent(id)]
  if (!t) return send(404, { errorMessages: ['Issue does not exist'] })
  const b = body ? JSON.parse(body) : null
  if (sub === 'transitions' && method === 'GET')
    return send(200, { transitions: [['1', 'In Progress', 'indeterminate'], ['2', 'To Do', 'new'], ['3', 'Done', 'done']].map(([id, name, key]) => ({ id, name, to: { name, statusCategory: { key } } })) })
  if (sub === 'transitions') return (t.status = JIRA[{ 1: 'In Progress', 2: 'To Do', 3: 'Done' }[b.transition.id]]), send(204)
  if (sub === 'comment' && method === 'POST') return t.comments.push(b.body), send(201, {})
  if (sub === 'assignee') return send(204)
  return send(200, { ...jiraIssue(id, t), fields: { ...jiraIssue(id, t).fields, assignee: { accountId: 'me' } } })
}

// GitHub: In Progress is a label; holders are a comment log; ids owner/repo#N.
const ghFake = db => args => {
  const [a, b, n] = args
  if (a === 'repo') return ok({ nameWithOwner: 'acme/t' })
  if (a === 'api') return ok('me\n')
  if (a === 'label') return ok('')
  const t = db[`acme/t#${n}`]
  const shape = (i, x) => ({ number: +i.split('#')[1], title: x.title, state: x.status === 'done' ? 'CLOSED' : 'OPEN', labels: x.status === 'doing' ? [{ name: 'in progress' }] : [], comments: x.comments.map(body => ({ body })), assignees: [{ login: 'me' }], body: x.body, updatedAt: null })
  if (b === 'list') {
    const label = flag(args, '--label')
    return ok(Object.entries(db).filter(([, x]) => x.status !== 'done' && (!label || x.status === 'doing')).map(([i, x]) => shape(i, x)))
  }
  if (!t) return { status: 1, stderr: 'Could not resolve to an issue' }
  if (b === 'view') return ok(shape(`acme/t#${n}`, t))
  if (b === 'edit' && args.includes('--add-label')) t.status = 'doing'
  if (b === 'edit' && args.includes('--remove-label') && t.status === 'doing') t.status = 'todo'
  if (b === 'comment') t.comments.push(flag(args, '--body'))
  if (b === 'close') (t.status = 'done'), t.comments.push(flag(args, '--comment'))
  return ok('')
}

const ADAPTERS = [
  { name: 'backlog', id: 'WA-1', missing: 'WA-404', make: (db, who) => backlog(backlogFake(db), who) },
  { name: 'jira acli', id: 'P-1', missing: 'P-404', make: (db, who) => jiraAcli({}, acliFake(db), who) },
  { name: 'jira rest', id: 'P-1', missing: 'P-404', make: (db, who) => jira({ url: 'http://j' }, { JIRA_API_TOKEN: 't' }, restFake(db), who) },
  { name: 'github', id: 'acme/t#1', missing: 'acme/t#404', make: (db, who) => github({ repo: 'acme/t' }, ghFake(db), who) },
]

for (const A of ADAPTERS) {
  const db = store([[A.id, 'One']])
  for (const r of await contract({ ...A, make: who => A.make(db, who) })) results.push([r.name, r.ok, r.got, r.want])
}

// Custom adapters: the contract at load.
check('fit: a needed method left out fails, by name', await throws(() => fit({ ready: () => '', claim: () => ({}) }, './mine.mjs')), true)
let msg = ''
try {
  fit({ ready: () => '', claim: () => ({}), note: () => {}, close: () => {}, held: () => [] }, './mine.mjs')
} catch (e) {
  msg = e.message
}
check('fit: half a sweep names the rest', /lacks hold, release \(a sweep needs held, hold, release\)/.test(msg), true)
const min = fit({ ready: () => '', claim: () => ({ title: null }), note: () => {}, close: () => {} }, './mine.mjs')
check('fit: no sweep is fine; defaults fill the rest', [min.name, min.on(), min.open('x'), min.others('x'), gaps(min).sweeps], ['./mine.mjs', true, [], [], false])
// A custom module gets the built-in adapters as a third argument: it can wrap Backlog.md with its own exec.
const dir = mkdtempSync(join(tmpdir(), 'peers-board-'))
writeFileSync(join(dir, 'mine.mjs'), "export default (config, who, kit) => ({ ...kit.backlog(() => ({ status: 0, stdout: '' }), who, kit.statusesOf(config)), viewHint: id => `mine view ${id}` })")
const wrapped = fit(await customOf({ board: 'mine.mjs' }, dir, 'w@one'), 'mine.mjs')
check('custom: wraps a built-in through the kit', [gaps(wrapped).missing, wrapped.viewHint('X-1')], [[], 'mine view X-1'])
check('gaps names the defaults taken', gaps({ ready() {}, claim() {}, note() {}, close() {} }).given, Object.keys(CONTRACT.given))

let bad = 0
for (const [name, ok, got, want] of results) {
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`)
}
process.exit(bad ? 1 : 0)
