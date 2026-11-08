// The task board behind `peers ready | claim | commit | close`: one adapter, picked by `board` in ~/.claude/peers/config.json.
//   "backlog" (default): Backlog.md, `backlog` on PATH.
//   "jira": settings in `jira` ({ via, jql, claim, close, assign }).
//     via "acli" (default): Atlassian's own CLI, signed in already (`acli jira auth login`); peers holds no token.
//     via "rest": REST v2 for Cloud or Data Center, with `url`. The token only from env: JIRA_API_TOKEN,
//     with JIRA_EMAIL for Cloud (basic auth), without it a Data Center PAT (Bearer).
//   "github": GitHub Issues via `gh`, settings in `github` ({ repo, label, search, assign }).
//   a path to an .mjs file (relative to the config's folder): its default export, (config) => adapter.
// An adapter: { name, ready() -> lines, claim(id, holders) -> { title }, note(id, text), open(id) -> unchecked items, close(id, reason) },
// and for the sweep (optional): held() -> [{ id, title, holders }], hold(id, holders), release(id, queue) -> queued?,
// others(id) -> who else holds it (other machines, other people: `peers close` waits for them).
// holders: `<who>/<session name>` (lib/claims.mjs); an adapter changes only its own machine's (who). Backlog.md keeps them as
// `@peers:<holder>` assignees. GitHub and Jira assignees are real accounts: there they are a log of comments, replayed.
// Only the CLI calls it: the claim keeps the title in the ledger, so the mod and the view never need the board or its token.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { holdsText, letGoText, MARK, marked, ownBy, QUEUE_TEXT, replay, theirs } from './claims.mjs'
import { platform } from './platform.mjs'

const backlogRun = (args, opts = {}) => {
  const c = platform(process.platform).npmCommand('backlog', args)
  return spawnSync(c.cmd, c.args, { encoding: 'utf8', ...opts, shell: c.shell, windowsHide: true })
}

