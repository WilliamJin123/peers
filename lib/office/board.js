// Task board: a DOM window (a pin) over the office, crisp at any zoom. Four columns; cards keyed by task id.
// Motion: a card slides to its new column (FLIP), pulses in the holder's colour on an edit, pops a sha chip on a commit,
// shakes red on a clash. Wires card → holders' heads on hover, on pick, and for a moment after activity.
import { COLS } from './model.js'
import { esc } from './views.js'

const CSS = `
.bd{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;container-type:inline-size;min-height:100%;transition:grid-template-columns .45s cubic-bezier(.2,.9,.25,1)}
@container (max-width:480px){.bd{grid-template-columns:repeat(2,minmax(0,1fr))}}
.bd-col{--k:#8a8278;background:color-mix(in srgb,var(--k) 9%,#fffdf8);border:1px solid color-mix(in srgb,var(--k) 22%,transparent);border-radius:11px;padding:6px;display:flex;flex-direction:column;gap:6px;min-width:0}
.bd-hd{display:flex;align-items:center;gap:6px;white-space:nowrap;min-width:0;font:600 12px/1.2 var(--hud-display);color:color-mix(in srgb,var(--k) 55%,#2d2a3e);padding:2px 3px}
.bd-hd i{width:8px;height:8px;border-radius:3px;background:var(--k);flex:none}
.bd-hd b{margin-left:auto;font:600 11px ui-monospace,Menlo,monospace;background:color-mix(in srgb,var(--k) 18%,#fff);padding:0 6px;border-radius:999px}
.bd-list{display:flex;flex-direction:column;gap:6px}
.bd-card{all:unset;box-sizing:border-box;display:block;width:100%;cursor:pointer;background:#fffefa;border:1px solid color-mix(in srgb,var(--k) 26%,#2d2a3e1a);border-radius:9px;padding:6px 8px 7px;
 box-shadow:0 1px 0 color-mix(in srgb,var(--k) 25%,transparent);transition:border-color .2s,box-shadow .2s;will-change:transform}
.bd-card:hover,.bd-card.on{border-color:var(--hud-fg);box-shadow:0 3px 10px -4px rgba(45,42,62,.35)}
.bd-card:focus-visible{outline:2px solid var(--hud-fg);outline-offset:1px}
.bd-id{display:flex;gap:6px;align-items:center;font:10.5px ui-monospace,Menlo,monospace;color:var(--hud-dim)}
.bd-id span:first-child{white-space:nowrap}
.bd-id .rp{min-width:0;overflow-wrap:anywhere}
.bd-id .who{margin-left:auto;display:flex;flex:none;padding-left:3px}
.bd-card.in{animation:bdIn .42s cubic-bezier(.2,.9,.25,1.25)}
@keyframes bdIn{from{opacity:0;scale:.85;translate:0 6px}}
.bd-card.out{animation:bdOut .26s ease-in forwards;pointer-events:none}
@keyframes bdOut{to{opacity:0;scale:.9}}
.bd-hd b.bump{animation:bdBump .4s cubic-bezier(.2,.9,.25,1.5)}
@keyframes bdBump{40%{scale:1.35}}
.bd-id .who i{width:10px;height:10px;border-radius:50%;border:1.5px solid #fffefa;margin-left:-3px}
.bd-t{font:500 13px/1.3 var(--hud-font);color:var(--hud-fg);overflow-wrap:anywhere;margin-top:2px}
.bd-meta{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px;align-items:center;font:10.5px ui-monospace,Menlo,monospace;color:var(--hud-dim)}
.bd-meta>span{white-space:nowrap}
.bd-meta .vw-sha{margin:0}
.bd-meta .vw-sha.new{animation:bdPop .5s cubic-bezier(.2,.9,.25,1.4)}
@keyframes bdPop{from{scale:.2;opacity:0}}
.bd-more{all:unset;cursor:pointer;font:600 11px var(--hud-font);color:var(--hud-dim);padding:2px 4px}
.bd-more[hidden]{display:none}
.pin.bd-empty-pin{height:auto!important;resize:none}
.bd-more:hover{color:var(--hud-fg)}
.bd-more:focus-visible{outline:2px solid var(--hud-fg)}
.bd-empty{grid-column:1/-1;color:var(--hud-dim);padding:10px 4px;font-size:12.5px}
.bd-col .bd-none{color:color-mix(in srgb,var(--k) 40%,#8a8278);font-size:11.5px;padding:2px 4px}
.bd-card.shake{animation:bdShake .5s}
@keyframes bdShake{20%,60%{translate:-4px 0}40%,80%{translate:4px 0}}
/* the board pin: tinted header, counts in the header, a pill when folded */
.pin.bd-pin{border-width:1.5px;box-shadow:0 16px 40px -14px rgba(45,42,62,.45),0 2px 8px rgba(45,42,62,.1)}
.pin.bd-pin .pin-hd{background:color-mix(in srgb,#3d8fe0 9%,#fffdf8);padding:7px 6px 7px 12px}
.pin.bd-pin .pin-hd b{font:600 14px/1.2 var(--hud-display);flex:none}
.bd-sum{display:flex;gap:4px;flex:1;min-width:0;flex-wrap:wrap}
.bd-sum span{--k:#8a8278;display:inline-flex;align-items:center;gap:4px;font:600 11px/1 ui-monospace,Menlo,monospace;padding:3px 6px;border-radius:999px;background:color-mix(in srgb,var(--k) 15%,#fff);color:color-mix(in srgb,var(--k) 60%,#2d2a3e)}
.bd-sum span i{width:7px;height:7px;border-radius:2px;background:var(--k)}
.bd-sum span.z{opacity:.45}
.pin.bd-pin.min{min-width:0;width:auto!important;border-radius:999px}
.pin.bd-pin.min .pin-hd{background:#fffefa;padding:5px 5px 5px 12px;border-radius:999px}
.pin.bd-pin.min [data-big],.pin.bd-pin.min [data-pop]{display:none}
.pin.bd-pin.big{transition:width .35s cubic-bezier(.2,.9,.25,1),height .35s cubic-bezier(.2,.9,.25,1),transform .35s cubic-bezier(.2,.9,.25,1)}
.pin.bd-pin.popped .pin-bd{display:flex;align-items:center;justify-content:center;color:var(--hud-dim)}
.bd-back{all:unset;cursor:pointer;font:600 12px var(--hud-display);color:var(--hud-fg);border:1px solid var(--hud-line);border-radius:999px;padding:6px 12px}
body.bd-win{margin:0;background:#fffdf8;font:13px/1.4 var(--hud-font);color:var(--hud-fg)}
body.bd-win .bd{padding:10px;min-height:100vh;box-sizing:border-box}
@media (prefers-reduced-motion:reduce){.pin.bd-pin.big{transition:none}}
@media (prefers-reduced-motion:reduce){.bd-card.shake,.bd-meta .vw-sha.new,.bd-card.in,.bd-card.out,.bd-hd b.bump{animation:none}}
`
// column colour: blue at work, coral needs you, lilac idle, green done
const K = { Working: '#3d8fe0', 'Needs you': '#e8553a', Idle: '#9b7fe0', Done: '#3fae6a' }
const PER_COL = 8
const KEY = 'peers.board'

