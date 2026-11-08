// Dock: the dense list beside a scene. Right column on wide screens, bottom sheet on tall ones.
// Theme: --dock-bg, --dock-fg, --dock-dim, --dock-line, --dock-chip, --dock-font (fall back to --hud-*).
// tabs: sessions always; tasks = the board as a map. inspect(sel) pins a file, task or session on top.
// sel: { file: 'repo/path' } | { task: id } | { session: id } | null
import { label, codeLine } from './sim.js'

const CSS = `
.dock{position:fixed;z-index:5;box-sizing:border-box;overflow:auto;background:var(--dock-bg,var(--hud-bg));color:var(--dock-fg,var(--hud-fg));
 font:12px/1.4 var(--dock-font,var(--hud-font));border-left:1px solid var(--dock-line,var(--hud-line));padding:14px 14px 12px}
.dock.side{top:0;right:0;bottom:0;width:var(--dock-w)}
.dock.sheet{left:0;right:0;bottom:0;height:var(--dock-h);border-left:0;border-top:1px solid var(--dock-line,var(--hud-line));padding:10px 12px}
.dock h3{margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dock-dim,var(--hud-dim))}
.dock .tabs{display:flex;gap:4px;margin:0 0 10px}
.dock .tabs button{all:unset;cursor:pointer;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:6px;color:var(--dock-dim,var(--hud-dim))}
.dock .tabs button.on{background:var(--dock-chip,#0000000d);color:var(--dock-fg,var(--hud-fg))}
.dock .row{padding:7px 8px;border-radius:8px;margin:0 -8px 2px;cursor:pointer}
.dock .row:hover{background:var(--dock-chip,#0000000d)}
.dock .row.blocked{background:color-mix(in srgb,var(--hud-alert) 13%,transparent);box-shadow:inset 3px 0 var(--hud-alert)}
.dock .row.picked{box-shadow:inset 0 0 0 1.5px var(--dock-fg,var(--hud-fg))}
.dock .top{display:flex;gap:6px;align-items:baseline}
.dock .top i,.dock .who i{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block;transform:translateY(-1px)}
.dock .top b{font-weight:600}
.dock .st{margin-left:auto;color:var(--dock-dim,var(--hud-dim));white-space:nowrap}
.dock .blocked .st{color:var(--hud-alert);font-weight:600}
.dock .why{color:var(--hud-alert)}
.dock .task{color:var(--dock-dim,var(--hud-dim))}
.dock .fs{display:flex;flex-wrap:wrap;gap:3px;margin-top:4px}
.dock .f{font:10.5px/1.6 ui-monospace,Menlo,monospace;padding:0 5px;border-radius:4px;background:var(--dock-chip,#0000000d);cursor:pointer}
.dock .f.on{color:#fff}
.dock .f.clash{background:var(--hud-alert)!important;color:#fff}
.dock .f s{text-decoration:none;opacity:.6}
.dock .log{margin-top:10px;padding-top:8px;border-top:1px solid var(--dock-line,var(--hud-line))}
.dock .log div{color:var(--dock-dim,var(--hud-dim));overflow-wrap:anywhere}
.dock .log div.alert{color:var(--hud-alert)}
.dock .col{margin:0 0 10px}
.dock .col h4{margin:0 0 4px;font-size:11px;font-weight:600;color:var(--dock-dim,var(--hud-dim))}
.dock .col.blk h4{color:var(--hud-alert)}
.dock .card{padding:6px 8px;border:1px solid var(--dock-line,var(--hud-line));border-radius:8px;margin:0 0 4px;cursor:pointer}
.dock .card:hover{background:var(--dock-chip,#0000000d)}
.dock .card.blk{border-color:var(--hud-alert)}
.dock .card.done{opacity:.55}
.dock .card.picked{box-shadow:0 0 0 1.5px var(--dock-fg,var(--hud-fg))}
.dock .card .id{font:10.5px ui-monospace,Menlo,monospace;color:var(--dock-dim,var(--hud-dim))}
.dock .who{display:flex;flex-wrap:wrap;gap:8px;margin-top:3px;color:var(--dock-dim,var(--hud-dim))}
.dock .who span{display:inline-flex;gap:4px;align-items:center}
.dock .insp{margin:0 0 12px;padding:10px;border-radius:10px;border:1px solid var(--dock-line,var(--hud-line));background:var(--dock-chip,#0000000d)}
.dock .insp .hd{display:flex;gap:8px;align-items:baseline}
.dock .insp .hd b{font-weight:600;overflow-wrap:anywhere}
.dock .insp .x{all:unset;cursor:pointer;margin-left:auto;color:var(--dock-dim,var(--hud-dim));padding:0 2px}
.dock .insp .sub{color:var(--dock-dim,var(--hud-dim));margin:2px 0 6px}
.dock .diff{font:10.5px/1.55 ui-monospace,Menlo,monospace;border-radius:6px;background:var(--dock-bg,var(--hud-bg));padding:4px 0;overflow:hidden}
.dock .diff div{padding:0 8px 0 6px;white-space:pre;overflow:hidden;text-overflow:clip;border-left:3px solid transparent}
.dock .diff .n{display:inline-block;width:30px;color:var(--dock-dim,var(--hud-dim));opacity:.7}
.dock .diff .rm{color:var(--dock-dim,var(--hud-dim));text-decoration:line-through;opacity:.7}
.dock .diff .ad{animation:dock-in .5s both}
@keyframes dock-in{from{opacity:0;transform:translateX(-6px)}}
.dock .eds{margin-top:6px}
.dock .eds div{display:flex;gap:6px;align-items:center;color:var(--dock-dim,var(--hud-dim))}
.dock .eds i{width:7px;height:7px;border-radius:50%}
body.docked .hud-tick{display:none}
body.docked.side .hud-top{right:calc(var(--dock-w) + 16px)}
@media (max-width:600px){.dock .task{display:none}}
`
const WORD = { work: 'working', blocked: 'needs you', wait: 'waiting', idle: 'idle' }
const ORDER = { blocked: 0, wait: 1, work: 2, idle: 3 }
const COLS = ['In Progress', 'Blocked', 'To Do', 'Done']
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const base = (f) => f.split('/').pop()

