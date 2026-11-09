// Dock: the full list beside the scene. A right column on wide screens, a bottom sheet on narrow or tall ones.
// Sessions (who needs you first) or Tasks (the board as a list); inspect(sel) pins a session, task or file on top.
// sel: { session: id } | { task: id } | { file: key } | null. Redraws once a frame at most, and only the parts that changed.
import { COLS, word, label, base, relOf } from './model.js'

const W = 320, PEEK = 46
const CSS = `
.dock{position:fixed;z-index:5;box-sizing:border-box;overflow:auto;overscroll-behavior:contain;background:var(--hud-bg);color:var(--hud-fg);font:13px/1.4 var(--hud-font);padding:12px 14px 14px}
.dock.side{top:0;right:0;bottom:0;width:var(--dock-w);border-left:1px solid var(--dock-line)}
.dock.sheet{left:0;right:0;bottom:0;height:var(--dock-h);border-top:1px solid var(--dock-line);border-radius:16px 16px 0 0;padding:6px 14px 14px}
.dock.full{inset:0;width:auto;height:auto;border:0;border-radius:0;padding:56px max(16px,calc(50% - 360px)) 24px}
.dock.full .office-note{margin:0 0 14px}
.dock .grab{all:unset;display:block;margin:0 auto 6px;width:100%;height:18px;cursor:pointer;text-align:center}
.dock .grab::before{content:"";display:inline-block;width:38px;height:4px;border-radius:2px;background:var(--dock-line);vertical-align:middle}
.dock:not(.sheet) .grab{display:none}
.dock .head{display:flex;gap:4px;align-items:center;margin:0 0 10px}
.dock .tabs button{all:unset;cursor:pointer;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;color:var(--hud-dim)}
.dock .tabs button.on{background:var(--dock-chip);color:var(--hud-fg)}
.dock button:focus-visible,.dock [tabindex]:focus-visible{outline:2px solid var(--hud-fg);outline-offset:1px}
.dock .live{margin-left:auto;font-size:11px;color:var(--hud-dim);white-space:nowrap}
.dock .live.alert{color:var(--hud-alert);font-weight:600}
.dock .empty{color:var(--hud-dim);padding:6px 0}
.dock .empty b{display:block;color:var(--hud-fg);font-weight:600}
.dock .row{padding:8px;border-radius:10px;margin:0 -8px 2px;cursor:pointer}
.dock .row:hover{background:var(--dock-chip)}
.dock .row.blocked{background:color-mix(in srgb,var(--hud-alert) 12%,transparent)}
.dock .row.picked{box-shadow:0 0 0 1.5px var(--hud-fg)}
.dock .top{display:flex;gap:7px;align-items:baseline}
.dock i.dot{width:9px;height:9px;border-radius:50%;flex:none;display:inline-block}
.dock .top b{font-weight:600;overflow-wrap:anywhere;min-width:0}
.dock .st{margin-left:auto;color:var(--hud-dim);white-space:nowrap;font-size:12px}
.dock .blocked .st,.dock .why{color:var(--hud-alert);font-weight:600}
.dock .why{font-weight:500;overflow-wrap:anywhere}
.dock .task{color:var(--hud-dim);overflow-wrap:anywhere}
.dock .fs{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.dock .f{all:unset;font:11px/1.7 ui-monospace,Menlo,monospace;padding:0 6px;border-radius:5px;background:var(--dock-chip);cursor:pointer;overflow-wrap:anywhere}
.dock .f s{text-decoration:none;opacity:.65}
.dock .f.clash{background:color-mix(in srgb,var(--hud-alert) 20%,transparent);color:var(--hud-alert);outline:1px solid var(--hud-alert)}
.dock .log{margin-top:12px;padding-top:8px;border-top:1px solid var(--dock-line)}
.dock .log div{color:var(--hud-dim);overflow-wrap:anywhere;padding:1px 0}
.dock .log div.alert{color:var(--hud-alert)}
.dock .col{margin:0 0 12px}
.dock .col h4{margin:0 0 5px;font-size:12px;font-weight:600;color:var(--hud-dim)}
.dock .col.blk h4{color:var(--hud-alert)}
.dock .card{padding:7px 9px;border:1px solid var(--dock-line);border-radius:10px;margin:0 0 5px;cursor:pointer;overflow-wrap:anywhere}
.dock .card:hover{background:var(--dock-chip)}
.dock .card.blk{border-color:var(--hud-alert);background:color-mix(in srgb,var(--hud-alert) 8%,transparent)}
.dock .card.done{color:var(--hud-dim)}
.dock .card.picked{box-shadow:0 0 0 1.5px var(--hud-fg)}
.dock .id{font:11px ui-monospace,Menlo,monospace;color:var(--hud-dim)}
.dock .who{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:3px;color:var(--hud-dim)}
.dock .who span{display:inline-flex;gap:5px;align-items:center}
.dock .insp{margin:0 0 12px;padding:10px 12px;border-radius:12px;border:1px solid var(--hud-line);background:var(--hud-bg)}
.dock .insp .hd{display:flex;gap:8px;align-items:baseline}
.dock .insp .hd b{font-weight:600;overflow-wrap:anywhere;min-width:0}
.dock .insp .x{all:unset;cursor:pointer;margin-left:auto;color:var(--hud-dim);padding:0 4px;font-size:14px}
.dock .sub{color:var(--hud-dim);margin:2px 0 6px;overflow-wrap:anywhere}
.dock .sub.alert{color:var(--hud-alert)}
.dock .diff{font:11px/1.6 ui-monospace,Menlo,monospace;border-radius:8px;background:var(--dock-chip);padding:4px 0;overflow-x:auto;max-height:340px;overflow-y:auto}
.dock .diff .in{display:inline-block;min-width:100%}
.dock .diff div{padding:0 10px 0 4px;white-space:pre}
.dock .diff .n{display:inline-block;width:34px;text-align:right;margin-right:8px;color:var(--hud-dim);user-select:none}
.dock .diff .rm{color:var(--hud-dim);text-decoration:line-through}
.dock .diff .hh{color:var(--hud-dim);padding-top:4px}
.dock .diff .more{color:var(--hud-dim);font-style:italic}
.dock .eds div{display:flex;gap:6px;align-items:center;color:var(--hud-dim)}
.dock.sheet.peek{overflow:hidden}
`
const ORDER = { blocked: 0, work: 1, idle: 2 }
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const LOG = 4, HUNKS = 4, HLINES = 60, CHIPS = 8