export function createBoard(feed, { pins, views, anchorOf, onPick, reduced }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st)
  const open_ = { more: new Set() }
  let p = null, root = null, picked = null, hover = null
  const cards = new Map() // id → { el, sig, shas }
  const hot = new Map() // task id → until (ms): wires stay a moment after activity
  const wires = new Map() // `${task}|${who}` → svg holder
  let show = (() => { try { return localStorage.getItem(KEY) !== '0' } catch { return true } })()

  let win = null, back = null, prev = null // win: the pop-out window; prev: spot before expand
  const TOOLS = '<button type="button" data-pop aria-label="Pop out to its own window" title="Pop out">⧉</button><button type="button" data-big aria-label="Expand" title="Expand">⤢</button>'
  function act(ev) {
    const m = ev.target.closest('[data-more]'); if (m) { const c = m.dataset.more; open_.more.has(c) ? open_.more.delete(c) : open_.more.add(c); return draw() }
    if (ev.target.closest('[data-big]')) return expand()
    if (ev.target.closest('[data-pop]')) return popOut()
    if (ev.target.closest('[data-back]')) return win?.close()
    const c = ev.target.closest('[data-task]'); if (c) onPick({ task: c.dataset.task })
  }
  function mount() {
    const A = innerWidth, Hh = innerHeight
    p = pins.open({
      id: 'board', fixed: true, w: Math.min(620, A - 360), h: 330, at: [16, Math.max(70, Hh - 330 - 110)], tools: TOOLS,
      render: () => ({ title: 'Task board', color: '#3d8fe0', sub: '' }),
      onBody: act,
      onMin: (on) => { if (on && prev) expand(false) },
    })
    p.el.classList.add('bd-pin')
    p.hd.querySelector('b').insertAdjacentHTML('afterend', '<span class="bd-sum" aria-label="Tasks per column"></span>')
    p.bd.innerHTML = '<div class="bd"></div>'
    root = p.bd.firstChild
    root.addEventListener('pointerover', (e) => { const c = e.target.closest('[data-task]'); hover = c?.dataset.task ?? null })
    root.addEventListener('pointerleave', () => (hover = null))
    cards.clear()
    draw(true)
  }
  function unmount() { win?.close(); p?.close(); p = null; root = null; prev = null; for (const w of wires.values()) { w.path?.remove(); w.dot?.remove() } wires.clear() }
  function toggle(on = !show) {
    show = on; try { localStorage.setItem(KEY, on ? '1' : '0') } catch {}
    on ? mount() : unmount()
    return show
  }
  // expand: fill the canvas; again: back to the old spot
  function expand(on = !prev) {
    if (!p) return
    if (on) {
      if (p.min) pins.fold(p, false)
      const r = p.el.getBoundingClientRect(), A = pins.area()
      prev = [p.x, p.y, r.width, r.height]
      p.el.classList.add('big'); pins.place(p, 16, 60, A.w - 32, A.h - 76)
    } else if (prev) {
      pins.place(p, ...prev); prev = null
      setTimeout(() => p?.el.classList.remove('big'), 360)
    }
    p.hd.querySelector('[data-big]').setAttribute('aria-label', on ? 'Restore size' : 'Expand')
    p.hd.querySelector('[data-big]').textContent = on ? '⤡' : '⤢'
    requestAnimationFrame(() => draw())
  }
  // pop out: the board moves to an always-on-top window (Document Picture-in-Picture), live; a plain window where that API is missing
  async function popOut() {
    if (win) return win.focus()
    if (prev) expand(false)
    const dpip = globalThis.documentPictureInPicture
    try {
      win = dpip ? await dpip.requestWindow({ width: 760, height: 480 }) : open('', 'peers-board', 'popup,width=760,height=480')
    } catch { win = null }
    if (!win) return
    const d = win.document
    d.title = 'peers · task board'
    for (const st of document.querySelectorAll('style')) d.head.append(st.cloneNode(true))
    d.documentElement.style.cssText = document.documentElement.style.cssText
    try { d.fonts.add(new win.FontFace('Fredoka', `url(${new URL('../vendor/fonts/fredoka.woff2', location.href)})`, { weight: '300 700' })) } catch {}
    d.body.className = 'bd-win'
    d.body.append(root)
    d.body.addEventListener('click', act)
    p.el.classList.add('popped')
    p.bd.innerHTML = '<button class="bd-back" type="button" data-back>Bring the board back</button>'
    back = () => {
      back = null
      if (!p) { win = null; return }
      p.bd.innerHTML = ''; p.bd.append(root); p.el.classList.remove('popped'); win = null
      requestAnimationFrame(() => draw())
    }
    win.addEventListener('pagehide', () => back?.(), { once: true })
    requestAnimationFrame(() => draw())
  }

  const sigOf = (t) => [t.status, t.title, t.holders.join(','), t.commits.length, t.files.size].join('|')
  function cardHtml(t) {
    const hs = t.holders.map((h) => feed.byId[h]).filter(Boolean)
    const c0 = hs[0]?.color
    return `<div class="bd-id"><span>${esc(t.id)}</span><span class="who">${hs.map((x) => `<i style="background:${esc(x.color)}" title="${esc(x.name)}"></i>`).join('')}</span></div>
      <div class="bd-t">${esc(t.title || 'untitled')}</div>
      <div class="bd-meta"><span>${esc(t.repo)}</span>${t.files.size ? `<span>· ${t.files.size} ${t.files.size === 1 ? 'file' : 'files'}</span>` : ''}${t.commits.slice(0, 3).map((s) => `<span class="vw-sha" style="--c:${esc(c0 ?? '#8a8278')}">${esc(s)}</span>`).join('')}</div>`
  }

  // build columns once; cards move between them (FLIP), so a card is never rebuilt for a move
  function draw(snap = false) {
    if (!root) return
    p.el.classList.toggle('bd-empty-pin', !feed.tasks.length)
    if (!feed.tasks.length) { root.innerHTML = '<div class="bd-empty">No tasks yet. A task shows here when a session claims one (<code>peers claim &lt;id&gt;</code>).</div>'; cards.clear(); return }
    if (!root.querySelector('.bd-col')) {
      root.innerHTML = COLS.map((c) => `<section class="bd-col" data-col="${esc(c)}" style="--k:${K[c]}"><div class="bd-hd"><i></i>${esc(c)}<b>0</b></div><div class="bd-list"></div><button class="bd-more" type="button" data-more="${esc(c)}" hidden></button></section>`).join('')
    }
    const before = new Map(); if (!snap && !reduced.matches) for (const [id, c] of cards) before.set(id, c.el.getBoundingClientRect())
    const by = Object.fromEntries(COLS.map((c) => [c, []]))
    for (const t of feed.tasks) (by[t.status] ?? by.Working).push(t)
    const seen = new Set()
    for (const col of COLS) {
      const sec = root.querySelector(`[data-col="${col}"]`), list = sec.querySelector('.bd-list'), all = by[col]
      const lim = open_.more.has(col) ? Infinity : PER_COL
      const cnt = sec.querySelector('b'), was = cnt.textContent
      if (was !== String(all.length)) { cnt.textContent = all.length; if (!snap) { cnt.classList.remove('bump'); void cnt.offsetWidth; cnt.classList.add('bump') } }
      const more = sec.querySelector('.bd-more')
      more.hidden = all.length <= PER_COL
      more.textContent = open_.more.has(col) ? 'Show fewer' : `+${all.length - PER_COL} more`
      let prev = null
      all.slice(0, lim).forEach((t) => {
        seen.add(t.id)
        let c = cards.get(t.id)
        if (!c) { const el = document.createElement('button'); el.type = 'button'; el.className = 'bd-card'; el.dataset.task = t.id; c = { el, sig: '', shas: new Set(t.commits) }; cards.set(t.id, c); if (!snap) { el.classList.add('in'); el.addEventListener('animationend', () => el.classList.remove('in'), { once: true }) } }
        const sig = sigOf(t)
        if (c.sig !== sig) {
          c.sig = sig; c.el.innerHTML = cardHtml(t)
          // a sha it did not have: pop
          for (const s of c.el.querySelectorAll('.vw-sha')) if (!c.shas.has(s.textContent)) s.classList.add('new')
          c.shas = new Set(t.commits)
        }
        c.el.classList.toggle('on', picked === t.id)
        const want = prev ? prev.nextSibling : list.firstChild
        if (c.el.parentNode !== list || want !== c.el) list.insertBefore(c.el, want)
        prev = c.el
      })
      if (!all.length) { if (!list.querySelector('.bd-none')) list.innerHTML = '<div class="bd-none">none</div>' } else list.querySelector('.bd-none')?.remove()
    }
    const sum = p.hd.querySelector('.bd-sum')
    if (sum) { const h = COLS.map((c) => `<span class="${by[c].length ? '' : 'z'}" style="--k:${K[c]}" title="${esc(c)}"><i></i>${by[c].length}</span>`).join(''); if (sum._h !== h) { sum._h = h; sum.innerHTML = h } }
    // an empty column shrinks; wide screens only (two-up layout keeps its grid)
    root.style.gridTemplateColumns = root.clientWidth > 480 ? COLS.map((c) => `minmax(0,${by[c].length ? 1 : 0.6}fr)`).join(' ') : ''
    for (const [id, c] of cards) if (!seen.has(id)) { cards.delete(id); if (reduced.matches || snap) c.el.remove(); else { c.el.classList.add('out'); setTimeout(() => c.el.remove(), 280) } }
    // FLIP: from the old spot to the new one
    for (const [id, r0] of before) {
      const c = cards.get(id); if (!c) continue
      const r1 = c.el.getBoundingClientRect(), dx = r0.left - r1.left, dy = r0.top - r1.top
      if (Math.abs(dx) + Math.abs(dy) > 1) c.el.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.9,.25,1.1)' })
    }
  }

  const cardOf = (who) => { const t = feed.byId[who]?.taskId; return t && cards.get(t) }
  feed.on((e) => {
    if (e.type === 'sync' || e.type === 'status') return draw()
    if (!root) return
    const now = performance.now()
    if (e.type === 'edit') {
      const c = cardOf(e.who), col = feed.byId[e.who]?.color
      if (c && col && !reduced.matches) c.el.animate([{ boxShadow: `0 0 0 3px ${col}` }, { boxShadow: '0 0 0 0 transparent' }], { duration: 700, easing: 'ease-out' })
      const t = feed.byId[e.who]?.taskId; if (t) hot.set(t, now + 1800)
    }
    if (e.type === 'commit') { const t = e.task ?? feed.byId[e.who]?.taskId; if (t) hot.set(t, now + 2600) }
    if (e.type === 'clash') for (const w of [e.who, e.other]) { const c = cardOf(w); if (c) { c.el.classList.remove('shake'); void c.el.offsetWidth; c.el.classList.add('shake') } }
  })

  // wires: per frame, card edge → each holder's head
  function frame() {
    // closed window (pagehide does not always fire): board comes home
    if (win?.closed) back?.()
    if (!root || p?.min || win) { for (const w of wires.values()) if (w.path) { w.path.style.display = 'none'; w.dot.style.display = 'none' } return }
    const now = performance.now(), want = new Set()
    for (const [id, until] of hot) if (until < now) hot.delete(id)
    const act = new Set([hover, picked, ...hot.keys()].filter(Boolean))
    const box = p.bd.getBoundingClientRect()
    for (const id of act) {
      const c = cards.get(id), t = feed.taskById[id]
      if (!c || !t) continue
      const r = c.el.getBoundingClientRect()
      // card scrolled out of the window: no wire
      if (r.bottom < box.top || r.top > box.bottom) continue
      for (const h of t.holders) {
        const a = anchorOf({ session: h }); if (!a || !a[2]) continue
        const k = `${id}|${h}`; want.add(k)
        let w = wires.get(k); if (!w) { w = {}; wires.set(k, w) }
        const [ex, ey] = pins.edge(r, a[0], a[1])
        pins.wire(pins.extra, w, a[0], a[1], ex, ey, a[3], hover === id || picked === id ? 0.95 : 0.55)
        w.path.style.display = ''; w.dot.style.display = ''
      }
    }
    for (const [k, w] of wires) if (!want.has(k)) { w.path?.remove(); w.dot?.remove(); wires.delete(k) }
  }

  if (show) mount()
  return {
    frame, toggle, get shown() { return show },
    pick(id) { picked = id ?? null; draw(); if (id) cards.get(id)?.el.scrollIntoView({ block: 'nearest', behavior: reduced.matches ? 'auto' : 'smooth' }) },
  }
}
