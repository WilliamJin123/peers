// Shared cards: a session, a task or a file, as HTML. The dock inspector and the pins both draw these.
// Chips: tinted by the holder's colour; a file two sessions edit is red with ⚠.
import { word, base, relOf } from './model.js'
import { DIFF_CSS, diffHtml } from './diffview.js'
import { createLive } from './livefx.js'

const CSS = `
.vw-sub{color:var(--hud-dim);margin:2px 0 6px;overflow-wrap:anywhere}
.vw-sub.alert{color:var(--hud-alert)}
.vw-fs{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.vw-f{all:unset;font:11px/1.75 ui-monospace,Menlo,monospace;padding:0 7px;border-radius:6px;cursor:pointer;overflow-wrap:anywhere;
 background:color-mix(in srgb,var(--c,#8a8278) 15%,#fffdf8);color:color-mix(in srgb,var(--c,#8a8278) 45%,#2d2a3e);border:1px solid color-mix(in srgb,var(--c,#8a8278) 28%,transparent)}
.vw-f:hover{background:color-mix(in srgb,var(--c,#8a8278) 26%,#fffdf8)}
.vw-f:focus-visible{outline:2px solid var(--hud-fg);outline-offset:1px}
.vw-f s{text-decoration:none;opacity:.6}
.vw-f.clash{background:color-mix(in srgb,var(--hud-alert) 16%,#fffdf8);color:var(--hud-alert);border-color:var(--hud-alert)}
.vw-id{font:11px ui-monospace,Menlo,monospace;color:var(--hud-dim)}
.vw-who{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:3px;color:var(--hud-dim)}
.vw-who span{display:inline-flex;gap:5px;align-items:center}
.vw-dot{width:9px;height:9px;border-radius:50%;flex:none;display:inline-block}
.vw-task{color:var(--hud-dim);overflow-wrap:anywhere}
.vw-sha{display:inline-block;font:10.5px ui-monospace,Menlo,monospace;padding:0 5px;border-radius:5px;margin:0 3px 3px 0;background:color-mix(in srgb,var(--c,#8a8278) 18%,#fffdf8)}
${DIFF_CSS}`

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
export { esc }
let styled = false

