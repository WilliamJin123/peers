// Dock: the full list beside the scene. A right column on wide screens (widen it to read), a bottom sheet on narrow or tall ones.
// Sessions (who needs you first) or Tasks (the board as a list); inspect(sel) shows a session, task or file on top; Pin pops it out.
// sel: { session: id } | { task: id } | { file: key } | null. Redraws once a frame at most, and only the parts that changed.
import { COLS, word, label } from './model.js'
import { esc } from './views.js'
import { follow, settle } from './livefx.js'

const W = 340, PEEK = 46
const wideW = () => Math.max(W, Math.min(760, innerWidth - 420))
const CSS = `
.dock{position:fixed;z-index:5;box-sizing:border-box;overflow:auto;overscroll-behavior:contain;background:var(--hud-bg);color:var(--hud-fg);font:13px/1.4 var(--hud-font);padding:12px 14px 14px;transition:width .28s cubic-bezier(.2,.8,.2,1)}
.dock.side{top:0;right:0;bottom:0;width:var(--dock-w);border-left:1px solid var(--dock-line)}
.dock.sheet{left:0;right:0;bottom:0;height:var(--dock-h);border-top:1px solid var(--dock-line);border-radius:16px 16px 0 0;padding:6px 14px 14px}
.dock.full{inset:0;width:auto;height:auto;border:0;border-radius:0;padding:56px max(16px,calc(50% - 360px)) 24px}
.dock.full .office-note{margin:0 0 14px}
.dock .grab{all:unset;display:block;margin:0 auto 6px;width:100%;height:18px;cursor:pointer;text-align:center}
.dock .grab::before{content:"";display:inline-block;width:38px;height:4px;border-radius:2px;background:var(--dock-line);vertical-align:middle}
.dock:not(.sheet) .grab{display:none}
.dock .head{display:flex;gap:4px;align-items:center;margin:0 0 10px}
.dock .tabs button{all:unset;cursor:pointer;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;color:var(--hud-dim)}
.dock .tabs button.on{background:var(--hud-fg);color:var(--hud-bg)}
.dock button:focus-visible,.dock [tabindex]:focus-visible{outline:2px solid var(--hud-fg);outline-offset:1px}
.dock .live{margin-left:auto;font-size:11px;color:var(--hud-dim);white-space:nowrap;display:inline-flex;gap:5px;align-items:center}
.dock .live::before{content:"";width:6px;height:6px;border-radius:50%;background:#2da44e}
.dock .live.alert{color:var(--hud-alert);font-weight:600} .dock .live.alert::before{background:var(--hud-alert)}
.dock .live.demo::before{background:#8250df}
.dock .ic{all:unset;cursor:pointer;color:var(--hud-dim);padding:3px 6px;border-radius:7px;font-size:13px;line-height:1}
.dock .ic:hover{color:var(--hud-fg);background:color-mix(in srgb,var(--hud-fg) 8%,transparent)}
.dock:not(.side) .wide{display:none}
.dock .empty{color:var(--hud-dim);padding:6px 0}
.dock .empty b{display:block;color:var(--hud-fg);font-weight:600}
.dock .row{padding:8px;border-radius:10px;margin:0 -8px 2px;cursor:pointer}
.dock .row:hover{background:color-mix(in srgb,var(--c) 9%,transparent)}
.dock .row.blocked{background:color-mix(in srgb,var(--hud-alert) 10%,transparent)}
.dock .row.picked{box-shadow:0 0 0 1.5px var(--hud-fg)}
.dock .row.closed{opacity:.6}
.dock .top{display:flex;gap:7px;align-items:baseline}
.dock .top b{font-weight:600;overflow-wrap:anywhere;min-width:0}
.dock .st{margin-left:auto;color:var(--hud-dim);white-space:nowrap;font-size:12px}
.dock .blocked .st,.dock .why{color:var(--hud-alert);font-weight:600}
.dock .why{font-weight:500;overflow-wrap:anywhere}
.dock .log{margin-top:12px;padding-top:8px;border-top:1px solid var(--dock-line)}
.dock .log div{color:var(--hud-dim);overflow-wrap:anywhere;padding:1px 0}
.dock .log div.alert{color:var(--hud-alert)}
.dock .col{margin:0 0 12px}
.dock .col h4{margin:0 0 5px;font-size:12px;font-weight:600;color:var(--hud-dim);display:flex;gap:6px;align-items:center}
.dock .col h4 i{width:8px;height:8px;border-radius:3px}
.dock .col.blk h4{color:var(--hud-alert)}
.dock .card{padding:7px 9px;border:1px solid var(--dock-line);border-radius:10px;margin:0 0 5px;cursor:pointer;overflow-wrap:anywhere;background:#fffefa}
.dock .card:hover{border-color:var(--hud-fg)}
.dock .card.blk{border-color:var(--hud-alert);background:color-mix(in srgb,var(--hud-alert) 7%,#fffefa)}
.dock .card.done{color:var(--hud-dim)}
.dock .card.picked{box-shadow:0 0 0 1.5px var(--hud-fg)}
.dock .insp{margin:0 0 12px;padding:10px 12px;border-radius:12px;border:1px solid var(--hud-line);background:#fffefa}
.dock .insp .hd{display:flex;gap:6px;align-items:baseline}
.dock .insp .hd b{font-weight:600;overflow-wrap:anywhere;min-width:0;flex:1}
.dock .insp .dv{max-height:52vh;overflow:auto}
.dock.wide .insp .dv{max-height:none}
.dock.sheet.peek{overflow:hidden}
@media (prefers-reduced-motion:reduce){.dock{transition:none}}
`
const ORDER = { blocked: 0, work: 1, idle: 2 }
const COLC = { Queued: '#c49a3c', Working: '#3d9ee8', 'In testing': '#2a9d8f', 'Needs you': '#e8622c', Idle: '#c9a35c', Done: '#2da44e' }
const LOG = 4, CHIPS = 8
const store = { get: (k) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k, v) => { try { localStorage.setItem(k, v) } catch {} } }

