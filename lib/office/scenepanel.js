// Scene panel (WA-1226): a HUD chip with the scene time and look; it opens a panel to pick the look (Office, Campus,
// Loft, or Cycle through them) and to preview any time of day. ?look= and ?t=HH:MM set both at load.
import { NAMES, TITLE } from './looks.js'

const CSS = `
.hud-scene{position:relative;margin-left:auto;pointer-events:auto}
.hud-scene + .hud-reset{margin-left:0}
.scene-chip{display:inline-flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
.scene-chip svg{width:14px;height:14px;flex:none}
.scene-chip .l{color:var(--hud-dim)}
.scene-pop{position:absolute;right:0;top:calc(100% + 8px);z-index:8;width:min(320px,calc(100vw - 32px));box-sizing:border-box;padding:12px 14px 12px;
 background:#fffefa;border:1px solid var(--hud-line);border-radius:14px;box-shadow:0 14px 34px -14px rgba(45,42,62,.45);display:none;color:var(--hud-fg)}
.scene-pop.on{display:block;animation:scenePop .18s ease-out}
@keyframes scenePop{from{opacity:0;translate:0 -4px}}
.scene-pop h3{margin:0 0 6px;font:600 12px/1.2 var(--hud-display);color:var(--hud-dim)}
.scene-pop h3 + *{margin-bottom:12px}
.scene-looks{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
.scene-looks button,.scene-live{all:unset;box-sizing:border-box;text-align:center;cursor:pointer;font:600 12px/1 var(--hud-font);padding:7px 4px;border-radius:999px;border:1px solid var(--hud-line);color:var(--hud-fg)}
.scene-looks button[aria-pressed=true],.scene-live[aria-pressed=true]{background:var(--hud-fg);color:#fffdf4}
.scene-looks button:focus-visible,.scene-live:focus-visible,.scene-time input:focus-visible{outline:2px solid var(--hud-fg);outline-offset:2px}
.scene-time{display:flex;align-items:center;gap:10px}
.scene-time input{flex:1;min-width:0;accent-color:var(--hud-fg)}
.scene-time output{font:600 13px/1 var(--hud-font);font-variant-numeric:tabular-nums;min-width:40px}
.scene-live{padding:7px 10px}
.scene-pop p{margin:0;font-size:11.5px;color:var(--hud-dim)}
body.dusk .hud-title{color:#f6f0ff}
body.dusk .hud-count{color:#d4caff} body.dusk .hud-count b{color:#fff}
body.dusk .hud-hint{color:#ddd5ffd9}
body.no-gl .hud-scene{display:none}
@media (max-width:600px){.scene-chip .l{display:none}}
@media (prefers-reduced-motion:reduce){.scene-pop.on{animation:none}}
`
const SUN = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="#ffb02e"/><g stroke="#ffb02e" stroke-width="1.4" stroke-linecap="round"><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1"/></g></svg>'
const LOW = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 11a4.5 4.5 0 0 1 9 0z" fill="#ff8a4c"/><path d="M1.5 12.6h13" stroke="#ff8a4c" stroke-width="1.4" stroke-linecap="round"/></svg>'
const MOON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.8 2.2A6 6 0 1 0 13.8 11 5 5 0 0 1 10.8 2.2z" fill="#8f86e8"/></svg>'
const hhmm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`
const KEY = 'peers-office-look'
const store = { get: () => { try { return localStorage.getItem(KEY) } catch { return null } }, set: (v) => { try { localStorage.setItem(KEY, v) } catch {} } }

// mount: the HUD slot; every: ms between looks on Cycle
export function createScenePanel({ mount, looks, day, every }) {
  if (!document.getElementById('scene-css')) document.head.append(Object.assign(document.createElement('style'), { id: 'scene-css', textContent: CSS }))
  const q = new URLSearchParams(location.search)
  let pick = NAMES.includes(q.get('look')) ? q.get('look') : (store.get() ?? 'cycle')
  if (pick !== 'cycle' && !NAMES.includes(pick)) pick = 'cycle'
  const tq = /^(\d{1,2}):(\d{2})$/.exec(q.get('t') ?? '')
  if (tq) day.preview = +tq[1] * 60 + +tq[2]

  mount.innerHTML = `<button class="hud-btn scene-chip" type="button" aria-expanded="false" aria-controls="scene-pop"><span class="i"></span><span class="t"></span><span class="l"></span></button>
    <div class="scene-pop" id="scene-pop" role="dialog" aria-label="Scene">
      <h3>Look</h3><div class="scene-looks">${[...NAMES, 'cycle'].map((n) => `<button type="button" data-look="${n}">${n === 'cycle' ? 'Cycle' : TITLE[n]}</button>`).join('')}</div>
      <h3>Time of day</h3><div class="scene-time"><input type="range" min="0" max="1435" step="5" aria-label="Preview a time of day"><output></output><button class="scene-live" type="button">Live</button></div>
      <p class="scene-note"></p>
    </div>`
  const chip = mount.querySelector('.scene-chip'), pop = mount.querySelector('.scene-pop'), range = pop.querySelector('input'), outT = pop.querySelector('output'), live = pop.querySelector('.scene-live'), note = pop.querySelector('.scene-note')
  const open = (on) => { pop.classList.toggle('on', on); chip.setAttribute('aria-expanded', String(on)) }
  chip.onclick = (e) => { e.stopPropagation(); open(!pop.classList.contains('on')) }
  addEventListener('pointerdown', (e) => { if (!mount.contains(e.target)) open(false) })
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && pop.classList.contains('on')) { open(false); chip.focus() } })
  pop.addEventListener('keydown', (e) => e.stopPropagation()) // arrows and WASD stay in the panel
  for (const b of pop.querySelectorAll('[data-look]')) b.onclick = () => choose(b.dataset.look)
  range.oninput = () => { day.preview = +range.value; draw() }
  live.onclick = () => { day.preview = day.preview == null ? day.st.mins : null; draw() }

  let next = performance.now() + every
  function choose(n) {
    pick = n; store.set(n)
    if (n === 'cycle') { next = performance.now() + every; looks.set(NAMES[(NAMES.indexOf(looks.name) + 1) % NAMES.length]) } else looks.set(n)
    draw()
  }
  const mins = every / 60000
  function draw() {
    for (const b of pop.querySelectorAll('[data-look]')) b.setAttribute('aria-pressed', String(b.dataset.look === pick))
    live.setAttribute('aria-pressed', String(day.preview == null))
    note.textContent = `${day.preview == null ? 'Sun and sky follow your clock.' : 'Previewing a time. Live goes back to the clock.'}${pick === 'cycle' ? ` The look changes every ${mins >= 1 ? `${Math.round(mins)} min` : `${Math.round(every / 1000)} s`}.` : ''}`
  }
  if (pick !== 'cycle') looks.set(pick, { instant: true })
  draw()

  let shown = ''
  return {
    frame() {
      if (pick === 'cycle' && performance.now() > next) { next = performance.now() + every; looks.set(NAMES[(NAMES.indexOf(looks.name) + 1) % NAMES.length]) }
      const m = day.st.mins, alt = day.st.alt
      const key = `${hhmm(m)}|${alt > 6 ? 's' : alt > -6 ? 'l' : 'm'}|${looks.name}`
      if (key === shown) return
      shown = key
      chip.querySelector('.i').innerHTML = alt > 6 ? SUN : alt > -6 ? LOW : MOON
      chip.querySelector('.t').textContent = hhmm(m)
      chip.querySelector('.l').textContent = TITLE[looks.name]
      chip.setAttribute('aria-label', `Scene: ${TITLE[looks.name]}, ${hhmm(m)}${day.preview == null ? '' : ' (preview)'}`)
      if (document.activeElement !== range) range.value = String(Math.round(m / 5) * 5 % 1440)
      outT.textContent = hhmm(m)
    },
  }
}