export function createViews(feed, cache) {
  if (!styled) { styled = true; const st = document.createElement('style'); st.textContent = CSS; document.head.append(st) }
  const holders = (key) => feed.sessions.filter((x) => x.holds.has(key))
  const dot = (c) => `<i class="vw-dot" style="background:${esc(c)}"></i>`
  const who = (id) => { const x = feed.byId[id]; return x ? `<span>${dot(x.color)}${esc(x.name)}</span>` : '' }
  const chip = (key, n, name = base(key)) => {
    const hs = holders(key), c = hs.length > 1
    return `<button class="vw-f ${c ? 'clash' : ''}" data-file="${esc(key)}" style="--c:${esc(hs[0]?.color ?? '#8a8278')}" title="${esc(key)}${c ? ' · two sessions edit it' : ''}">${c ? '⚠ ' : ''}${esc(name)}${n != null ? ` <s>${n}</s>` : ''}</button>`
  }
  // chips for [key, n]: a file name two keys share shows as many folders as tell them apart
  const chips = (list) => {
    const parts = list.map(([k]) => relOf(k).split('/').filter(Boolean))
    const dir = (i) => (list[i][0].endsWith('/') ? '/' : '')
    const name = (i) => {
      for (let d = 1; d <= parts[i].length; d++) {
        const tail = parts[i].slice(-d).join('/')
        if (parts.every((p, j) => j === i || p.slice(-d).join('/') !== tail)) return tail + dir(i)
      }
      return list[i][0]
    }
    return list.map(([k, n], i) => chip(k, n, name(i))).join('')
  }
  const shas = (list, color) => list.map((s) => `<span class="vw-sha" style="--c:${esc(color ?? '#8a8278')}">${esc(s)}</span>`).join('')

  // live edits: new hunks (a new read) are an arrival; marks per render
  const live = createLive({ sigOf: (L) => (L.t === ' ' ? null : L.t + L.s) })
  const seen = new Map() // key → hunks last fed to live
  const name = (id) => feed.byId[id]?.name ?? 'someone', color = (id) => feed.byId[id]?.color ?? '#8a8278'
  // the diff of a file, from the shared cache; all = past the line cap
  function diff(key, { all = false, max = 80, tail = 0 } = {}) {
    const f = feed.fileInfo(key)
    if (!f) return ''
    const r = cache.get(key)
    if (!r) {
      // no source text (demo with no diff): the edit list
      return f.edits?.length ? `<div class="vw-who" style="flex-direction:column">${f.edits.slice(-5).reverse().map((e) => `<span>${who(e.who) || ''} +${e.add} −${e.rem}</span>`).join('')}</div>` : ''
    }
    if (r.state === 'wait' && !r.hunks) return '<div class="dv-note">Reading the diff<span class="dv-wait"></span></div>'
    if (!r.hunks) return '<div class="dv-note">No diff to show: a binary file, a folder, or the read failed.</div>'
    if (!r.hunks.length) return '<div class="dv-note">No uncommitted lines.</div>'
    const ls = r.hunks.flatMap((h) => h.lines)
    if (seen.get(key) !== r.hunks) { seen.set(key, r.hunks); live.update(key, ls) }
    const mk = live.marks(key, ls, { nameOf: name, colorOf: color, abs: true })
    return diffHtml(r.hunks, { rel: key, byId: feed.byId, max: all ? Infinity : max, tail, mk }) + (r.stale ? '<div class="dv-note">Updating<span class="dv-wait"></span></div>' : '')
  }

  const fileHead = (key) => {
    const f = feed.fileInfo(key), hs = holders(key), clash = hs.length > 1
    return { title: relOf(key), color: hs[0]?.color, sub: `${esc(key.split('/')[0])}${f?.lines ? ` · ${f.lines} lines` : ''}${f?.adds != null ? ` · +${f.adds} −${f.dels}` : ''} · ${hs.length ? `${clash ? 'two sessions edit it: ' : ''}${hs.map((x) => esc(x.name)).join(', ')}` : 'nobody holds it now'}`, alert: clash }
  }
  const taskHead = (id) => { const t = feed.taskById[id]; return t && { title: `${t.id} ${t.title || 'untitled'}`, color: feed.byId[t.holders[0]]?.color, sub: `${t.status} · ${esc(t.repo)}`, alert: t.status === 'Needs you' } }
  const sessionHead = (id) => { const x = feed.byId[id]; return x && { title: x.name, color: x.color, sub: `${word(x)}${x.why ? ` · ${esc(x.why)}` : ''} · ${esc(x.repo)} · ${x.commits} ${x.commits === 1 ? 'commit' : 'commits'}`, alert: x.state === 'blocked' } }
  const head = (sel) => (sel.file ? fileHead(sel.file) : sel.task ? taskHead(sel.task) : sessionHead(sel.session))

  function taskBody(id) {
    const t = feed.taskById[id]
    if (!t) return ''
    const fs = chips([...t.files].map((k) => [k]))
    return `<div class="vw-who">${t.holders.map(who).join('') || 'nobody holds it now'}</div>${fs ? `<div class="vw-fs">${fs}</div>` : ''}${t.commits.length ? `<div style="margin-top:6px">${shas(t.commits.slice(0, 6), feed.byId[t.holders[0]]?.color)}</div>` : ''}`
  }
  function sessionBody(id, { focusDiff = false } = {}) {
    const x = feed.byId[id]
    if (!x) return ''
    const fs = chips([...x.holds])
    return `${x.taskId ? `<div><span class="vw-id">${esc(x.taskId)}</span> ${esc(x.task)}</div>` : x.about ? `<div class="vw-task">${esc(x.about)}</div>` : ''}
      ${x.doing ? `<div class="vw-task">now: ${esc(x.doing)}</div>` : ''}
      ${fs ? `<div class="vw-fs">${fs}</div>` : '<div class="vw-sub">holds no files</div>'}${x.shas?.length ? `<div style="margin-top:6px">${shas(x.shas, x.color)}</div>` : ''}
      ${focusDiff && x.focus && feed.fileInfo(x.focus) ? `<div class="vw-sub" style="margin-top:8px">now editing <b>${esc(relOf(x.focus))}</b></div>${diff(x.focus, { max: 40 })}` : ''}`
  }
  const body = (sel, o = {}) => (sel.file ? diff(sel.file, o) : sel.task ? taskBody(sel.task) : sessionBody(sel.session, o))
  const alive = (sel) => (sel.file ? !!feed.fileInfo(sel.file) : sel.task ? !!feed.taskById[sel.task] : !!feed.byId[sel.session])

  return { holders, who, dot, chip, chips, shas, diff, head, body, alive, latest: (key) => live.latest(key) }
}
