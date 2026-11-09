// Diff hunks as HTML, and one read cache every view shares (dock, pins, tag peek).
// Look: GitHub-like grid; + green / − red sign; added lines tinted by their author; syntax colour per line (hljs).
// Cache: stale-while-revalidate: a new edit keeps the old hunks on screen until the new read lands.
import hljs from '../vendor/highlight.mjs'

export const DIFF_CSS = `
.dv{container-type:inline-size;border:1px solid var(--dock-line);border-radius:10px;overflow:hidden;background:#fffefa;font:11.5px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;color:#24292e}
.dv .hh{display:flex;gap:7px;align-items:center;padding:4px 10px;background:#f4f1ea;border-top:1px solid var(--dock-line);font:600 11.5px/1.4 var(--hud-font);color:var(--hud-fg)}
.dv .hh:first-child{border-top:0}
.dv .hh i{width:8px;height:8px;border-radius:50%;flex:none}
.dv .hh span{color:var(--hud-dim);font-weight:500;overflow-wrap:anywhere;min-width:0}
.dv .hh em{margin-left:auto;font:10.5px ui-monospace,Menlo,monospace;font-style:normal;color:var(--hud-dim);white-space:nowrap}
.dv .dl{display:grid;grid-template-columns:34px 34px 16px 1fr;white-space:pre-wrap;overflow-wrap:anywhere}
.dv .dl .no,.dv .dl .nn{color:#9a9184;text-align:right;padding-right:6px;user-select:none;font-variant-numeric:tabular-nums}
.dv .dl .sg{text-align:center;user-select:none;color:#9a9184}
.dv .dl code{font:inherit;padding-right:10px}
.dv .dl.add{background:#e9f8ec}
.dv .dl.add .sg{color:#1a7f37;font-weight:700}
.dv .dl.add .nn{background:color-mix(in srgb,var(--c,#2da44e) 30%,#e9f8ec);color:#24292e}
.dv .dl.del{background:#fff0ef}
.dv .dl.del .sg{color:#cf222e;font-weight:700}
.dv .dl.del .no{background:#ffd8d5;color:#24292e}
.dv .dl.del code{color:#7d4a46}
.dv .more{all:unset;display:block;box-sizing:border-box;width:100%;padding:5px 10px;background:#f4f1ea;border-top:1px solid var(--dock-line);color:var(--hud-dim);font:600 11.5px var(--hud-font);cursor:pointer}
.dv .more:hover{color:var(--hud-fg)}
.dv .more:focus-visible{outline:2px solid var(--hud-fg);outline-offset:-2px}
@container (max-width:420px){.dv .dl{grid-template-columns:34px 14px 1fr}.dv .dl .no{display:none}.dv .dl.del .no{display:block}.dv .dl.del .nn{display:none}}
.dv-note{color:var(--hud-dim);padding:4px 0}
.dv-wait{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--hud-dim);margin-left:6px;vertical-align:middle;animation:dvp 1s ease-in-out infinite}
@keyframes dvp{50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.dv-wait{animation:none}}
.hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_{color:#cf222e}
.hljs-title,.hljs-title.class_,.hljs-title.function_{color:#8250df}
.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-variable{color:#0550ae}
.hljs-meta .hljs-string,.hljs-regexp,.hljs-string{color:#0a3069}
.hljs-built_in,.hljs-symbol{color:#953800}
.hljs-code,.hljs-comment,.hljs-formula{color:#6e7781;font-style:italic}
.hljs-name,.hljs-quote,.hljs-selector-pseudo,.hljs-selector-tag{color:#116329}
.hljs-section{color:#0550ae;font-weight:700}.hljs-bullet{color:#953800}.hljs-strong{font-weight:700}.hljs-emphasis{font-style:italic}
`

