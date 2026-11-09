// Live edits, for every web view of a diff or a file (list page, office dock, pins, peek).
// A changed line that just came in types in (lines of one arrival stream one after another), washed in its author's
// colour; a name flag pops on the first line of each arrival and fades; each author's newest line ends in a caret with their name (Google Docs style), dim after 2 min.
// Pure strings: the caller puts them in its HTML. A negative animation-delay (time since arrival) lets a re-render
// (Idiomorph, innerHTML) resume the motion where it was, never restart it.
export const LIVE_CSS = `
.ln-in{position:relative;--at:calc(var(--el,0ms) + var(--st,0ms));animation:lnWash 6s cubic-bezier(.2,.8,.2,1) var(--at) both}
/* typed: each character shows at its turn (--k); laid out from the start, so wrapped rows fill in reading order */
.ln-in ln-c{animation:lnCh 1ms calc(var(--at) + var(--k) * var(--cs,12ms)) both}
@keyframes lnCh{from{opacity:0}to{opacity:1}}
.ln-in .ln-cur:not(.old){animation:lnBlink 2.4s ease-in-out infinite,lnShow 1ms calc(var(--at) + var(--ty,0ms)) both}
@keyframes lnShow{from{visibility:hidden}to{visibility:visible}}
@keyframes lnWash{0%{background-color:color-mix(in srgb,var(--c,#8a8278) 38%,transparent)}35%{background-color:color-mix(in srgb,var(--c,#8a8278) 20%,transparent)}}
.ln-flag{position:absolute;right:6px;top:50%;z-index:2;pointer-events:none;white-space:nowrap;font:600 10.5px/1.5 var(--hud-display,var(--ui,system-ui));color:#fff;
 background:var(--c,#8a8278);padding:0 7px;border-radius:7px;box-shadow:0 3px 10px -3px color-mix(in srgb,var(--c,#8a8278) 70%,transparent);
 animation:lnFlag 6s cubic-bezier(.2,.9,.25,1.3) var(--el,0ms) both}
@keyframes lnFlag{0%{opacity:0;transform:translate(8px,-50%) scale(.6)}6%{opacity:1;transform:translate(0,-50%) scale(1)}80%{opacity:1;transform:translate(0,-50%)}100%{opacity:0;transform:translate(0,-50%)}}
.ln-cur{position:relative;display:inline-block;width:2px;height:1.2em;margin-left:2px;vertical-align:-.25em;background:var(--c,#8a8278);animation:lnBlink 2.4s ease-in-out infinite}
.ln-cur b{position:absolute;left:5px;top:50%;transform:translateY(-50%);white-space:nowrap;font:600 9.5px/1.45 var(--hud-display,var(--ui,system-ui));color:#fff;background:var(--c,#8a8278);padding:0 5px;border-radius:5px;z-index:2}
.ln-cur.old{opacity:.45;animation:none}
.ln-cur.old b{display:none}
@keyframes lnBlink{0%,40%,100%{opacity:1}70%{opacity:.6}}
@media (prefers-reduced-motion:reduce){.ln-in ln-c,.ln-in .ln-cur{animation:none}.ln-in{animation:none;background-color:color-mix(in srgb,var(--c,#8a8278) 22%,transparent)}.ln-flag{animation:lnFade 6s var(--el,0ms) both}.ln-cur{animation:none}}
@keyframes lnFade{0%,85%{opacity:1;transform:translateY(-50%)}100%{opacity:0;transform:translateY(-50%)}}
`
const HOLD = 6000 // an arrival's motion, ms
const LABEL = 120000 // a caret keeps its name this long after the edit
const MAX_TYPED = 600 // longer lines only wash in
const CHAR = 14, LINE_GAP = 40, STREAM = 3000 // ms per character at most; pause between lines; an arrival's whole typing
const same = (h) => h
// highlighted HTML → each character (an entity counts as one) in <ln-c style="--k:i">; tags kept as they are
export function typeChars(html) {
  let out = '', k = 0
  for (let i = 0; i < html.length; ) {
    if (html[i] === '<') { const j = html.indexOf('>', i); out += html.slice(i, j + 1); i = j + 1; continue }
    const j = html[i] === '&' ? html.indexOf(';', i) : -1
    const ch = j > i && j - i < 10 ? html.slice(i, j + 1) : html[i]
    out += `<ln-c style="--k:${k++}">${ch}</ln-c>`; i += ch.length
  }
  return out
}
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// sigOf(line) → a changed line's identity ('+text'); unchanged lines → null
export function createLive({ sigOf, now = () => Date.now() }) {
  const files = new Map() // key → { seen: Set(sig), arr: Map(sig → t0) }
  // once per data change: new sigs since the last call arrive now; the first call only learns
  function update(key, lines) {
    const t = now(), sigs = new Set()
    for (const x of lines) { const s = sigOf(x); if (s) sigs.add(s) }
    let f = files.get(key), n = 0
    if (!f) { files.set(key, { seen: sigs, arr: new Map() }); return 0 }
    for (const s of sigs) if (!f.seen.has(s)) { f.arr.set(s, t); n++ }
    f.seen = sigs
    for (const [s, t0] of f.arr) if (t - t0 > HOLD) f.arr.delete(s)
    return n
  }
  // per render: line object → { cls, style, flag, caret, type } (only lines with a mark); type(html) splits a line's code into typed characters
  // abs: write the arrival time (--t0, stable) for views that compare HTML each frame; settle() then sets --el
  function marks(key, lines, { nameOf, colorOf, abs = false }) {
    const f = files.get(key), t = now(), out = new Map()
    const rows = lines.filter((x) => sigOf(x))
    const arr = (x) => f?.arr.get(sigOf(x))
    // caret: each author's newest line (server edit time, or the arrival here)
    const best = new Map()
    for (const x of rows) { const w = Math.max(x.at ?? 0, arr(x) ?? 0); if (x.a && w && !(best.get(x.a)?.w > w)) best.set(x.a, { x, w }) }
    const get = (x) => { let m = out.get(x); if (!m) { m = { cls: '', style: '', flag: '', caret: '', type: same }; out.set(x, m) } return m }
    for (const [a, { x, w }] of best) get(x).caret = `<span class="ln-cur${t - w < LABEL ? '' : ' old'}" style="--c:${esc(colorOf(a))}" aria-hidden="true"><b>${esc(nameOf(a))}</b></span>`
    // one flag per arrival (author + time), on its first row, counting all its rows
    // one arrival types line by line: a line starts when the one above ends; a big one speeds up to fit STREAM
    const len = (x) => Math.max(1, sigOf(x).length - 1)
    const groups = new Map(), chars = new Map(), count = new Map(), clock = new Map()
    for (const x of rows) { const t0 = arr(x); if (t0 != null) { const g = `${x.a ?? ''}@${t0}`; chars.set(g, (chars.get(g) ?? 0) + Math.min(len(x), MAX_TYPED)); count.set(g, (count.get(g) ?? 0) + 1) } }
    for (const x of rows) {
      const t0 = arr(x)
      if (t0 == null) continue
      const g = `${x.a ?? ''}@${t0}`, add = /^[+~]/.test(sigOf(x))
      const o = groups.get(g), n = len(x), cs = Math.min(CHAR, STREAM / chars.get(g))
      const st = Math.round(clock.get(g) ?? 0), ty = Math.round(Math.min(n, MAX_TYPED) * cs)
      clock.set(g, st + ty + Math.min(LINE_GAP, 1000 / count.get(g)))
      const m = get(x), el = abs ? `--t0:${t0}` : `--el:-${Math.max(0, t - t0)}ms`
      m.cls = 'ln-in'; m.style = `${el};--st:${st}ms;--ty:${ty}ms;--cs:${+cs.toFixed(2)}ms;`
      if (n <= MAX_TYPED) m.type = typeChars
      if (o) { o[add ? 'add' : 'del']++; continue }
      groups.set(g, { m, x, el, add: +add, del: +!add })
    }
    for (const { m, x, el, add, del } of groups.values())
      m.flag = `<span class="ln-flag" style="--c:${esc(colorOf(x.a))};${el}" aria-hidden="true">${esc(x.a ? nameOf(x.a) : 'someone')}${add ? ` +${add}` : ''}${del ? ` −${del}` : ''}</span>`
    return out
  }
  // newest arrival in a file (ms), for follow-scroll
  const latest = (key) => Math.max(0, ...(files.get(key)?.arr.values() ?? []))
  return { update, marks, latest, forget: (key) => files.delete(key) }
}

// after an innerHTML write of marks made with abs: turn each --t0 into a negative delay
export function settle(box, now = Date.now()) {
  for (const n of box.querySelectorAll('[style*="--t0"]')) { const t0 = parseFloat(n.style.getPropertyValue('--t0')); if (t0) n.style.setProperty('--el', `-${Math.max(0, now - t0)}ms`) }
}

// follow: after a redraw, bring the newest arrival in `box` (a scroller) into view once; st keeps what it followed
export function follow(box, st, reduced = false) {
  const fl = box.querySelectorAll('.ln-flag')
  if (!fl.length) return
  let best = null, el = -Infinity
  for (const f of fl) { const v = parseFloat(f.style.getPropertyValue('--t0')) || Date.now() + (parseFloat(f.style.getPropertyValue('--el')) || 0); if (v > el) { el = v; best = f } }
  const t = el
  if (t <= (st.followed ?? 0) + 400) return
  st.followed = t
  const r = best.parentElement.getBoundingClientRect(), b = box.getBoundingClientRect()
  if (r.top >= b.top && r.bottom <= b.bottom) return
  box.scrollBy({ top: r.top - b.top - b.height / 2, behavior: reduced ? 'auto' : 'smooth' })
}
