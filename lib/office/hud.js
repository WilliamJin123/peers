// Overlay on the scene: title, counts, event ticker, Reset view, and a name tag per seated session.
// Tags: placed by transform each frame; a write only when the rounded spot or the text changes.
import { label } from './model.js'
import { settle } from './livefx.js'

const CSS = `
.hud{position:fixed;inset:0;pointer-events:none;font:13px/1.35 var(--hud-font);color:var(--hud-fg);z-index:3}
.hud-top{position:absolute;top:12px;left:16px;right:16px;display:flex;gap:6px 14px;align-items:center;flex-wrap:wrap}
body.side .hud-top{right:calc(var(--dock-w) + 16px)}
.hud-title{font:600 16px/1 var(--hud-display);letter-spacing:.01em}
.hud-mode{font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;border:1px solid var(--hud-line);background:var(--hud-bg)}
.hud-count{color:var(--hud-dim)} .hud-count b{color:var(--hud-fg);font-weight:600}
.hud-count.alert b,.hud-count.alert{color:var(--hud-alert)}
.hud-seg{pointer-events:auto;display:inline-flex;border:1px solid var(--hud-line);border-radius:999px;background:var(--hud-bg);padding:2px}
.hud-seg a{font:600 12px/1 var(--hud-font);color:var(--hud-dim);text-decoration:none;padding:5px 10px;border-radius:999px}
.hud-seg a[aria-current]{background:var(--hud-fg);color:#fffdf4}
.hud-seg a:not([aria-current]):hover{color:var(--hud-fg)}
.hud-seg a:focus-visible,.hud-btn:focus-visible{outline:2px solid var(--hud-fg);outline-offset:2px}
.hud-btn{pointer-events:auto;font:600 12px/1 var(--hud-font);color:var(--hud-fg);background:var(--hud-bg);border:1px solid var(--hud-line);border-radius:999px;padding:7px 11px;cursor:pointer}
.hud-btn[aria-pressed=true]{background:#3d8fe0;border-color:#3d8fe0;color:#fff}
body.sheet .hud-btn[data-board]{display:none}
.hud-peek{position:fixed;z-index:6;pointer-events:auto;width:min(440px,calc(100vw - 32px));box-sizing:border-box;background:#fffefa;border:1px solid var(--hud-line);border-radius:12px;padding:8px 10px 10px;
 box-shadow:0 12px 30px -12px rgba(45,42,62,.4);font:13px/1.4 var(--hud-font);color:var(--hud-fg);display:none}
.hud-peek.on{display:block;animation:hudPeek .18s ease-out}
@keyframes hudPeek{from{opacity:0;translate:0 4px}}
.hud-peek header{display:flex;gap:6px;align-items:center;margin-bottom:6px}
.hud-peek header b{flex:1;min-width:0;overflow-wrap:anywhere;font-weight:600}
.hud-peek header button{all:unset;cursor:pointer;font:600 11.5px var(--hud-font);padding:3px 8px;border-radius:999px;border:1px solid var(--hud-line)}
.hud-peek header button:hover{background:var(--hud-fg);color:#fffdf4}
.hud-peek header button:focus-visible{outline:2px solid var(--hud-fg)}
@media (prefers-reduced-motion:reduce){.hud-peek.on{animation:none}}
.hud-reset{pointer-events:auto;margin-left:auto;font:600 12px/1 var(--hud-font);color:var(--hud-fg);background:var(--hud-bg);border:1px solid var(--hud-line);border-radius:999px;padding:7px 11px;cursor:pointer}
.hud-reset:focus-visible{outline:2px solid var(--hud-fg);outline-offset:2px}
.hud-tag{position:absolute;left:0;top:0;will-change:transform;pointer-events:auto;cursor:pointer;max-width:190px;
 padding:3px 8px 3px 7px;border-radius:12px;background:var(--hud-bg);border:1px solid var(--hud-line);display:flex;gap:6px;align-items:flex-start;font-size:12px;line-height:1.25}
.hud-tag i{width:8px;height:8px;border-radius:50%;flex:none;margin-top:4px}
.hud-tag span{overflow-wrap:anywhere}
.hud-tag em{display:block;font-style:normal;color:var(--hud-dim);font-size:11px} .hud-tag em:empty{display:none}
.hud-tag.blocked{border-color:var(--hud-alert);box-shadow:0 0 0 3px color-mix(in srgb,var(--hud-alert) 22%,transparent)}
.hud-tag.blocked em{color:var(--hud-alert);font-weight:600}
.hud-tag.off{visibility:hidden}
.hud-tick{position:absolute;left:16px;bottom:14px;display:flex;flex-direction:column;gap:3px;max-width:min(520px,calc(100% - 32px))}
body.side .hud-tick{max-width:min(520px,calc(100% - var(--dock-w) - 32px))}
body.sheet .hud-tick{display:none}
.hud-tick div{background:var(--hud-bg);padding:3px 9px;border-radius:8px;width:max-content;max-width:100%;overflow-wrap:anywhere;transition:opacity .6s}
.hud-tick div.alert{color:var(--hud-alert)}
.hud-hint{position:absolute;right:16px;bottom:14px;color:var(--hud-dim);font-size:11px}
body.side .hud-hint{right:calc(var(--dock-w) + 16px)}
body.sheet .hud-hint,body.no-gl .hud-hint,body.no-gl .hud-reset,body.no-gl .hud-tick{display:none}
@media (max-width:600px){.hud-tick div:nth-child(-n+2){display:none}.hud-tag{max-width:150px}}
@media (prefers-reduced-motion:reduce){.hud-tick div{transition:none}}
.office-note{position:fixed;z-index:4;left:50%;top:50%;transform:translate(-50%,-50%);max-width:min(420px,calc(100% - 32px));box-sizing:border-box;
 padding:14px 18px;border-radius:14px;background:var(--hud-bg);border:1px solid var(--hud-line);font:14px/1.4 var(--hud-font);color:var(--hud-fg);text-align:center;display:none}
.office-note.on{display:block}
.office-note b{display:block;font-weight:700;font-size:15px;margin-bottom:3px}
.office-note span{color:var(--hud-dim)} .office-note code{font:12px ui-monospace,Menlo,monospace}
.office-note.alert{border-color:var(--hud-alert)} .office-note.alert b{color:var(--hud-alert)}
body.side .office-note{left:calc((100% - var(--dock-w)) / 2)}
body.sheet .office-note{top:calc((100% - var(--dock-h)) / 2)}
body.no-gl .office-note{position:static;transform:none;max-width:none;text-align:left}
body.no-gl .hud{z-index:6}
.nav-tip{position:fixed;z-index:7;display:none;pointer-events:none;font:12px/1.35 var(--hud-font);color:var(--hud-fg);background:var(--hud-bg);border:1px solid var(--hud-line);border-radius:8px;padding:5px 8px;max-width:280px;overflow-wrap:anywhere}
.nav-tip b{font-weight:600} .nav-tip span{color:var(--hud-dim)}
`
const COUNT = [['work', 'working'], ['blocked', 'need you'], ['idle', 'idle']]
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const base = (k) => k.split('/').pop()