export function createDock(sim, { w = 300, h = 0.4, log = 3, tasks = false, tab = 'sessions', onPick } = {}) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st)
  const side = innerWidth >= innerHeight && innerWidth > 700
  const el = document.createElement('div'); el.className = `dock ${side ? 'side' : 'sheet'}`
  document.body.append(el)
  document.body.classList.add('docked', side ? 'side' : 'sheet')
  const H = Math.round(innerHeight * h)
  document.documentElement.style.setProperty('--dock-w', `${w}px`)
  document.documentElement.style.setProperty('--dock-h', `${H}px`)
  const clash = new Map(), why = {}, lines = []
  let sel = null
  sim.on((e) => {
    if (e.type === 'clash') clash.set(`${e.repo}/${e.file}`, Date.now() + 2500)
    if (e.type === 'state' && e.state === 'blocked') why[e.who] = e.why
    if (e.type !== 'edit' && e.type !== 'take') { lines.unshift([label(e, sim.byId), e.type === 'clash' || e.state === 'blocked']); lines.length = Math.min(lines.length, log) }
    draw()
  })
  const who = (id) => { const x = sim.byId[id]; return `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>` }
  const holderKey = (key) => { const [repo, ...p] = key.split('/'); return sim.holderOf(repo, p.join('/')) }

  function fileInsp(key) {
    const hd = holderKey(key), n = sim.lines.get(key) ?? 0
    const eds = sim.edits.get(key) || []
    const last = eds.at(-1)
    let diff = ''
    if (last) {
      const c = sim.byId[last.who].color, f = key.slice(key.indexOf('/') + 1)
      const rm = Array.from({ length: Math.min(last.rem, 2) }, (_, i) => `<div class="rm"><span class="n">${last.at + i}</span>- ${esc(codeLine(f, last.at + i + 9000))}</div>`)
      const ad = Array.from({ length: Math.min(last.add, 6) }, (_, i) => `<div class="ad" style="border-left-color:${c};animation-delay:${i * 0.12}s"><span class="n">${last.at + i}</span>+ ${esc(codeLine(f, last.at + i + last.t * 97))}</div>`)
      diff = `<div class="diff" data-k="${key}:${last.t}">${rm.join('')}${ad.join('')}${last.add > 6 ? `<div class="rm" style="text-decoration:none">  … ${last.add - 6} more</div>` : ''}</div>`
    }
    const list = eds.slice(-5).reverse().map((e) => `<div><i style="background:${sim.byId[e.who].color}"></i>${esc(sim.byId[e.who].name)} +${e.add} −${e.rem} at line ${e.at}</div>`).join('')
    return `<div class="hd"><b>${esc(key)}</b><button class="x" data-close>✕</button></div>
      <div class="sub">${n} lines · ${hd ? `held by ${esc(hd.name)}` : 'free'}</div>${diff || '<div class="sub">no edits yet</div>'}<div class="eds">${list}</div>`
  }
  function taskInsp(id) {
    const k = sim.taskById[id]
    const fs = [...k.files].map((f) => `<span class="f" data-file="${esc(f)}">${esc(base(f))}</span>`).join('')
    return `<div class="hd"><b>${k.id} ${esc(k.title)}</b><button class="x" data-close>✕</button></div>
      <div class="sub" ${k.status === 'Blocked' ? 'style="color:var(--hud-alert)"' : ''}>${k.status}${k.on ? ` · on ${esc(k.on)}` : ''} · ${k.repo}</div>
      <div class="who">${k.holders.map(who).join('') || 'nobody holds it'}</div>
      ${fs ? `<div class="fs">${fs}</div>` : ''}${k.commits.length ? `<div class="sub" style="margin-top:6px">commits ${k.commits.slice(-4).join(' ')}</div>` : ''}`
  }
  function sessionInsp(id) {
    const x = sim.byId[id]
    const fs = [...x.holds].map(([f, n]) => `<span class="f" data-file="${x.repo}/${esc(f)}">${esc(base(f))} <s>${n}</s></span>`).join('')
    return `<div class="hd"><b><i style="background:${x.color};width:8px;height:8px;border-radius:50%;display:inline-block"></i> ${esc(x.name)}</b><button class="x" data-close>✕</button></div>
      <div class="sub">${WORD[x.state]}${x.taskId ? ` · ${x.taskId} ${esc(x.task)}` : ''} · ${x.commits} commits</div>${fs ? `<div class="fs">${fs}</div>` : ''}`
  }
  const insp = () => !sel ? '' : `<div class="insp">${sel.file ? fileInsp(sel.file) : sel.task ? taskInsp(sel.task) : sessionInsp(sel.session)}</div>`

  function sessions() {
    const now = Date.now()
    return [...sim.sessions].sort((a, b) => ORDER[a.state] - ORDER[b.state]).map((x) => {
      const fs = [...x.holds].map(([f, n]) => {
        const on = f === x.focus, c = clash.get(`${x.repo}/${f}`) > now
        return `<span class="f ${on ? 'on' : ''} ${c ? 'clash' : ''}" data-file="${x.repo}/${esc(f)}" ${on ? `style="background:${x.color}"` : ''}>${esc(base(f))} <s>${n}</s></span>`
      }).join('')
      const sw = x.state === 'blocked' && why[x.id] ? `<div class="why">${esc(why[x.id])}</div>` : ''
      const pk = sel?.session === x.id ? 'picked' : ''
      return `<div class="row ${x.state} ${pk}" data-session="${x.id}"><div class="top"><i style="background:${x.color}"></i><b>${esc(x.name)}</b><span class="st">${WORD[x.state]}</span></div>${sw}<div class="task">${x.taskId ? `${x.taskId} ` : ''}${esc(x.task)} · ${x.repo}</div>${fs ? `<div class="fs">${fs}</div>` : ''}</div>`
    }).join('')
  }
  function board() {
    return COLS.map((c) => {
      const ks = sim.tasks.filter((k) => k.status === c)
      if (!ks.length) return ''
      const cards = ks.map((k) => `<div class="card ${c === 'Blocked' ? 'blk' : c === 'Done' ? 'done' : ''} ${sel?.task === k.id ? 'picked' : ''}" data-task="${k.id}">
        <div><span class="id">${k.id}</span> ${esc(k.title)}</div>
        <div class="who">${k.holders.map(who).join('')}${k.on ? `<span style="color:var(--hud-alert)">on ${esc(k.on)}</span>` : ''}${k.files.size ? `<span>${k.files.size} files</span>` : ''}</div></div>`).join('')
      return `<div class="col ${c === 'Blocked' ? 'blk' : ''}"><h4>${c} · ${ks.length}</h4>${cards}</div>`
    }).join('')
  }
  function draw() {
    const lg = lines.map(([t, a]) => `<div class="${a ? 'alert' : ''}">${esc(t)}</div>`).join('')
    const head = tasks
      ? `<div class="tabs"><button data-tab="sessions" class="${tab === 'sessions' ? 'on' : ''}">Sessions</button><button data-tab="tasks" class="${tab === 'tasks' ? 'on' : ''}">Tasks</button></div>`
      : '<h3>sessions · who needs you first</h3>'
    const body = (tab === 'tasks' ? board() : sessions()) + (lg && tab === 'sessions' ? `<div class="log">${lg}</div>` : '')
    // parts swap apart: the diff's line-in motion plays once per edit, not per redraw
    const set = (n, html) => { if (n.innerHTML !== html) n.innerHTML = html }
    set(hEl, head); set(iEl, insp()); set(bEl, body)
  }
  const hEl = document.createElement('div'), iEl = document.createElement('div'), bEl = document.createElement('div')
  el.append(hEl, iEl, bEl)
  el.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-tab],[data-close],[data-file],[data-task],[data-session]')
    if (!t) return
    ev.stopPropagation()
    if (t.dataset.tab) { tab = t.dataset.tab; draw(); return }
    const s = t.dataset.close !== undefined ? null : t.dataset.file ? { file: t.dataset.file } : t.dataset.task ? { task: t.dataset.task } : { session: t.dataset.session }
    api.inspect(s)
    onPick?.(s)
  })
  draw()
  setInterval(draw, 1000)
  const api = {
    side,
    inset: () => (side ? { right: w, bottom: 0 } : { right: 0, bottom: H }),
    inspect(s) { sel = s; draw(); if (s && !side) el.scrollTop = 0 },
    get picked() { return sel },
    redraw: draw,
  }
  return api
}
