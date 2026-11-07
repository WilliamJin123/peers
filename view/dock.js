// Dock: the dense list beside a scene. Right column on wide screens, bottom sheet on tall ones.
// Theme: --dock-bg, --dock-fg, --dock-dim, --dock-line, --dock-chip, --dock-font (fall back to --hud-*).
import { label } from './sim.js'

const CSS = `
.dock{position:fixed;z-index:5;box-sizing:border-box;overflow:auto;background:var(--dock-bg,var(--hud-bg));color:var(--dock-fg,var(--hud-fg));
 font:12px/1.4 var(--dock-font,var(--hud-font));border-left:1px solid var(--dock-line,var(--hud-line));padding:14px 14px 12px}
.dock.side{top:0;right:0;bottom:0;width:var(--dock-w)}
.dock.sheet{left:0;right:0;bottom:0;height:var(--dock-h);border-left:0;border-top:1px solid var(--dock-line,var(--hud-line));padding:10px 12px}
.dock h3{margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dock-dim,var(--hud-dim))}
.dock .row{padding:7px 8px;border-radius:8px;margin:0 -8px 2px}
.dock .row.blocked{background:color-mix(in srgb,var(--hud-alert) 13%,transparent);box-shadow:inset 3px 0 var(--hud-alert)}
.dock .top{display:flex;gap:6px;align-items:baseline}
.dock .top i{width:8px;height:8px;border-radius:50%;flex:none;transform:translateY(-1px)}
.dock .top b{font-weight:600}
.dock .st{margin-left:auto;color:var(--dock-dim,var(--hud-dim));white-space:nowrap}
.dock .blocked .st{color:var(--hud-alert);font-weight:600}
.dock .why{color:var(--hud-alert)}
.dock .task{color:var(--dock-dim,var(--hud-dim))}
.dock .fs{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px}
.dock .f{font:10.5px/1.6 ui-monospace,Menlo,monospace;padding:0 5px;border-radius:4px;background:var(--dock-chip,#0000000d)}
.dock .f.on{color:#fff}
.dock .f.clash{background:var(--hud-alert)!important;color:#fff}
.dock .f s{text-decoration:none;opacity:.6}
.dock .log{margin-top:10px;padding-top:8px;border-top:1px solid var(--dock-line,var(--hud-line))}
.dock .log div{color:var(--dock-dim,var(--hud-dim));overflow-wrap:anywhere}
.dock .log div.alert{color:var(--hud-alert)}
body.docked .hud-tick{display:none}
body.docked.side .hud-top{right:calc(var(--dock-w) + 16px)}
@media (max-width:600px){.dock .task{display:none}}
`
const WORD = { work: 'working', blocked: 'needs you', wait: 'waiting', idle: 'idle' }
const ORDER = { blocked: 0, wait: 1, work: 2, idle: 3 }
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])

export function createDock(sim, { w = 300, h = 0.4, log = 3 } = {}) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st)
  const side = innerWidth >= innerHeight && innerWidth > 700
  const el = document.createElement('div'); el.className = `dock ${side ? 'side' : 'sheet'}`
  document.body.append(el)
  document.body.classList.add('docked', side ? 'side' : 'sheet')
  const H = Math.round(innerHeight * h)
  document.documentElement.style.setProperty('--dock-w', `${w}px`)
  document.documentElement.style.setProperty('--dock-h', `${H}px`)
  const clash = new Map(), why = {}, lines = []
  sim.on((e) => {
    if (e.type === 'clash') clash.set(`${e.repo}/${e.file}`, Date.now() + 2500)
    if (e.type === 'state' && e.state === 'blocked') why[e.who] = e.why
    if (e.type !== 'edit' && e.type !== 'take') { lines.unshift([label(e, sim.byId), e.type === 'clash' || e.state === 'blocked']); lines.length = Math.min(lines.length, log) }
    draw()
  })
  function draw() {
    const now = Date.now()
    const rows = [...sim.sessions].sort((a, b) => ORDER[a.state] - ORDER[b.state]).map((x) => {
      const fs = [...x.holds].map(([f, n]) => {
        const on = f === x.focus, c = clash.get(`${x.repo}/${f}`) > now
        return `<span class="f ${on ? 'on' : ''} ${c ? 'clash' : ''}" ${on ? `style="background:${x.color}"` : ''}>${esc(f.split('/').pop())} <s>${n}</s></span>`
      }).join('')
      const sw = x.state === 'blocked' && why[x.id] ? `<div class="why">${esc(why[x.id])}</div>` : ''
      return `<div class="row ${x.state}"><div class="top"><i style="background:${x.color}"></i><b>${esc(x.name)}</b><span class="st">${WORD[x.state]}</span></div>${sw}<div class="task">${esc(x.task)} · ${x.repo}</div>${fs ? `<div class="fs">${fs}</div>` : ''}</div>`
    }).join('')
    const lg = lines.map(([t, a]) => `<div class="${a ? 'alert' : ''}">${esc(t)}</div>`).join('')
    const html = `<h3>sessions · who needs you first</h3>${rows}${lg ? `<div class="log">${lg}</div>` : ''}`
    if (el.innerHTML !== html) el.innerHTML = html
  }
  draw()
  setInterval(draw, 1000)
  return { side, inset: () => (side ? { right: w, bottom: 0 } : { right: 0, bottom: H }) }
}