export const backlog = (exec = backlogRun, who = '') => {
  const own = ownBy(who)
  let has
  const on = () => (has ??= exec(['--version'], { stdio: 'ignore' }).status === 0)
  const run = args => {
    const r = exec(args)
    if (r.status !== 0) throw new Error(`backlog ${args.join(' ')}: ${(r.stderr || r.stdout || '').trim()}`)
    return r.stdout ?? ''
  }
  const task = id => JSON.parse(run(['task', 'view', id, '--json'])).task
  const away = t => (t.assignees ?? []).filter(a => marked(a) && !own(a.slice(MARK.length)))
  // One edit, one auto-commit: the status and the holder marks land together. `-a` replaces all: the board's own
  // assignees and other machines' marks stay, this machine's become holders. all: every mark goes (close).
  // expire: other machines' holders the sweep frees as quiet.
  const edit = (id, t, flags, holders, all = false, expire = []) => {
    const want = [...theirs(t.assignees), ...(all ? [] : away(t).filter(a => !expire.includes(a.slice(MARK.length)))), ...holders.map(h => MARK + h)]
    const same = want.join() === (t.assignees ?? []).join()
    if (flags.length || !same) run(['task', 'edit', id, ...flags, ...(same ? [] : ['-a', want.join(',')])])
  }
  return {
    name: 'backlog',
    on,
    ready: () => {
      if (!on()) throw new Error('backlog not on PATH (npm i -g backlog.md)')
      return run(['task', 'list', '-s', 'To Do', '--plain'])
    },
    claim: (id, holders = []) => {
      if (!on()) return { title: null }
      const t = task(id)
      edit(id, t, ['-s', 'In Progress'], holders)
      return { title: t.title ?? null, others: away(t).map(a => a.slice(MARK.length)) }
    },
    held: () =>
      on()
        ? JSON.parse(run(['task', 'list', '-s', 'In Progress', '--json'])).tasks.map(t => ({
            id: t.id,
            title: t.title,
            holders: (t.assignees ?? []).filter(marked).map(a => a.slice(MARK.length)),
            updated: Date.parse(t.updatedAt ?? '') || null,
          }))
        : [],
    hold: (id, holders) => on() && edit(id, task(id), [], holders),
    // Read again: another machine's mark that arrived since the sweep read keeps the task In Progress.
    release: (id, queue = true, expire = []) => {
      if (!on()) return false
      const t = task(id)
      const q = queue && !away(t).some(a => !expire.includes(a.slice(MARK.length)))
      edit(id, t, q ? ['-s', 'To Do'] : [], [], false, expire)
      return q
    },
    others: id => (on() ? away(task(id)).map(a => a.slice(MARK.length)) : []),
    note: (id, text) => on() && run(['task', 'edit', id, '--append-notes', text]),
    // Big tasks carry acceptance criteria and a DoD per phase: every item is ticked before close.
    open: id => (on() ? run(['task', 'view', id, '--plain']).split('\n').filter(x => /^\s*- \[ \] #\d+/.test(x)) : []),
    openHint: id => `Tick each: backlog task edit ${id} --check-ac <n> | --check-dod <n>.`,
    // Done stays in backlog/tasks/, so the board's Done column lists it. The archive is for dropped tasks.
    close: (id, reason) => on() && edit(id, task(id), ['-s', 'Done', '--final-summary', reason], [], true),
  }
}

// A quiet holder freed by another machine: the first line replays as its let-go.
const expireText = (h, who) => `${letGoText(h)}\nFreed by ${who}: only other machines held it, and the issue was quiet.`
// GitHub and Jira: this machine's holders against the comment log. Comments to post so the log says `holders`.
const toSay = (said, holders, own) => [
  ...holders.filter(h => !said.includes(h)).map(holdsText),
  ...said.filter(h => own(h) && !holders.includes(h)).map(letGoText),
]
// A Jira comment body: v2 text, or v3 (Cloud, acli) ADF: its text nodes.
const textOf = b => (typeof b === 'string' ? b : b?.type === 'text' ? b.text ?? '' : (b?.content ?? []).map(textOf).join(b?.type === 'doc' ? '\n' : ''))

const JQL = 'assignee = currentUser() AND statusCategory = "To Do" ORDER BY priority DESC, updated DESC'
const HELD = 'assignee = currentUser() AND statusCategory = "In Progress"'

// acli prints JSON whose shape its docs leave out: a list or { issues }, each item Jira's REST shape or flat.
const items = v => (Array.isArray(v) ? v : v?.issues ?? v?.workItems ?? v?.values ?? [])
const summaryOf = i => i?.fields?.summary ?? i?.summary ?? null
const statusOf = i => i?.fields?.status?.name ?? i?.status?.name ?? (typeof i?.status === 'string' ? i.status : null)
// A login that expired may wait for input: never hang the CLI on it.
const acliRun = args => spawnSync('acli', args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 })

// acli's shape for comments is not in its docs: fields.comment.comments, or comment(s) flat. null: none found, holders unknown.
const commentsOf = i => {
  const c = i?.fields?.comment ?? i?.comment ?? i?.comments
  const arr = Array.isArray(c) ? c : c?.comments
  // Part of the log only (total past what came): holders unknown, never a stale replay.
  if (!Array.isArray(arr) || (c?.total ?? 0) > arr.length) return null
  return arr.map(x => textOf(x?.body ?? x))
}
const saidOf = i => {
  const c = commentsOf(i)
  return c ? replay(c) : null
}

export const jiraAcli = (cfg = {}, run = acliRun, who = '') => {
  const own = ownBy(who)
  const call = args => {
    const r = run(args)
    if (r.error?.code === 'ENOENT') throw new Error('acli not on PATH: install Atlassian CLI, then acli jira auth login')
    if (r.error?.code === 'ETIMEDOUT') throw new Error(`acli ${args.slice(1, 3).join(' ')}: no answer in 30 s (signed in? acli jira auth status)`)
    if (r.status !== 0) throw new Error(`acli ${args.slice(1, 3).join(' ')}: ${(r.stderr || r.stdout || '').trim() || `exit ${r.status}`}`)
    return r.stdout ?? ''
  }
  const json = args => JSON.parse(call([...args, '--json']) || 'null')
  // A shape we do not know fails loud, never as an empty list.
  const list = v => {
    const got = items(v)
    if (!got.length && v && !Array.isArray(v) && Object.keys(v).length && !('total' in v)) throw new Error(`acli search printed JSON peers cannot read (keys: ${Object.keys(v).join(', ')})`)
    return got
  }
  // A status change takes the status's name. A claim still binds when the workflow names it otherwise.
  const move = (id, status) => {
    try {
      call(['jira', 'workitem', 'transition', '--key', id, '--status', status, '--yes'])
    } catch (e) {
      process.stderr.write(`peers: ${e.message} (set jira.claim / jira.close to your workflow's status names)\n`)
    }
  }
  const comment = (id, text) => call(['jira', 'workitem', 'comment', 'create', '--key', id, '--body', text])
  return {
    name: 'jira',
    key: id => id.toUpperCase(),
    on: () => true,
    ready: () =>
      list(json(['jira', 'workitem', 'search', '--jql', cfg.jql || JQL, '--fields', 'key,summary,status', '--limit', '50']))
        .map(i => `${i.key} - ${summaryOf(i) ?? ''}${statusOf(i) ? ` (${statusOf(i)})` : ''}`)
        .join('\n'),
    claim: (id, holders = []) => {
      const v = json(['jira', 'workitem', 'view', id, '--fields', 'summary,comment'])
      const title = summaryOf(v)
      move(id, cfg.claim || 'In Progress')
      if (cfg.assign !== false)
        try {
          call(['jira', 'workitem', 'assign', '--key', id, '--assignee', '@me', '--yes'])
        } catch (e) {
          process.stderr.write(`peers: ${e.message}\n`)
        }
      const said = saidOf(v) ?? []
      for (const t of toSay(said, holders, own))
        try {
          comment(id, t)
        } catch (e) {
          process.stderr.write(`peers: ${e.message}\n`)
        }
      return { title, others: said.filter(h => !own(h)) }
    },
    held: () =>
      list(json(['jira', 'workitem', 'search', '--jql', cfg.heldJql || HELD, '--fields', 'key,summary,comment,updated', '--limit', '100'])).map(i => ({
        id: i.key,
        title: summaryOf(i),
        holders: saidOf(i),
        updated: Date.parse(i?.fields?.updated ?? i?.updated ?? '') || null,
      })),
    hold: (id, holders) => {
      const said = saidOf(json(['jira', 'workitem', 'view', id, '--fields', 'comment']))
      if (said) for (const t of toSay(said, holders, own)) comment(id, t)
    },
    // Read again: another holder that arrived since the sweep read keeps the issue In Progress.
    release: (id, queue = true, expire = []) => {
      const said = saidOf(json(['jira', 'workitem', 'view', id, '--fields', 'comment'])) ?? []
      for (const t of toSay(said, [], own)) comment(id, t)
      for (const h of said.filter(h => expire.includes(h))) comment(id, expireText(h, who))
      if (!queue || said.some(h => !own(h) && !expire.includes(h))) return false
      call(['jira', 'workitem', 'transition', '--key', id, '--status', cfg.release || 'To Do', '--yes'])
      try {
        comment(id, QUEUE_TEXT)
      } catch {}
      return true
    },
    // Other machines from the log; another person from the assignee (JQL: no account id needed).
    others: id => {
      const away = (saidOf(json(['jira', 'workitem', 'view', id, '--fields', 'comment'])) ?? []).filter(h => !own(h))
      const them = list(json(['jira', 'workitem', 'search', '--jql', `key = ${id} AND assignee != currentUser()`, '--fields', 'key,assignee', '--limit', '1'])).map(
        i => i?.fields?.assignee?.displayName ?? i?.assignee?.displayName ?? 'another person',
      )
      return [...away, ...them]
    },
    note: comment,
    open: () => [],
    openHint: () => '',
    // The move first, and it must land: a ticket that is not Done stays bound. The comment after it only warns.
    close: (id, reason) => {
      call(['jira', 'workitem', 'transition', '--key', id, '--status', cfg.close || 'Done', '--yes'])
      try {
        comment(id, `Done: ${reason}`)
      } catch (e) {
        process.stderr.write(`peers: ${e.message}\n`)
      }
    },
  }
}

export const jira = (cfg = {}, env = process.env, fetchFn = globalThis.fetch, who = '') => {
  const own = ownBy(who)
  const url = (cfg.url || env.JIRA_URL || '').replace(/\/+$/, '')
  const token = env.JIRA_API_TOKEN
  const auth = env.JIRA_EMAIL ? `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${token}`).toString('base64')}` : `Bearer ${token}`
  const api = async (method, path, body) => {
    if (!url || !token) throw new Error('jira: set jira.url in ~/.claude/peers/config.json (or JIRA_URL) and JIRA_API_TOKEN (+ JIRA_EMAIL on Cloud)')
    const r = await fetchFn(`${url}/rest/api/2${path}`, {
      method,
      headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
    const text = await r.text()
    if (!r.ok) throw Object.assign(new Error(`jira ${method} ${path}: ${r.status} ${text.slice(0, 200)}`), { status: r.status })
    return text ? JSON.parse(text) : null
  }
  // Cloud moved search to /search/jql; Data Center has only /search.
  const search = async (jql, fields = 'summary,status') => {
    const q = `?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=50`
    try {
      return await api('GET', `/search/jql${q}`)
    } catch (e) {
      if (e.status !== 404 && e.status !== 405 && e.status !== 410) throw e
      return api('GET', `/search${q}`)
    }
  }
  // A status change is a transition: by its name or its target's name, else the first into that status category.
  const move = async (id, want, category) => {
    const { transitions = [] } = await api('GET', `/issue/${encodeURIComponent(id)}/transitions`)
    const w = String(want ?? '').toLowerCase()
    const t =
      transitions.find(t => t.name?.toLowerCase() === w || t.to?.name?.toLowerCase() === w) ??
      transitions.find(t => t.to?.statusCategory?.key === category)
    if (!t) return `no transition to "${want}" from here (${transitions.map(t => t.name).join(', ') || 'none'})`
    await api('POST', `/issue/${encodeURIComponent(id)}/transitions`, { transition: { id: t.id } })
    return null
  }
  const warn = m => m && process.stderr.write(`peers: ${m}\n`)
  const say = (id, body) => api('POST', `/issue/${encodeURIComponent(id)}/comment`, { body })
  // The whole log: an issue or search result carries a page of comments; the rest by /comment pages.
  const logOf = async i => {
    const c = i?.fields?.comment
    const got = (c?.comments ?? []).map(x => textOf(x?.body))
    while ((c?.total ?? 0) > got.length) {
      const page = await api('GET', `/issue/${encodeURIComponent(i.key)}/comment?startAt=${got.length}&maxResults=100`)
      if (!page?.comments?.length) break
      got.push(...page.comments.map(x => textOf(x?.body)))
    }
    return replay(got)
  }
  const said = async id => logOf({ key: id, ...(await api('GET', `/issue/${encodeURIComponent(id)}?fields=comment`)) })
  return {
    name: 'jira',
    key: id => id.toUpperCase(),
    on: () => true,
    ready: async () =>
      ((await search(cfg.jql || JQL)).issues ?? []).map(i => `${i.key} - ${i.fields?.summary ?? ''}${i.fields?.status?.name ? ` (${i.fields.status.name})` : ''}`).join('\n'),
    claim: async (id, holders = []) => {
      const issue = await api('GET', `/issue/${encodeURIComponent(id)}?fields=summary,comment`)
      warn(await move(id, cfg.claim || 'In Progress', 'indeterminate'))
      // Cloud names people by accountId, Data Center by name.
      if (cfg.assign !== false) {
        const me = await api('GET', '/myself')
        await api('PUT', `/issue/${encodeURIComponent(id)}/assignee`, me.accountId ? { accountId: me.accountId } : { name: me.name }).catch(e => warn(e.message))
      }
      const was = await logOf({ key: id, ...issue })
      for (const t of toSay(was, holders, own)) await say(id, t).catch(e => warn(e.message))
      return { title: issue.fields?.summary ?? null, others: was.filter(h => !own(h)) }
    },
    held: async () =>
      Promise.all(
        ((await search(cfg.heldJql || HELD, 'summary,comment,updated')).issues ?? []).map(async i => ({
          id: i.key,
          title: i.fields?.summary ?? null,
          holders: await logOf(i),
          updated: Date.parse(i.fields?.updated ?? '') || null,
        })),
      ),
    hold: async (id, holders) => {
      for (const t of toSay(await said(id), holders, own)) await say(id, t)
    },
    // Read again: another holder that arrived since the sweep read keeps the issue In Progress.
    release: async (id, queue = true, expire = []) => {
      const now = await said(id)
      for (const t of toSay(now, [], own)) await say(id, t)
      for (const h of now.filter(h => expire.includes(h))) await say(id, expireText(h, who))
      if (!queue || now.some(h => !own(h) && !expire.includes(h))) return false
      const no = await move(id, cfg.release || 'To Do', 'new')
      if (no) throw new Error(no)
      await say(id, QUEUE_TEXT).catch(e => warn(e.message))
      return true
    },
    others: async id => {
      const i = await api('GET', `/issue/${encodeURIComponent(id)}?fields=assignee,comment`)
      const me = await api('GET', '/myself')
      const a = i.fields?.assignee
      const them = a && !(me.accountId ? a.accountId === me.accountId : a.name === me.name) ? [a.displayName ?? a.name ?? 'another person'] : []
      return [...(await logOf({ ...i, key: id })).filter(h => !own(h)), ...them]
    },
    note: (id, text) => api('POST', `/issue/${encodeURIComponent(id)}/comment`, { body: text }),
    open: () => [],
    openHint: () => '',
    close: async (id, reason) => {
      const no = await move(id, cfg.close || 'Done', 'done')
      if (no) throw new Error(no)
      await api('POST', `/issue/${encodeURIComponent(id)}/comment`, { body: `Done: ${reason}` }).catch(e => warn(e.message))
    },
  }
}

// GitHub Issues through `gh`, signed in already (`gh auth login`); peers holds no token.
// Ids are full, `owner/repo#12`: the trailer then links the commit on the issue from any repo, and close finds the issue from any cwd.
// Issues have no In Progress: a label stands for it. No `Fixes #12`: GitHub would close it on push, past `peers close`'s checks.
const ghRun = args => spawnSync('gh', args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
const ISSUE = /^([^\s#/]+\/[^\s#/]+)#(\d+)$/

export const github = (cfg = {}, run = ghRun, who = '') => {
  const own = ownBy(who)
  const label = cfg.label || 'in progress'
  const call = args => {
    const r = run(args)
    if (r.error?.code === 'ENOENT') throw new Error('gh not on PATH: install GitHub CLI, then gh auth login')
    if (r.error?.code === 'ETIMEDOUT') throw new Error(`gh ${args.slice(0, 2).join(' ')}: no answer in 30 s (signed in? gh auth status)`)
    if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${(r.stderr || r.stdout || '').trim() || `exit ${r.status}`}`)
    return r.stdout ?? ''
  }
  let repo = cfg.repo
  const repoOf = () => (repo ??= JSON.parse(call(['repo', 'view', '--json', 'nameWithOwner'])).nameWithOwner)
  const at = id => {
    const x = ISSUE.exec(id)
    if (!x) throw new Error(`not a GitHub issue: ${id} (owner/repo#12, #12 or 12)`)
    return [x[2], '--repo', x[1]]
  }
  const warn = f => {
    try {
      f()
    } catch (e) {
      process.stderr.write(`peers: ${e.message}\n`)
    }
  }
  const log = comments => replay((comments ?? []).map(c => c.body))
  const said = id => log(JSON.parse(call(['issue', 'view', ...at(id), '--json', 'comments'])).comments)
  const say = (id, body) => call(['issue', 'comment', ...at(id), '--body', body])
  let me
  return {
    name: 'github',
    // `12` and `#12` name an issue of the configured repo, else of the cwd's.
    key: id => {
      const s = String(id).trim()
      if (ISSUE.test(s)) return s
      const n = /^#?(\d+)$/.exec(s)?.[1]
      return n ? `${repoOf()}#${n}` : s
    },
    on: () => true,
    // Default: the repo's open issues that no session works on. `search` takes GitHub's search syntax in their place.
    ready: () => {
      const args = ['issue', 'list', '--repo', repoOf(), '--state', 'open', '--json', 'number,title,labels', '--limit', '50']
      const list = JSON.parse(call(cfg.search ? [...args, '--search', cfg.search] : args) || '[]')
      return list
        .filter(i => cfg.search || !i.labels?.some(x => x.name === label))
        .map(i => `#${i.number} - ${i.title}`)
        .join('\n')
    },
    claim: (id, holders = []) => {
      const { title, state, comments } = JSON.parse(call(['issue', 'view', ...at(id), '--json', 'title,state,comments']))
      if (state === 'CLOSED') throw new Error(`${id} is closed`)
      warn(() => {
        try {
          call(['issue', 'edit', ...at(id), '--add-label', label])
        } catch (e) {
          if (!/not found/i.test(e.message)) throw e
          // First claim in this repo: make the label.
          call(['label', 'create', label, '--repo', at(id)[2], '--color', 'FBCA04', '--description', 'peers: a session works on it'])
          call(['issue', 'edit', ...at(id), '--add-label', label])
        }
      })
      if (cfg.assign !== false) warn(() => call(['issue', 'edit', ...at(id), '--add-assignee', '@me']))
      const was = log(comments)
      for (const t of toSay(was, holders, own)) warn(() => say(id, t))
      return { title, others: was.filter(h => !own(h)) }
    },
    covers: id => id.startsWith(`${repoOf()}#`),
    // The label stands for In Progress. Ids come back full, as the ledgers keep them.
    held: () =>
      JSON.parse(call(['issue', 'list', '--repo', repoOf(), '--state', 'open', '--label', label, '--json', 'number,title,comments,updatedAt', '--limit', '100']) || '[]').map(i => ({
        id: `${repoOf()}#${i.number}`,
        title: i.title,
        // `issue list` gives at most 100 comments (the oldest): past that, the whole log by `view`.
        holders: (i.comments?.length ?? 0) >= 100 ? said(`${repoOf()}#${i.number}`) : log(i.comments),
        updated: Date.parse(i.updatedAt ?? '') || null,
      })),
    hold: (id, holders) => {
      for (const t of toSay(said(id), holders, own)) say(id, t)
    },
    // Read again: another holder that arrived since the sweep read keeps the label.
    release: (id, queue = true, expire = []) => {
      const now = said(id)
      for (const t of toSay(now, [], own)) say(id, t)
      for (const h of now.filter(h => expire.includes(h))) say(id, expireText(h, who))
      if (!queue || now.some(h => !own(h) && !expire.includes(h))) return false
      call(['issue', 'edit', ...at(id), '--remove-label', label])
      warn(() => say(id, QUEUE_TEXT))
      return true
    },
    // Other machines from the log; other people from the assignees.
    others: id => {
      const { assignees, comments } = JSON.parse(call(['issue', 'view', ...at(id), '--json', 'assignees,comments']))
      me ??= call(['api', 'user', '--jq', '.login']).trim()
      return [...log(comments).filter(h => !own(h)), ...(assignees ?? []).map(a => a.login).filter(l => l && l !== me).map(l => `@${l}`)]
    },
    note: (id, text) => call(['issue', 'comment', ...at(id), '--body', text]),
    // Task list items in the body: every one is ticked before close, as Backlog.md's criteria.
    open: id =>
      (JSON.parse(call(['issue', 'view', ...at(id), '--json', 'body'])).body ?? '')
        .split(/\r?\n/)
        .filter(x => /^\s*[-*] \[ \] /.test(x))
        .map(x => x.trim()),
    openHint: id => `Tick each box on the issue: gh issue view ${at(id).join(' ')} --web.`,
    // The close must land: an issue still open stays bound. The label comes off after it, and only warns.
    close: (id, reason) => {
      call(['issue', 'close', ...at(id), '--reason', 'completed', '--comment', `Done: ${reason}`])
      warn(() => call(['issue', 'edit', ...at(id), '--remove-label', label]))
    },
  }
}

export const boardOf = async (config, dir, who = '') => {
  const kind = config.board ?? 'backlog'
  if (kind === 'backlog') return backlog(undefined, who)
  if (kind === 'github') return github(config.github, undefined, who)
  if (kind === 'jira') return config.jira?.via === 'rest' ? jira(config.jira, undefined, undefined, who) : jiraAcli(config.jira, undefined, who)
  const mod = await import(pathToFileURL(resolve(dir, kind)).href)
  return { on: () => true, open: () => [], openHint: () => '', others: () => [], name: kind, ...(await mod.default(config, who)) }
}