export function createDock(feed, { onPick } = {}) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st)
  const el = document.createElement('aside'); el.className = 'dock'; el.setAttribute('aria-label', 'Sessions and tasks')
  document.body.append(el)
  const grab = document.createElement('button'); grab.className = 'grab'; grab.type = 'button'
  const hEl = document.createElement('div'), iEl = document.createElement('div'), bEl = document.createElement('div')
  el.append(grab, hEl, iEl, bEl)
  let tab = 'sessions', sel = null, side = false, peek = false, full = false, sheetH = 0, queued = false
  const lines = []
  const diffs = new Map() // `${key}|${adds}|${dels}` → hunks | 'wait' | null

  // side or sheet by the window; the stage asks inset() on each resize
  function shape() {
    side = !full && innerWidth >= 900 && innerWidth >= innerHeight * 1.1
    sheetH = Math.round(Math.min(Math.max(innerHeight * 0.4, 220), 420))
    el.classList.toggle('side', side); el.classList.toggle('sheet', !side && !full); el.classList.toggle('full', full); el.classList.toggle('peek', peek && !side && !full)
    document.body.classList.toggle('side', side); document.body.classList.toggle('sheet', !side && !full)
    const s = document.documentElement.style
    s.setProperty('--dock-w', `${W}px`); s.setProperty('--dock-h', `${peek ? PEEK : sheetH}px`)
    grab.setAttribute('aria-label', peek ? 'Show the list' : 'Hide the list'); grab.setAttribute('aria-expanded', String(!peek))
  }
  addEventListener('resize', shape)
  shape()
  grab.onclick = () => { peek = !peek; shape(); dispatchEvent(new Event('resize')) }

  feed.on((e) => {
    if (e.type !== 'sync' && e.type !== 'status' && e.type !== 'edit') {
      const t = label(e, feed.byId)
      if (t) { lines.unshift([t, e.type === 'clash' || (e.type === 'state' && e.state === 'blocked')]); lines.length = Math.min(lines.length, LOG) }
    }
    // the picked thing left: drop it
    if (sel?.session && !feed.byId[sel.session]) sel = null
    if (sel?.task && !feed.taskById[sel.task]) sel = null
    queue()
  })
  function queue() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw() }) } }

  const holders = (key) => feed.sessions.filter((x) => x.holds.has(key))
  const who = (id) => { const x = feed.byId[id]; return x ? `<span><i class="dot" style="background:${esc(x.color)}"></i>${esc(x.name)}</span>` : '' }
  const chip = (key, n, name = base(key)) => {
    const c = holders(key).length > 1
    return `<button class="f ${c ? 'clash' : ''}" data-file="${esc(key)}" title="${esc(key)}${c ? ' · two sessions edit it' : ''}">${c ? '⚠ ' : ''}${esc(name)}${n != null ? ` <s>${n}</s>` : ''}</button>`
  }
  // chips for a list of [key, n]: a file name two keys share shows its folders too, as many as tell them apart
  const chips = (list) => {
    const parts = list.map(([k]) => relOf(k).split('/'))
    const name = (i) => {
      for (let d = 1; d <= parts[i].length; d++) {
        const tail = parts[i].slice(-d).join('/')
        if (parts.every((p, j) => j === i || p.slice(-d).join('/') !== tail)) return tail
      }
      return list[i][0]
    }
    return list.map(([k, n], i) => chip(k, n, name(i))).join('')
  }

  function diffHtml(key) {
    const f = feed.fileInfo(key)
    if (!f) return ''
    if (!feed.diff) {
      // demo: no source text, only the edit list
      return f.edits?.length ? `<div class="eds">${f.edits.slice(-5).reverse().map((e) => `<div>${who(e.who)} +${e.add} −${e.rem}</div>`).join('')}</div>` : ''
    }
    const k = `${key}|${f.adds}|${f.dels}`
    if (!diffs.has(k)) {
      diffs.set(k, 'wait')
      feed.diff(key).then((h) => { diffs.set(k, h); queue() })
    }
    const h = diffs.get(k)
    if (h === 'wait') return '<div class="sub">Reading the diff…</div>'
    if (!h) return '<div class="sub">No diff to show (a new file, a binary file, or the read failed).</div>'
    if (!h.length) return '<div class="sub">No uncommitted lines.</div>'
    let out = '', shown = 0
    for (const hk of h.slice(0, HUNKS)) {
      const c = feed.byId[hk.who]?.color
      out += `<div class="hh">@@ ${esc(hk.lines[0]?.n ?? '')}${hk.who ? ` · ${esc(feed.byId[hk.who]?.name ?? hk.who)}` : ''}</div>`
      for (const L of hk.lines) {
        if (shown++ >= HLINES) break
        const lc = feed.byId[L.a]?.color ?? c
        const bg = L.t === '+' && lc ? ` style="background:color-mix(in srgb,${esc(lc)} 18%,transparent)"` : ''
        out += `<div class="${L.t === '-' ? 'rm' : ''}"${bg}><span class="n">${L.n}</span>${L.t === ' ' ? ' ' : esc(L.t)} ${esc(L.s)}</div>`
      }
    }
    const total = h.reduce((a, x) => a + x.lines.length, 0)
    if (total > shown || h.length > HUNKS) out += `<div class="more">${total - Math.min(shown, total)} more lines in ${h.length} hunks: open the file to read all</div>`
    return `<div class="diff"><div class="in">${out}</div></div>`
  }

  function fileInsp(key) {
    const f = feed.fileInfo(key), hs = holders(key)
    const clash = hs.length > 1
    return `<div class="hd"><b>${esc(relOf(key))}</b><button class="x" data-close aria-label="Close">✕</button></div>
      <div class="sub ${clash ? 'alert' : ''}">${esc(key.split('/')[0])}${f?.lines ? ` · ${f.lines} lines` : ''}${f?.adds != null ? ` · +${f.adds} −${f.dels}` : ''} · ${hs.length ? `${clash ? 'two sessions edit it: ' : 'held by '}${hs.map((x) => esc(x.name)).join(', ')}` : 'nobody holds it now'}</div>${diffHtml(key)}`
  }
  function taskInsp(id) {
    const t = feed.taskById[id]
    if (!t) return ''
    const fs = chips([...t.files].map((k) => [k]))
    return `<div class="hd"><b><span class="id">${esc(t.id)}</span> ${esc(t.title || 'untitled')}</b><button class="x" data-close aria-label="Close">✕</button></div>
      <div class="sub ${t.status === 'Needs you' ? 'alert' : ''}">${t.status} · ${esc(t.repo)}</div>
      <div class="who">${t.holders.map(who).join('') || 'nobody holds it now'}</div>
      ${fs ? `<div class="fs">${fs}</div>` : ''}${t.commits.length ? `<div class="sub" style="margin-top:6px">commits ${t.commits.slice(0, 5).map(esc).join(' ')}</div>` : ''}`
  }
  function sessionInsp(id) {
    const x = feed.byId[id]
    if (!x) return ''
    const fs = chips([...x.holds])
    return `<div class="hd"><b><i class="dot" style="background:${esc(x.color)}"></i> ${esc(x.name)}</b><button class="x" data-close aria-label="Close">✕</button></div>
      <div class="sub ${x.state === 'blocked' ? 'alert' : ''}">${word(x)}${x.why ? ` · ${esc(x.why)}` : ''} · ${esc(x.repo)} · ${x.commits} ${x.commits === 1 ? 'commit' : 'commits'}</div>
      ${x.taskId ? `<div><span class="id">${esc(x.taskId)}</span> ${esc(x.task)}</div>` : x.about ? `<div class="task">${esc(x.about)}</div>` : ''}
      ${x.doing ? `<div class="task">now: ${esc(x.doing)}</div>` : ''}
      ${fs ? `<div class="fs">${fs}</div>` : '<div class="sub">holds no files</div>'}${x.shas?.length ? `<div class="sub" style="margin-top:6px">commits ${x.shas.map(esc).join(' ')}</div>` : ''}`
  }

  function emptyHtml() {
    if (feed.status === 'connecting' && !feed.sessions.length) return '<div class="empty">Connecting…</div>'
    if (feed.only && !feed.sessions.length) return `<div class="empty"><b>No live session matches</b>Asked: ${esc(feed.only.asked.join(', '))}.${feed.only.live.length ? ` Live: ${esc(feed.only.live.join(', '))}.` : ''}</div>`
    return '<div class="empty"><b>No live sessions</b>A session shows here once it edits a file, commits or claims a task.</div>'
  }
  function sessions() {
    if (!feed.sessions.length) return emptyHtml()
    return [...feed.sessions].sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.repo.localeCompare(b.repo)).map((x) => {
      // the list shows clashes first, then CHIPS more; the inspector lists every file
      const hs = [...x.holds].sort(([a], [b]) => (holders(b).length > 1) - (holders(a).length > 1))
      const fs = chips(hs.slice(0, CHIPS)) + (hs.length > CHIPS ? `<button class="f" data-session="${esc(x.id)}">+${hs.length - CHIPS} more files</button>` : '')
      return `<div class="row ${x.state} ${sel?.session === x.id ? 'picked' : ''}" data-session="${esc(x.id)}" tabindex="0" role="button">
        <div class="top"><i class="dot" style="background:${esc(x.color)}"></i><b>${esc(x.name)}</b><span class="st">${word(x)}</span></div>
        ${x.state === 'blocked' && x.why ? `<div class="why">${esc(x.why)}</div>` : ''}
        <div class="task">${x.taskId ? `${esc(x.taskId)} ${esc(x.task)}` : esc(x.about || 'no task')} · ${esc(x.repo)}</div>${fs ? `<div class="fs">${fs}</div>` : ''}</div>`
    }).join('')
  }
  function board() {
    if (!feed.tasks.length) return feed.sessions.length ? '<div class="empty"><b>No tasks held</b>A task shows here when a session claims one.</div>' : emptyHtml()
    return COLS.map((c) => {
      const ts = feed.tasks.filter((t) => t.status === c)
      if (!ts.length) return ''
      const cards = ts.map((t) => `<div class="card ${c === 'Needs you' ? 'blk' : c === 'Done' ? 'done' : ''} ${sel?.task === t.id ? 'picked' : ''}" data-task="${esc(t.id)}" tabindex="0" role="button">
        <div><span class="id">${esc(t.id)}</span> ${esc(t.title || 'untitled')}</div>
        <div class="who">${t.holders.map(who).join('')}${t.files.size ? `<span>${t.files.size} ${t.files.size === 1 ? 'file' : 'files'}</span>` : ''}</div></div>`).join('')
      return `<div class="col ${c === 'Needs you' ? 'blk' : ''}"><h4>${c} · ${ts.length}</h4>${cards}</div>`
    }).join('')
  }

  const set = (n, html) => { if (n._html !== html) { n._html = html; n.innerHTML = html } }
  function draw() {
    if (document.hidden) return
    const live = feed.mode === 'demo' ? ['demo data', false] : feed.status === 'offline' ? ['offline · retrying', true] : feed.status === 'connecting' ? ['connecting…', false] : ['live', false]
    const nt = feed.tasks.length
    set(hEl, `<div class="head"><div class="tabs" role="tablist"><button role="tab" data-tab="sessions" aria-selected="${tab === 'sessions'}" class="${tab === 'sessions' ? 'on' : ''}">Sessions · ${feed.sessions.length}</button><button role="tab" data-tab="tasks" aria-selected="${tab === 'tasks'}" class="${tab === 'tasks' ? 'on' : ''}">Tasks · ${nt}</button></div><span class="live ${live[1] ? 'alert' : ''}">${live[0]}</span></div>`)
    set(iEl, !sel ? '' : `<div class="insp">${sel.file ? fileInsp(sel.file) : sel.task ? taskInsp(sel.task) : sessionInsp(sel.session)}</div>`)
    const lg = lines.map(([t, a]) => `<div class="${a ? 'alert' : ''}">${esc(t)}</div>`).join('')
    set(bEl, (tab === 'tasks' ? board() : sessions()) + (lg && tab === 'sessions' ? `<div class="log">${lg}</div>` : ''))
  }
  document.addEventListener('visibilitychange', () => !document.hidden && queue())

  const choose = (t) => {
    if (t.dataset.tab) { tab = t.dataset.tab; draw(); return }
    const s = t.dataset.close !== undefined ? null : t.dataset.file ? { file: t.dataset.file } : t.dataset.task ? { task: t.dataset.task } : { session: t.dataset.session }
    api.inspect(s)
    onPick?.(s)
  }
  const target = (ev) => ev.target.closest('[data-tab],[data-close],[data-file],[data-task],[data-session]')
  el.addEventListener('click', (ev) => { const t = target(ev); if (t) { ev.stopPropagation(); choose(t) } })
  el.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-task],[data-session]')) { ev.preventDefault(); choose(ev.target) } })
  draw()

  const api = {
    get side() { return side },
    inset: () => (full ? { right: 0, bottom: 0 } : side ? { right: W, bottom: 0 } : { right: 0, bottom: peek ? PEEK : sheetH }),
    inspect(s) {
      sel = s
      if (s && peek) { peek = false; shape(); dispatchEvent(new Event('resize')) }
      draw()
      if (s) el.scrollTop = 0
    },
    get picked() { return sel },
    // no WebGL: the dock is the whole page; note sits on top of it
    full(note) { full = true; if (note) el.insertBefore(note, hEl); shape(); draw() },
  }
  return api
}
