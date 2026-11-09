// Pins: windows over the office, each tied by a leader line to its desk. Drag by the header, resize by the corner,
// fold to the header, close. Open pins and their spots come back after a reload (per browser).
// Wide screens only: on a sheet layout the dock inspector does this job.
import { esc } from './views.js'
import { follow, settle } from './livefx.js'

const CSS = `
.pins{position:fixed;inset:0;pointer-events:none;z-index:4}
body.sheet .pins,body.no-gl .pins{display:none}
.pin-wires{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.pin-wires path{fill:none;stroke-width:1.6;stroke-linecap:round}
.pin-wires circle{stroke:#fff;stroke-width:1.5}
.pin{position:absolute;left:0;top:0;pointer-events:auto;display:flex;flex-direction:column;box-sizing:border-box;min-width:240px;min-height:44px;max-width:calc(100vw - 32px);
 background:#fffefa;border:1px solid var(--hud-line);border-radius:14px;box-shadow:0 10px 30px -12px rgba(45,42,62,.35),0 2px 6px rgba(45,42,62,.08);color:var(--hud-fg);font:13px/1.4 var(--hud-font);
 resize:both;overflow:hidden;will-change:transform}
.pin.min{resize:none;height:auto!important}
.pin.min .pin-bd{display:none}
.pin.drag{cursor:grabbing;box-shadow:0 18px 40px -14px rgba(45,42,62,.45)}
.pin-hd{display:flex;gap:7px;align-items:center;padding:8px 8px 8px 12px;cursor:grab;user-select:none;touch-action:none;border-bottom:1px solid var(--dock-line);flex:none}
.pin.min .pin-hd{border-bottom:0}
.pin-hd i{width:9px;height:9px;border-radius:50%;flex:none}
.pin-hd b{font-weight:600;overflow-wrap:anywhere;min-width:0;flex:1}
.pin-hd button{all:unset;cursor:pointer;color:var(--hud-dim);padding:3px 6px;border-radius:7px;line-height:1;font-size:13px}
.pin-hd button:hover{color:var(--hud-fg);background:color-mix(in srgb,var(--hud-fg) 8%,transparent)}
.pin-hd button:focus-visible{outline:2px solid var(--hud-fg)}
.pin-sub{padding:6px 12px 0;color:var(--hud-dim);overflow-wrap:anywhere;font-size:12px}
.pin-sub.alert{color:var(--hud-alert)}
.pin-bd{flex:1;overflow:auto;padding:8px 12px 12px;overscroll-behavior:contain}
.pin-bd .dv{border-radius:8px}
.pin.enter{animation:pinIn .32s cubic-bezier(.2,.9,.25,1.15)}
@keyframes pinIn{from{opacity:0;scale:.92}}
@media (prefers-reduced-motion:reduce){.pin.enter{animation:none}}
`
const KEY = 'peers.pins'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }
const save = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch {} }
const MAX = 6