const LANG = { mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', yml: 'yaml', sh: 'bash', zsh: 'bash', md: 'markdown', jsonl: 'json', py: 'python', rs: 'rust', swift: 'swift', html: 'xml', svg: 'xml' }
const langOf = (rel) => { const e = rel.split('.').pop().toLowerCase(); const l = LANG[e] ?? e; return hljs.getLanguage(l) ? l : null }
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
// long lines: hljs time grows with length; past this a line stays plain
const HL_MAX = 400
const hl = (s, lang) => { if (!lang || !s || s.length > HL_MAX) return esc(s); try { return hljs.highlight(s, { language: lang, ignoreIllegals: true }).value } catch { return esc(s) } }

// hunks: [{ at, who, lines: [{ t: '+'|'-'|' ', s, a, o, n }] }]; byId: session id → { name, color }
// max: lines shown before a "show all" button (data-more); tail: only the last N changed lines of the last hunk (peek)
export function diffHtml(hunks, { rel, byId, max = 80, tail = 0 }) {
  const lang = langOf(rel)
  let hs = hunks
  if (tail) {
    const h = hunks.at(-1), ch = h.lines.map((x, i) => (x.t !== ' ' ? i : -1)).filter((i) => i >= 0)
    const end = (ch.at(-1) ?? h.lines.length - 1) + 1
    hs = [{ ...h, lines: h.lines.slice(Math.max(0, end - tail), end) }]
  }
  let out = '', shown = 0, total = 0
  for (const h of hs) total += h.lines.length
  for (const h of hs) {
    if (shown >= max) break
    const x = byId[h.who]
    const first = h.lines.find((L) => L.t !== ' ') ?? h.lines[0]
    if (!tail) out += `<div class="hh">${x ? `<i style="background:${esc(x.color)}"></i>${esc(x.name)}` : ''}${h.at && h.at !== 'new file' ? `<span>${esc(h.at)}</span>` : h.at ? `<span>new file</span>` : ''}<em>line ${esc(first?.n ?? first?.o ?? '')}</em></div>`
    for (const L of h.lines) {
      if (shown++ >= max) break
      const c = byId[L.a]?.color
      const cls = L.t === '+' ? 'add' : L.t === '-' ? 'del' : ''
      out += `<div class="dl ${cls}"${c && cls === 'add' ? ` style="--c:${esc(c)}"` : ''}><span class="no">${L.t === '+' ? '' : L.o ?? ''}</span><span class="nn">${L.t === '-' ? '' : L.n ?? ''}</span><span class="sg">${L.t === ' ' ? '' : L.t === '-' ? '−' : '+'}</span><code>${hl(L.s, lang)}</code></div>`
    }
  }
  const more = Math.max(0, total - max)
  if (more && !tail) out += `<button class="more" type="button" data-more>Show all ${total} lines (${more} more)</button>`
  return `<div class="dv">${out}</div>`
}

// one cache for every view; sig = the file's change stamp (adds|dels), so a new edit reads again
export function createDiffCache(feed) {
  const subs = new Set(), onChange = (k) => { for (const f of subs) f(k) }
  const m = new Map() // key → { sig, hunks, state: 'wait'|'ok'|'none', reading }
  function get(key) {
    if (!feed.diff) return null
    const f = feed.fileInfo(key)
    if (!f) return null
    const sig = `${f.adds}|${f.dels}|${f.edits?.length ?? 0}`
    let e = m.get(key)
    if (!e) { e = { sig: null, hunks: null, state: 'wait', reading: false }; m.set(key, e) }
    if (e.sig !== sig && !e.reading) {
      e.reading = true
      const want = sig
      feed.diff(key).then((h) => { e.hunks = h; e.state = h ? 'ok' : 'none'; e.sig = want }, () => { e.state = e.hunks ? 'ok' : 'none'; e.sig = want })
        .finally(() => { e.reading = false; onChange(key) })
    }
    return { hunks: e.hunks, state: e.state, stale: e.reading && !!e.hunks }
  }
  // drop files no one holds: the cache stays small
  feed.on((ev) => { if (ev.type === 'sync') for (const k of m.keys()) if (!feed.fileInfo(k)) m.delete(k) })
  return { get, warm: (key) => void get(key), on: (f) => (subs.add(f), () => subs.delete(f)) }
}
