// The office model both feeds fill (live.js from the view server, demo.js from a seeded story).
//   repos     [{ id, name }]                       id = shown name, unique
//   sessions  [{ id, name, color, repo, state: work|blocked|idle, why, closed, holds: Map(key → lines), focus: key, taskId, task, commits, doing }]
//   tasks     [{ id, title, repo, status: Working|Needs you|Idle|Done, holders: [id], files: Set(key), commits: [sha] }]
//   key       `${repo}/${rel}`
// Events: edit {who,key,add,rem} · commit {who,keys,sha,msg,task} · clash {who,other,key} · state {who,state,why}
//   claim {who,id,task} · close {who,id,task} · msg {from,to,text} · join {who} · leave {who} · status · sync (after each change)
export const COLS = ['Working', 'Needs you', 'Idle', 'Done']

export function createModel(mode) {
  const subs = new Set()
  return {
    mode, status: mode === 'demo' ? 'live' : 'connecting', only: null,
    repos: [], sessions: [], tasks: [], byId: {}, taskById: {},
    on: (f) => (subs.add(f), () => subs.delete(f)),
    emit(e) { for (const f of subs) f(e) },
  }
}

// a task's column from its holders
export const statusOf = (t, byId) => {
  const hs = t.holders.map((h) => byId[h]).filter(Boolean)
  if (!hs.length) return 'Done'
  if (hs.some((x) => x.state === 'blocked')) return 'Needs you'
  if (hs.some((x) => x.state === 'work')) return 'Working'
  return 'Idle'
}

export const repoOf = (key) => key.slice(0, key.indexOf('/'))
export const relOf = (key) => key.slice(key.indexOf('/') + 1)
export const base = (key) => key.split('/').pop()

export const WORD = { work: 'working', blocked: 'needs you', idle: 'idle' }
export const word = (x) => (x.closed ? 'closed' : WORD[x.state])

export function label(e, byId) {
  const n = (id) => byId[id]?.name ?? id
  switch (e.type) {
    case 'edit': return `${n(e.who)} edits ${base(e.key)}`
    case 'commit': return `${n(e.who)} commits ${e.sha}${e.msg ? ` · ${e.msg}` : ''} (${e.keys.length} ${e.keys.length === 1 ? 'file' : 'files'})`
    case 'msg': return `${n(e.from)} → ${n(e.to)}: “${e.text}”`
    case 'clash': return `${n(e.who)} and ${n(e.other)} both edit ${base(e.key)}`
    case 'state': return e.state === 'blocked' ? `${n(e.who)} needs you${e.why ? ` · ${e.why}` : ''}` : e.state === 'idle' ? `${n(e.who)} is idle` : `${n(e.who)} is back at work`
    case 'claim': return `${n(e.who)} claims ${e.id}${e.task ? ` “${e.task}”` : ''}`
    case 'close': return `${n(e.who)} closes ${e.id}`
    case 'join': return `${n(e.who)} joins`
    case 'leave': return `${n(e.who)} leaves`
  }
  return ''
}
