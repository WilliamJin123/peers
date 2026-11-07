// Shared overlay: counts, name tags the scene places each frame, hover card, event ticker.
// Theme comes from CSS vars on :root (--hud-bg, --hud-fg, --hud-dim, --hud-line, --hud-font, --hud-alert).
import { label } from './sim.js'

const CSS = `
.hud{position:fixed;inset:0;pointer-events:none;font:12px/1.35 var(--hud-font);color:var(--hud-fg)}
.hud-top{position:absolute;top:14px;left:16px;right:16px;display:flex;gap:14px;align-items:baseline;flex-wrap:wrap}
.hud-title{font-weight:600;letter-spacing:.02em}
.hud-count{color:var(--hud-dim)} .hud-count b{color:var(--hud-fg);font-weight:600}
.hud-count.alert b{color:var(--hud-alert)}
.hud-tag{position:absolute;transform:translate(-50%,-100%);white-space:nowrap;pointer-events:auto;cursor:default;
 padding:2px 7px 2px 6px;border-radius:999px;background:var(--hud-bg);border:1px solid var(--hud-line);display:flex;gap:5px;align-items:center;font-size:11px}
.hud-tag i{width:7px;height:7px;border-radius:50%;display:block}
.hud-tag.blocked{border-color:var(--hud-alert);box-shadow:0 0 0 3px color-mix(in srgb,var(--hud-alert) 25%,transparent)}
.hud-tag.hidden{display:none}
.hud-tag em{font-style:normal;color:var(--hud-dim)} .hud-tag em:empty{display:none}
.hud-tag.blocked em{color:var(--hud-alert)}
.hud-card{position:absolute;min-width:220px;max-width:280px;padding:10px 12px;border-radius:10px;background:var(--hud-bg);border:1px solid var(--hud-line);pointer-events:none;display:none}
.hud-card h4{margin:0 0 2px;font-size:12px} .hud-card .d{color:var(--hud-dim)} .hud-card ul{margin:6px 0 0;padding:0;list-style:none}
.hud-card li{display:flex;justify-content:space-between;gap:10px} .hud-card li span:last-child{color:var(--hud-dim)}
.hud-tick{position:absolute;left:16px;bottom:14px;right:16px;display:flex;flex-direction:column;gap:2px;max-width:520px}
.hud-tick div{background:var(--hud-bg);padding:2px 8px;border-radius:6px;width:max-content;max-width:100%;overflow-wrap:anywhere;transition:opacity .6s}
.hud-tick div.alert{color:var(--hud-alert)}
@media (max-width:600px){.hud-tick{max-width:none}.hud-tick div:nth-child(-n+2){display:none}.hud-card{left:12px!important;right:12px;top:auto!important;bottom:70px;max-width:none}}
`

const WORD = { work: 'working', idle: 'idle', blocked: 'needs you', wait: 'waiting' }

export function createHud(sim, { title = 'peers' } = {}) {
  const st = document.createElement('style')
  st.textContent = CSS
  document.head.append(st)
  const root = document.createElement('div')
  root.className = 'hud'
  root.innerHTML = `<div class="hud-top"><span class="hud-title">${title}</span><span class="hud-count" data-k="work"></span><span class="hud-count alert" data-k="blocked"></span><span class="hud-count" data-k="wait"></span><span class="hud-count" data-k="idle"></span></div><div class="hud-card"></div><div class="hud-tick"></div>`
  document.body.append(root)
  const card = root.querySelector('.hud-card')
  const tick = root.querySelector('.hud-tick')
  const tags = {}
  let hover = null

  for (const x of sim.sessions) {
    const el = document.createElement('div')
    el.className = 'hud-tag'
    el.innerHTML = `<i style="background:${x.color}"></i><span>${x.name}</span><em></em>`
    el.onmouseenter = () => (hover = x.id)
    el.onmouseleave = () => (hover = null)
    el.ontouchstart = () => (hover = hover === x.id ? null : x.id)
    root.append(el)
    tags[x.id] = el
  }

  const counts = () => {
    const c = { work: 0, blocked: 0, wait: 0, idle: 0 }
    for (const x of sim.sessions) c[x.state]++
    for (const el of root.querySelectorAll('.hud-count')) {
      const k = el.dataset.k
      el.innerHTML = `<b>${c[k]}</b> ${WORD[k]}`
      el.style.display = c[k] || k === 'work' ? '' : 'none'
    }
  }
  counts()

  sim.on((e) => {
    if (e.type === 'edit' || e.type === 'take') return // too chatty for the ticker
    const d = document.createElement('div')
    d.textContent = label(e, sim.byId)
    if (e.type === 'clash' || (e.type === 'state' && e.state === 'blocked')) d.className = 'alert'
    tick.append(d)
    while (tick.children.length > 4) tick.firstChild.remove()
    ;[...tick.children].forEach((c, i, a) => (c.style.opacity = String(0.4 + (0.6 * (i + 1)) / a.length)))
    counts()
  })

  const renderCard = (x, px, py) => {
    const held = [...x.holds].map(([f, n]) => `<li><span>${f}</span><span>${n} lines</span></li>`).join('')
    card.innerHTML = `<h4>${x.name} <span class="d">${x.id}</span></h4><div class="d">${x.task} · ${WORD[x.state]}</div><ul>${held || '<li class="d">holds no files</li>'}</ul>`
    card.style.display = 'block'
    card.style.left = `${Math.min(px + 14, innerWidth - 300)}px`
    card.style.top = `${Math.max(py - 20, 50)}px`
  }

  return {
    // scene calls once per frame per session; visible=false hides the tag
    place(id, px, py, visible = true) {
      const el = tags[id]
      const x = sim.byId[id]
      el.classList.toggle('hidden', !visible)
      el.classList.toggle('blocked', x.state === 'blocked')
      const hw = el.offsetWidth / 2 + 6
      el.style.left = `${Math.min(Math.max(px, hw), innerWidth - hw)}px`
      el.style.top = `${py}px`
      const sub = x.state === 'blocked' ? 'needs you' : x.state === 'wait' ? 'waiting'
        : x.state === 'idle' ? 'idle' : x.focus ? x.focus.split('/').pop() : ''
      const em = el.lastChild
      if (em.textContent !== sub) em.textContent = sub
      if (hover === id) renderCard(x, px, py)
    },
    frame() {
      if (!hover) card.style.display = 'none'
    },
    set hover(id) { hover = id },
    get hover() { return hover },
  }
}
