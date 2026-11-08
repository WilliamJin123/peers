// view chrome shared by 3d and svg pages: Reset view button, hint line, hover tip; Esc resets
export function navChrome({ reset, hint = 'drag to pan · scroll to zoom · click to inspect' }) {
  const st = document.createElement('style')
  st.textContent = `.nav-reset{position:fixed;z-index:6;top:44px;right:16px;font:600 11px/1 var(--hud-font);color:var(--hud-fg);background:var(--hud-bg);border:1px solid var(--hud-line);border-radius:999px;padding:6px 10px;cursor:pointer}
body.docked.side .nav-reset{right:calc(var(--dock-w) + 16px)}
.nav-hint{position:fixed;z-index:6;left:16px;bottom:14px;font:11px var(--hud-font);color:var(--hud-dim)}
body.docked.sheet .nav-hint{display:none}
.nav-tip{position:fixed;z-index:7;display:none;pointer-events:none;font:12px/1.35 var(--hud-font);color:var(--hud-fg);background:var(--hud-bg);border:1px solid var(--hud-line);border-radius:8px;padding:5px 8px;max-width:260px}
.nav-tip b{font-weight:600} .nav-tip span{color:var(--hud-dim)}`
  document.head.append(st)
  const b = document.createElement('button'); b.className = 'nav-reset'; b.textContent = 'Reset view'; b.onclick = reset
  const h = document.createElement('div'); h.className = 'nav-hint'; h.textContent = hint
  const tipEl = document.createElement('div'); tipEl.className = 'nav-tip'
  document.body.append(b, h, tipEl)
  addEventListener('keydown', (e) => e.key === 'Escape' && reset())
  // html null hides it
  const tip = (e, html) => {
    tipEl.style.display = html ? 'block' : 'none'
    if (html) { tipEl.innerHTML = html; tipEl.style.left = `${Math.min(e.clientX + 14, innerWidth - tipEl.offsetWidth - 8)}px`; tipEl.style.top = `${e.clientY + 14}px` }
  }
  return { tip }
}