export function createDock(feed, { onPick, views, cache, onPin } = {}) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st)
  const el = document.createElement('aside'); el.className = 'dock'; el.setAttribute('aria-label', 'Sessions and tasks')
  document.body.append(el)
  const grab = document.createElement('button'); grab.className = 'grab'; grab.type = 'button'
  const hEl = document.createElement('div'), iEl = document.createElement('div'), bEl = document.createElement('div')
  el.append(grab, hEl, iEl, bEl)
  let tab = 'sessions', sel = null, side = false, peek = false, full = false, wide = store.get('peers.dock.wide') === '1', sheetH = 0, queued = false, all = false
  const lines = []

  const width = () => (wide ? wideW() : W)
  // side or sheet by the window; the stage asks inset() on each resize
  function shape() {
    side = !full && innerWidth >= 900 && innerWidth >= innerHeight * 1.1
    sheetH = Math.round(Math.min(Math.max(innerHeight * 0.4, 220), 420))
    el.classList.toggle('side', side); el.classList.toggle('sheet', !side && !full); el.classList.toggle('full', full); el.classList.toggle('peek', peek && !side && !full)
    el.classList.toggle('wide', side && wide)
    document.body.classList.toggle('side', side); document.body.classList.toggle('sheet', !side && !full)
    const s = document.documentElement.style
    s.setProperty('--dock-w', `${width()}px`); s.setProperty('--dock-h', `${peek ? PEEK : sheetH}px`)
    grab.setAttribute('aria-label', peek ? 'Show the list' : 'Hide the list'); grab.setAttribute('aria-expanded', String(!peek))
  }
  addEventListener('resize', shape)
  shape()
  const reflow = () => { shape(); dispatchEvent(new Event('resize')); draw() }
  grab.onclick = () => { peek = !peek; reflow() }

  feed.on((e) => {
    if (e.type !== 'sync' && e.type !== 'status' && e.type !== 'edit') {
      const t = label(e, feed.byId)
      if (t) { lines.unshift([t, e.type === 'clash' || (e.type === 'state' && e.state === 'blocked')]); lines.length = Math.min(lines.length, LOG) }
    }
    if (sel && !views.alive(sel)) sel = null
    queue()
  })
  cache.on(() => queue())
  function queue() { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw() }) } }

  function emptyHtml() {
    if (feed.status === 'connecting' && !feed.sessions.length) return '<div class="empty">Connecting…</div>'
    if (feed.only && !feed.sessions.length) return `<div class="empty"><b>No live session matches</b>Asked: ${esc(feed.only.asked.join(', '))}.${feed.only.live.length ? ` Live: ${esc(feed.only.live.join(', '))}.` : ''}</div>`
    return '<div class="empty"><b>No live sessions</b>A session shows here once it edits a file, commits or claims a task.</div>'
  }
  function sessions() {
    if (!feed.sessions.length) return emptyHtml()
    return [...feed.sessions].sort((a, b) => a.closed - b.closed || ORDER[a.state] - ORDER[b.state] || a.repo.localeCompare(b.repo)).map((x) => {
      // clashes first, then the newest edits; CHIPS shown, the inspector lists every file
      const hs = [...x.holds].sort(([a], [b]) => (views.holders(b).length > 1) - (views.holders(a).length > 1) || (b === x.focus) - (a === x.focus))
      const fs = views.chips(hs.slice(0, CHIPS)) + (hs.length > CHIPS ? `<button class="vw-f" data-session="${esc(x.id)}">+${hs.length - CHIPS} more</button>` : '')
      return `<div class="row ${x.state} ${x.closed ? 'closed' : ''} ${sel?.session === x.id ? 'picked' : ''}" style="--c:${esc(x.color)}" data-session="${esc(x.id)}" tabindex="0" role="button">
        <div class="top">${views.dot(x.color)}<b>${esc(x.name)}</b><span class="st">${word(x)}</span></div>
        ${x.state === 'blocked' && x.why ? `<div class="why">${esc(x.why)}</div>` : ''}
        <div class="vw-task">${x.taskId ? `${esc(x.taskId)} ${esc(x.task)}` : esc(x.about || 'no task')} · ${esc(x.repo)}</div>${fs ? `<div class="vw-fs">${fs}</div>` : ''}</div>`
    }).join('')
  }
  function board() {
    if (!feed.tasks.length) return feed.sessions.length ? '<div class="empty"><b>No work yet</b>A task shows here when it is queued, claimed, or waits on you.</div>' : emptyHtml()
    return COLS.map((c) => {
      const ts = feed.tasks.filter((t) => t.status === c)
      if (!ts.length) return ''
      const cards = ts.map((t) => `<div class="card ${c === 'Needs you' ? 'blk' : c === 'Done' ? 'done' : ''} ${sel?.task === t.id ? 'picked' : ''}" data-task="${esc(t.id)}" tabindex="0" role="button">
        <div><span class="vw-id">${esc(t.id)}</span> ${esc(t.title || 'untitled')}</div>
        <div class="vw-who">${t.status === 'Queued' ? `<span>${t.pin ? `for ${esc(t.pin)}` : `lane ${esc(t.lane)}`}</span>` : t.waits ? '<span>waits on you</span>' : ''}${t.holders.map(views.who).join('')}${t.files.size ? `<span>${t.files.size} ${t.files.size === 1 ? 'file' : 'files'}</span>` : ''}</div></div>`).join('')
      return `<div class="col ${c === 'Needs you' ? 'blk' : ''}"><h4><i style="background:${COLC[c]}"></i>${c} · ${ts.length}</h4>${cards}</div>`
    }).join('')
  }
  function insp() {
    if (!sel) return ''
    const h = views.head(sel)
    if (!h) return ''
    const pin = side && onPin ? '<button class="ic" data-pin title="Pin it over the office" aria-label="Pin">⧉</button>' : ''
    return `<div class="insp"><div class="hd">${h.color ? views.dot(h.color) : ''}<b>${esc(h.title)}</b>${pin}<button class="ic" data-close aria-label="Close">✕</button></div>
      <div class="vw-sub ${h.alert ? 'alert' : ''}">${h.sub}</div>${views.body(sel, { all, focusDiff: true })}</div>`
  }

  const fst = {}, reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const set = (n, html) => { if (n._html !== html) { n._html = html; n.innerHTML = html; settle(n) } }
  function draw() {
    if (document.hidden) return
    const live = feed.mode === 'demo' ? ['demo data', 'demo'] : feed.status === 'offline' ? ['offline · retrying', 'alert'] : feed.status === 'connecting' ? ['connecting…', ''] : ['live', '']
    const nt = feed.tasks.length
    set(hEl, `<div class="head"><div class="tabs" role="tablist"><button role="tab" data-tab="sessions" aria-selected="${tab === 'sessions'}" class="${tab === 'sessions' ? 'on' : ''}">Sessions · ${feed.sessions.length}</button><button role="tab" data-tab="tasks" aria-selected="${tab === 'tasks'}" class="${tab === 'tasks' ? 'on' : ''}">Tasks · ${nt}</button></div><span class="live ${live[1]}">${live[0]}</span><button class="ic wide" data-wide title="${wide ? 'Narrow the list' : 'Widen the list to read'}" aria-label="${wide ? 'Narrow the list' : 'Widen the list'}" aria-pressed="${wide}">${wide ? '⇥' : '⇤'}</button></div>`)
    set(iEl, insp())
    follow(el, fst, reduced.matches)
    const lg = lines.map(([t, a]) => `<div class="${a ? 'alert' : ''}">${esc(t)}</div>`).join('')
    set(bEl, (tab === 'tasks' ? board() : sessions()) + (lg && tab === 'sessions' ? `<div class="log">${lg}</div>` : ''))
  }
  document.addEventListener('visibilitychange', () => !document.hidden && queue())

  const choose = (t) => {
    if (t.dataset.tab) { tab = t.dataset.tab; draw(); return }
    if (t.dataset.wide !== undefined) { wide = !wide; store.set('peers.dock.wide', wide ? '1' : '0'); reflow(); return }
    if (t.dataset.more !== undefined) { all = true; draw(); return }
    if (t.dataset.pin !== undefined) { const s = sel; api.inspect(null); onPin?.(s); return }
    const s = t.dataset.close !== undefined ? null : t.dataset.file ? { file: t.dataset.file } : t.dataset.task ? { task: t.dataset.task } : { session: t.dataset.session }
    api.inspect(s)
    onPick?.(s)
  }
  const target = (ev) => ev.target.closest('[data-tab],[data-close],[data-wide],[data-more],[data-pin],[data-file],[data-task],[data-session]')
  el.addEventListener('click', (ev) => { const t = target(ev); if (t) { ev.stopPropagation(); choose(t) } })
  el.addEventListener('keydown', (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[data-task],[data-session]')) { ev.preventDefault(); choose(ev.target) } })
  // warm the diff on hover: the read starts before the click
  el.addEventListener('pointerover', (ev) => { const f = ev.target.closest('[data-file]'); if (f) cache.warm(f.dataset.file) })
  draw()

  const api = {
    get side() { return side },
    inset: () => (full ? { right: 0, bottom: 0 } : side ? { right: width(), bottom: 0 } : { right: 0, bottom: peek ? PEEK : sheetH }),
    inspect(s) {
      sel = s; all = false
      if (s?.file) cache.warm(s.file)
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