export function createHud(feed) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st)
  const root = document.createElement('div'); root.className = 'hud'
  root.innerHTML = `<div class="hud-top"><span class="hud-title">peers office</span>${feed.mode === 'demo' ? '<span class="hud-mode">demo data</span>' : `<nav class="hud-seg" aria-label="View"><a aria-current="page">Office</a><a href="../${esc(location.search)}">List</a></nav>`}<span class="hud-counts"></span><button class="hud-reset" type="button">Reset view</button><button class="hud-btn" type="button" data-board aria-pressed="false">Board</button></div>
    <div class="hud-tick" aria-live="polite"></div><div class="hud-hint">drag to turn · right-drag or WASD to pan · Q E turn · scroll to zoom · Esc resets</div>`
  document.body.append(root)
  const countsEl = root.querySelector('.hud-counts'), tick = root.querySelector('.hud-tick')
  const api = { onReset: null, onPick: null, area: null, picked: null, board: null, views: null } // area: the canvas size, live; picked: session id; views: { views, cache, pin }
  root.querySelector('.hud-reset').onclick = () => api.onReset?.()
  const bBtn = root.querySelector('[data-board]')
  bBtn.onclick = () => { const on = api.board?.toggle(); bBtn.setAttribute('aria-pressed', String(!!on)) }
  // peek: hover a tag → the file it edits now, last changed lines; Pin keeps it open
  const peek = document.createElement('div'); peek.className = 'hud-peek'; peek.setAttribute('role', 'dialog'); document.body.append(peek)
  let peekId = null, peekT = 0, peekOut = 0
  const peekHide = () => { clearTimeout(peekT); peekOut = setTimeout(() => { peek.classList.remove('on'); peekId = null }, 220) }
  const peekDraw = () => {
    const x = feed.byId[peekId], V = api.views
    if (!x || !V) return peek.classList.remove('on')
    const f = x.focus && feed.fileInfo(x.focus)
    const body = f ? V.views.diff(x.focus, { tail: 8 }) : `<div class="vw-sub">${x.state === 'idle' ? 'idle' : 'no file open'}</div>`
    const html = `<header>${V.views.dot(x.color)}<b>${esc(x.name)}${f ? ` · ${esc(base(x.focus))}` : ''}</b>${f ? '<button type="button" data-pin>Pin</button>' : ''}<button type="button" data-open>Open</button></header>${body}`
    if (peek._html !== html) { peek._html = html; peek.innerHTML = html; settle(peek) }
  }
  peek.addEventListener('pointerenter', () => clearTimeout(peekOut))
  peek.addEventListener('pointerleave', peekHide)
  peek.addEventListener('click', (e) => {
    const x = feed.byId[peekId]; if (!x) return
    if (e.target.closest('[data-pin]')) { api.views?.pin({ file: x.focus }); peek.classList.remove('on') }
    if (e.target.closest('[data-open]')) { api.onPick?.({ session: x.id }); peek.classList.remove('on') }
  })
  const peekAt = (id, el) => {
    clearTimeout(peekOut); clearTimeout(peekT)
    peekT = setTimeout(() => {
      if (document.body.classList.contains('sheet')) return
      peekId = id; peekDraw()
      const r = el.getBoundingClientRect(), w = peek.offsetWidth || 440
      peek.style.left = `${Math.round(Math.min(Math.max(8, r.left), innerWidth - w - 8))}px`
      peek.style.top = `${Math.round(r.bottom + 8)}px`
      peek.classList.add('on')
      // below the fold: flip above the tag
      const ph = peek.offsetHeight; if (r.bottom + 8 + ph > innerHeight - 8) peek.style.top = `${Math.round(Math.max(8, r.top - ph - 8))}px`
    }, 300)
  }
  api.repeek = () => { if (peekId && peek.classList.contains('on')) peekDraw() }
  api.boardOn = (on) => bBtn.setAttribute('aria-pressed', String(!!on))
  const tags = new Map() // id → { el, em, x, y, vis, w, h, sub, cls }

  let countsHtml = ''
  const counts = () => {
    const c = { work: 0, blocked: 0, idle: 0 }
    for (const x of feed.sessions) c[x.state]++
    const html = feed.sessions.length
      ? COUNT.filter(([k]) => c[k] || k === 'work').map(([k, w]) => `<span class="hud-count ${k === 'blocked' ? 'alert' : ''}"><b>${c[k]}</b> ${w}</span>`).join(' ')
      : ''
    if (html !== countsHtml) { countsHtml = html; countsEl.innerHTML = html; countsEl.style.display = html ? 'contents' : 'none' }
  }

  feed.on((e) => {
    if (e.type === 'sync' || e.type === 'status') { if (peekId && peek.classList.contains('on')) peekDraw(); return counts() }
    if (e.type === 'edit') return // too chatty for the ticker
    const d = document.createElement('div')
    d.textContent = label(e, feed.byId)
    if (!d.textContent) return
    if (e.type === 'clash' || (e.type === 'state' && e.state === 'blocked')) d.className = 'alert'
    tick.append(d)
    while (tick.children.length > 4) tick.firstChild.remove()
    ;[...tick.children].forEach((c, i, a) => (c.style.opacity = String(0.45 + (0.55 * (i + 1)) / a.length)))
  })
  counts()

  return Object.assign(api, {
    add(x) {
      if (tags.has(x.id)) return
      const el = document.createElement('div'); el.className = 'hud-tag off'
      el.innerHTML = `<i style="background:${esc(x.color)}"></i><span><b></b><em></em></span>`
      el.onclick = () => api.onPick?.({ session: x.id })
      el.addEventListener('pointerenter', () => peekAt(x.id, el))
      el.addEventListener('pointerleave', peekHide)
      root.append(el)
      tags.set(x.id, { el, nameEl: el.querySelector('b'), em: el.querySelector('em'), x: -1, y: -1, vis: false, w: 0, h: 0, name: null, sub: null, blocked: null })
    },
    remove(id) { tags.get(id)?.el.remove(); tags.delete(id) },
    // scene calls this once a frame per seated session; px, py = the head in canvas px. frame() then places them all
    place(id, px, py, vis) {
      const t = tags.get(id), x = feed.byId[id]
      if (!t || !x) return
      const sub = x.state === 'blocked' ? (x.why ? `needs you · ${x.why}` : 'needs you') : x.state === 'idle' ? 'idle' : x.focus ? base(x.focus) : ''
      let dirty = false
      if (t.name !== x.name) { t.name = x.name; t.nameEl.textContent = x.name; dirty = true }
      if (t.sub !== sub) { t.sub = sub; t.em.textContent = sub; dirty = true }
      const bl = x.state === 'blocked'
      if (t.blocked !== bl) { t.blocked = bl; t.el.classList.toggle('blocked', bl) }
      if (dirty || !t.w) { t.w = t.el.offsetWidth; t.h = t.el.offsetHeight }
      const W = api.area?.w ?? innerWidth, Hh = api.area?.h ?? innerHeight, hw = t.w / 2 + 6
      t.nx = Math.round(Math.min(Math.max(px, hw), W - hw) - t.w / 2); t.ny = Math.round(py - t.h)
      t.want = vis && py > 40 && py < Hh && px > 0 && px < W
      // in a class: one shown stays shown (no flicker as figures walk), then the nearer one (lower on screen)
      t.rank = (api.picked === id ? 0 : bl ? 1 : x.state === 'work' ? 2 : 3) * 1e5 - (t.vis ? 5e4 : 0) - py
    },
    // labels never overlap: by rank, a tag that hits a placed one hides (the dock lists everyone)
    frame() {
      const placed = []
      for (const t of [...tags.values()].sort((a, b) => a.rank - b.rank)) {
        let on = t.want
        if (on) {
          const r = [t.nx - 3, t.ny - 3, t.nx + t.w + 3, t.ny + t.h + 3]
          on = !placed.some((p) => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1])
          if (on) placed.push(r)
        }
        if (on !== t.vis) { t.vis = on; t.el.classList.toggle('off', !on) }
        if (on && (t.nx !== t.x || t.ny !== t.y)) { t.x = t.nx; t.y = t.ny; t.el.style.transform = `translate(${t.nx}px,${t.ny}px)` }
      }
    },
  })
}