// area(): { w, h } of the canvas (the dock is outside it); anchor(sel) → [x, y, visible] or null
export function createPins({ area, anchor }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st)
  const root = document.createElement('div'); root.className = 'pins'
  root.innerHTML = '<svg class="pin-wires" aria-hidden="true"><g class="lead"></g><g class="extra"></g></svg>'
  document.body.append(root)
  const svg = root.querySelector('svg'), lead = svg.querySelector('.lead'), extra = svg.querySelector('.extra')
  const pins = new Map() // id → pin
  let mem = load(), z = 1
  const remember = () => { mem = { ...mem, open: [...pins.values()].filter((p) => !p.fixed).map((p) => p.sel) }; save(mem) }

  function clamp(p) {
    const A = area(), r = p.el.getBoundingClientRect()
    p.x = Math.round(Math.min(Math.max(p.x, 8), Math.max(8, A.w - Math.min(r.width, 160) - 8)))
    p.y = Math.round(Math.min(Math.max(p.y, 52), Math.max(52, A.h - 44)))
    p.el.style.transform = `translate(${p.x}px,${p.y}px)`
  }
  // a free spot near the anchor: up and to the right, stepped past other pins
  function spot(sel, w, h) {
    const A = area(), a = sel ? anchor(sel) : null
    // candidates round the anchor (or the top right); least overlap with open pins wins, nearer first on a tie
    const ax = a ? a[0] : A.w - w / 2, ay = a ? a[1] : 70 + h / 2
    const cand = a ? [[ax + 60, ay - h - 40], [ax - w - 60, ay - h - 40], [ax + 60, ay + 40], [ax - w - 60, ay + 40], [ax + 60, ay - h / 2], [ax - w - 60, ay - h / 2]] : [[A.w - w - 24, 70], [24, 70]]
    for (let k = 1; k <= 4; k++) cand.push([A.w - w - 24 - k * 30, 70 + k * 30], [24 + k * 30, 70 + k * 30])
    const rs = [...pins.values()].map((p) => p.el.getBoundingClientRect())
    const fit = ([x, y]) => [Math.min(Math.max(x, 8), A.w - w - 8), Math.min(Math.max(y, 56), A.h - h - 8)]
    const over = ([x, y]) => rs.reduce((s, r) => s + Math.max(0, Math.min(x + w, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(y + h, r.bottom) - Math.max(y, r.top)), 0)
    let best = null, bs = Infinity
    cand.map(fit).forEach((c, i) => { const v = over(c) + i; if (v < bs) { bs = v; best = c } })
    return best
  }

  // spec: { id, sel?, fixed?, w, h, at?, render(p) → { title, color, sub, alert, html } , onBody?(ev) }
  function open(spec) {
    if (pins.has(spec.id)) { focus(pins.get(spec.id)); pins.get(spec.id).flash(); return pins.get(spec.id) }
    // past MAX, the oldest closes
    const loose = [...pins.values()].filter((p) => !p.fixed)
    if (!spec.fixed && loose.length >= MAX) loose[0].close()
    const m = mem[spec.id] ?? {}
    const el = document.createElement('section'); el.className = 'pin enter'; el.setAttribute('aria-label', spec.id)
    el.innerHTML = `<header class="pin-hd"><i></i><b></b>${spec.tools ?? ''}<button type="button" data-min aria-label="Fold" title="Fold">–</button>${spec.fixed ? '' : '<button type="button" data-x aria-label="Close">✕</button>'}</header><div class="pin-sub"></div><div class="pin-bd"></div>`
    root.append(el)
    const w = m.w ?? spec.w, h = m.h ?? spec.h
    el.style.width = `${w}px`; el.style.height = `${h}px`
    const p = { id: spec.id, sel: spec.sel ?? null, fixed: !!spec.fixed, el, hd: el.querySelector('.pin-hd'), bd: el.querySelector('.pin-bd'), sub: el.querySelector('.pin-sub'), spec, html: '', min: !!m.min, x: 0, y: 0, path: null, dot: null }
    ;[p.x, p.y] = m.x != null ? [m.x, m.y] : spec.at ?? spot(spec.sel, w, h)
    el.classList.toggle('min', p.min)
    el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true })
    p.close = () => { el.remove(); p.path?.remove(); p.dot?.remove(); pins.delete(p.id); remember(); spec.onClose?.() }
    p.flash = () => el.animate?.([{ boxShadow: '0 0 0 3px var(--hud-fg)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 600 })
    p.draw = () => {
      const r = spec.render(p)
      if (!r) { if (!p.fixed) p.close(); return }
      el.querySelector('.pin-hd i').style.background = r.color ?? 'var(--hud-dim)'
      const b = el.querySelector('.pin-hd b'); if (b.textContent !== r.title) b.textContent = r.title
      const subH = r.sub ?? ''; if (p.sub._h !== subH) { p.sub._h = subH; p.sub.innerHTML = subH; p.sub.style.display = subH ? '' : 'none' }
      p.sub.classList.toggle('alert', !!r.alert)
      if (r.html != null && r.html !== p.html) { p.html = r.html; p.bd.innerHTML = r.html; settle(p.bd); follow(p.bd, p, matchMedia('(prefers-reduced-motion: reduce)').matches) }
    }
    pins.set(p.id, p)
    clamp(p); p.draw(); focus(p); remember()

    // header: drag; buttons: fold, close
    p.hd.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button') || ev.button !== 0) return
      focus(p)
      const sx = ev.clientX - p.x, sy = ev.clientY - p.y
      p.hd.setPointerCapture(ev.pointerId); el.classList.add('drag')
      const mv = (e) => { p.x = e.clientX - sx; p.y = e.clientY - sy; clamp(p) }
      const up = () => { el.classList.remove('drag'); p.hd.removeEventListener('pointermove', mv); mem[p.id] = { ...mem[p.id], x: p.x, y: p.y }; save(mem) }
      p.hd.addEventListener('pointermove', mv); p.hd.addEventListener('pointerup', up, { once: true }); p.hd.addEventListener('pointercancel', up, { once: true })
    })
    p.hd.addEventListener('dblclick', (ev) => { if (!ev.target.closest('button')) toggleMin(p) })
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-x]')) return p.close()
      if (ev.target.closest('[data-min]')) return toggleMin(p)
      spec.onBody?.(ev, p)
    })
    el.addEventListener('pointerdown', () => focus(p))
    // size: kept per pin
    new ResizeObserver(() => { if (p.min || el.classList.contains('big') || el.classList.contains('enter') || !el.isConnected || !el.offsetWidth) return; mem[p.id] = { ...mem[p.id], w: el.offsetWidth, h: el.offsetHeight }; save(mem) }).observe(el)
    return p
  }
  function toggleMin(p, on = !p.min) { p.min = on; p.el.classList.toggle('min', p.min); mem[p.id] = { ...mem[p.id], min: p.min }; save(mem); p.spec.onMin?.(p.min) }
  // move and size a pin (expand, restore); not saved
  function place(p, x, y, w, h) { p.x = x; p.y = y; if (w) p.el.style.width = `${w}px`; if (h) p.el.style.height = `${h}px`; clamp(p) }
  function focus(p) { p.el.style.zIndex = String(++z) }

  // leader: a soft curve from the anchor to the pin's nearest edge, a dot on the anchor
  const NS = 'http://www.w3.org/2000/svg'
  function wire(g, holder, x1, y1, x2, y2, color, op = 1) {
    if (!holder.path) { holder.path = document.createElementNS(NS, 'path'); holder.dot = document.createElementNS(NS, 'circle'); holder.dot.setAttribute('r', '3.5'); g.append(holder.path, holder.dot) }
    const mx = (x1 + x2) / 2
    const d = `M${x1.toFixed(1)},${y1.toFixed(1)} C${mx.toFixed(1)},${y1.toFixed(1)} ${mx.toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`
    if (holder.d !== d) { holder.d = d; holder.path.setAttribute('d', d); holder.dot.setAttribute('cx', x1.toFixed(1)); holder.dot.setAttribute('cy', y1.toFixed(1)) }
    if (holder.c !== color) { holder.c = color; holder.path.setAttribute('stroke', color); holder.dot.setAttribute('fill', color) }
    const o = String(op); if (holder.o !== o) { holder.o = o; holder.path.style.opacity = o; holder.dot.style.opacity = o }
  }
  const edge = (r, x, y) => {
    // nearest point on the rect's left or right side, in the header band when the anchor is above
    const ex = x < r.left ? r.left : x > r.right ? r.right : (x - r.left < r.right - x ? r.left : r.right)
    const ey = Math.min(Math.max(y, r.top + 18), r.bottom - 12)
    return [ex, ey]
  }
  function frame() {
    for (const p of pins.values()) {
      const a = p.sel && anchor(p.sel)
      const show = a && a[2]
      if (!show) { if (p.path) { p.path.style.display = 'none'; p.dot.style.display = 'none' } continue }
      const r = p.el.getBoundingClientRect()
      const [ex, ey] = edge(r, a[0], a[1])
      wire(lead, p, a[0], a[1], ex, ey, a[3] ?? '#2d2a3e', 0.85)
      p.path.style.display = ''; p.dot.style.display = ''
    }
  }
  // redraw open pins (feed change, diff landed); once a frame at most
  let queued = false
  const redraw = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; for (const p of [...pins.values()]) p.draw() }) } }
  addEventListener('resize', () => { for (const p of pins.values()) clamp(p) })

  return { open, place, fold: toggleMin, area, frame, redraw, wire, edge, extra, get: (id) => pins.get(id), saved: () => mem.open ?? [], has: (id) => pins.has(id) }
}

export const pinId = (sel) => (sel.file ? `file:${sel.file}` : sel.task ? `task:${sel.task}` : `session:${sel.session}`)
export { esc }
