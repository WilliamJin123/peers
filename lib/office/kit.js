// three.js stage + motion parts for the office. Shared geometry and materials; short-lived objects free their GPU memory.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export { THREE }
export const reduced = matchMedia('(prefers-reduced-motion: reduce)')

// stage: renderer, camera, controls, one frame loop. span = world units that fit the short side.
// Perf: DPR cap 2, steps down when frames run slow; 30 fps after 10 s with no input; stops while the tab is hidden.
// text textures: drawn at TX.scale× their layout size, max anisotropy (ground labels sit at a grazing angle)
export const TX = { scale: Math.min(4, Math.max(2, Math.ceil((globalThis.devicePixelRatio || 1) * 2))), aniso: 8 }
// a canvas laid out in w×h px, backed by w·s × h·s
export function hiCanvas(w, h, s = TX.scale) {
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s)
  const g = c.getContext('2d'); g.scale(s, s)
  return [c, g]
}
export function crisp(c) {
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = TX.aniso
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true
  return t
}

export function stage({ bg, span = 30, fov = 20, inset }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'default' }) // throws without WebGL: caller shows the fallback
  TX.aniso = renderer.capabilities.getMaxAnisotropy()
  let dpr = Math.min(devicePixelRatio, 2)
  renderer.setPixelRatio(dpr)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  document.body.append(renderer.domElement)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(bg)
  const camera = new THREE.PerspectiveCamera(fov, 1, 1, 600)
  const controls = new OrbitControls(camera, renderer.domElement)
  Object.assign(controls, { enableDamping: true, minPolarAngle: 0.35, maxPolarAngle: 1.15, enablePan: true, screenSpacePanning: false, zoomToCursor: true })
  const size = { w: innerWidth, h: innerHeight }
  let post = null
  // camera distance so `span` fits the short side, on the iso diagonal
  const dir = new THREE.Vector3(1, 0.93, 1).normalize()
  const distFor = () => { const a = size.w / size.h, half = a < 1 ? span / 2 / a : span / 2; return (half / Math.tan((fov * Math.PI) / 360)) * 1.02 }
  const fit = () => {
    const ins = inset?.() || { right: 0, bottom: 0 }
    size.w = Math.max(1, innerWidth - ins.right); size.h = Math.max(1, innerHeight - ins.bottom)
    camera.aspect = size.w / size.h; camera.updateProjectionMatrix()
    renderer.setSize(size.w, size.h)
    post?.setSize(size.w, size.h)
    controls.minDistance = distFor() * 0.25; controls.maxDistance = distFor() * 1.8
  }
  fit()
  camera.position.copy(dir).multiplyScalar(distFor()); camera.lookAt(0, 0, 0)
  let raf = 0
  addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { fit(); api.onResize?.() }) })

  const frames = new Set()
  let last = performance.now(), t = 0, input = performance.now(), slow = 0, n = 0
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown']) addEventListener(ev, () => (input = performance.now()), { passive: true })
  const loop = (now) => {
    const raw = (now - last) / 1000
    // ambient: 30 fps when nobody touches it
    if (now - input > 10000 && raw < 1 / 31) return
    last = now
    // rAF's stamp can come before run()'s performance.now(): never a negative step
    const dt = Math.max(0, Math.min(raw, 0.05))
    t += dt
    for (const f of frames) f(dt, t)
    controls.update()
    post ? post.render() : renderer.render(scene, camera)
    // slow GPU: 60 of 90 frames over budget (28 ms live, 45 ms ambient) → one DPR step down, to 1
    if (raw < 0.25) { slow += raw > (now - input > 10000 ? 0.045 : 0.028) ? 1 : 0; n++ }
    if (n >= 90) { if (slow > 60 && dpr > 1) { dpr = Math.max(1, dpr - 0.5); renderer.setPixelRatio(dpr); post?.setPixelRatio?.(dpr); fit() } slow = n = 0 }
  }
  const run = () => { last = performance.now(); renderer.setAnimationLoop(loop) }
  document.addEventListener('visibilitychange', () => (document.hidden ? renderer.setAnimationLoop(null) : run()))
  if (!document.hidden) run()

  const v = new THREE.Vector3()
  const api = {
    scene, camera, renderer, controls, size,
    onFrame: (f) => frames.add(f),
    usePost: (p) => { post = p; p.setPixelRatio?.(dpr); fit() },
    fit,
    get span() { return span },
    setSpan(s) { span = s; fit() },
    homePos: (target = new THREE.Vector3()) => target.clone().addScaledVector(dir, distFor()),
    // world → css px in the canvas; z<1 = in front of the camera
    project(p) { v.copy(p).project(camera); return [(v.x * 0.5 + 0.5) * size.w, (-v.y * 0.5 + 0.5) * size.h, v.z < 1] },
    onResize: null,
  }
  return api
}

// cached geometry/material: shared, so flights never free them
const geoCache = new Map()
export const geo = (key, make) => { let g = geoCache.get(key); if (!g) { g = make(); g.userData.shared = true; geoCache.set(key, g) } return g }
export const shared = (m) => ((m.userData.shared = true), m)

// short-lived objects animate for `dur` s, then leave the scene and free what they own
const free = (o) => o.traverse((x) => {
  if (x.geometry && !x.geometry.userData.shared) x.geometry.dispose()
  const ms = x.material ? (Array.isArray(x.material) ? x.material : [x.material]) : []
  for (const m of ms) if (!m.userData.shared) { m.map?.dispose(); m.dispose() }
})
export function flights(scene, onFrame) {
  const live = new Set()
  onFrame((dt) => {
    for (const f of live) {
      f.k += dt / f.dur
      if (f.k >= 1) { live.delete(f); f.end?.(); f.obj.removeFromParent(); if (!f.keep) free(f.obj); continue }
      f.step(f.k, f.obj)
    }
  })
  // keep: the caller still owns the object after the flight
  const fly = (obj, dur, step, end, keep = false) => { if (!obj.parent) scene.add(obj); live.add({ obj, dur, step, end, k: 0, keep }) }
  fly.count = () => live.size
  return fly
}
export { free }

export const arc = (a, b, k, h) => new THREE.Vector3(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k + Math.sin(Math.PI * k) * h, a.z + (b.z - a.z) * k)
export const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)
export const easeOutBack = (k, s = 1.70158) => 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt))
const angTo = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d }

// canvas text that fits w×h px: shrinks to min, then wraps; returns the lines drawn
export function fitText(g, str, { x, y, w, h, size, min = size * 0.55, weight = 600, font, lines: maxLines = 1, align = 'left', lead = 1.15 }) {
  let s = size, out
  for (; s >= min; s -= 2) {
    g.font = `${weight} ${s}px ${font}`
    out = wrap(g, str, w, maxLines)
    if (out && out.length * s * lead <= h) break
  }
  if (!out || s < min) { s = min; g.font = `${weight} ${s}px ${font}`; out = wrap(g, str, w, maxLines, true) }
  g.textBaseline = 'middle'; g.textAlign = align
  const top = y + h / 2 - ((out.length - 1) * s * lead) / 2
  out.forEach((l, i) => g.fillText(l, align === 'center' ? x + w / 2 : x, top + i * s * lead))
  return out
}
// words into ≤ max lines of width w; null if they do not fit (force: last line breaks mid-word, never cut)
function wrap(g, str, w, max, force = false) {
  const words = String(str).split(/(?<=[\s/_-])/)
  const lines = ['']
  for (const wd of words) {
    const tryL = lines[lines.length - 1] + wd
    if (g.measureText(tryL.trimEnd()).width <= w) { lines[lines.length - 1] = tryL; continue }
    if (lines[lines.length - 1]) lines.push(wd)
    else lines[lines.length - 1] = wd
    while (g.measureText(lines[lines.length - 1].trimEnd()).width > w) {
      if (!force) return null
      // break a long word by characters
      const l = lines.pop(); let i = l.length
      while (i > 1 && g.measureText(l.slice(0, i)).width > w) i--
      lines.push(l.slice(0, i), l.slice(i))
    }
    if (lines.length > max && !force) return null
  }
  return lines.map((l) => l.trimEnd())
}

// flat text on the ground; w world units wide; long text shrinks, then wraps to 2 lines
export function textPlane(str, { size = 64, color = '#8c8374', w = 4, weight = 600, font = 'ui-sans-serif,sans-serif' } = {}) {
  const [c, g] = hiCanvas(512, 128); g.fillStyle = color
  fitText(g, str, { x: 8, y: 0, w: 496, h: 128, size, min: 30, weight, font, lines: 2 })
  const t = crisp(c)
  const m = new THREE.Mesh(geo(`plane${w}`, () => new THREE.PlaneGeometry(w, w / 4)), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }))
  m.rotation.x = -Math.PI / 2
  return m
}

// rigged figure: rig → body (eyes on it), two hands, two feet; y=0 at the feet
export function figure(color, { mat, ink }) {
  const g = new THREE.Group(), rig = new THREE.Group(); g.add(rig)
  const M = mat(color)
  const body = new THREE.Mesh(geo('fig-body', () => new THREE.CapsuleGeometry(0.42, 0.55, 6, 14)), M); body.castShadow = true
  body.position.y = 0.72; rig.add(body)
  const eyes = new THREE.Group(); eyes.position.set(0, 0.26, 0.36); body.add(eyes)
  const eyeM = mat(ink)
  for (const s of [-1, 1]) { const e = new THREE.Mesh(geo('fig-eye', () => new THREE.SphereGeometry(0.06, 8, 8)), eyeM); e.position.x = s * 0.15; eyes.add(e) }
  const part = (k, make) => { const m = new THREE.Mesh(geo(k, make), M); m.castShadow = true; rig.add(m); return m }
  const hands = [-1, 1].map((s) => { const h = part('fig-hand', () => new THREE.SphereGeometry(0.12, 10, 10)); h.position.set(s * 0.5, 0.62, 0.05); return h })
  const feet = [-1, 1].map((s) => { const f = part('fig-foot', () => new THREE.SphereGeometry(0.12, 10, 8)); f.scale.set(1.25, 0.7, 1.7); f.position.set(s * 0.17, 0.08, 0.12); return f })
  g.userData = { rig, body, eyes, hands, feet, speed: 3.2, v: 0, target: null, done: null, phase: 0, land: 0, blink: 1 + Math.random() * 3, shut: 0, seed: Math.random() * 6 }
  return g
}
export const goTo = (g, x, z, done) => { g.userData.target = { x, z }; g.userData.done = done }

// eased walk: speeds up, slows to a stop, turns smoothly; phase counts steps. true while it moves
export function stride(g, dt) {
  const u = g.userData
  if (!u.target) { u.v = 0; return false }
  const dx = u.target.x - g.position.x, dz = u.target.z - g.position.z, d = Math.hypot(dx, dz)
  if (d < 0.04) {
    g.position.x = u.target.x; g.position.z = u.target.z
    u.target = null; u.v = 0; u.land = 0.8
    const f = u.done; u.done = null; f?.()
    return false
  }
  u.v = Math.min(u.speed, u.v + dt * u.speed * 3, d * 3 + 0.4)
  const s = Math.min(d, u.v * dt)
  g.position.x += (dx / d) * s; g.position.z += (dz / d) * s
  u.phase += s * 1.6
  g.rotation.y += angTo(g.rotation.y, Math.atan2(dx, dz)) * (1 - Math.exp(-dt * 10))
  return true
}
export const turnTo = (g, yaw, dt, k = 6) => { g.rotation.y += angTo(g.rotation.y, yaw) * (1 - Math.exp(-dt * k)) }

// pose by mode: walk | type | blocked | idle | stand, plus u.beat (stretch | sip | hop | cheer | think | look). land > 0 squashes, < 0 stretches
export const beat = (g, kind, dur = 1.2) => { g.userData.beat = { kind, k: 0, dur } }
export function act(g, mode, t, dt) {
  const u = g.userData, p = u.seed, { body, hands, feet, eyes } = u
  let y = Math.sin(t * 2.2 + p) * 0.012, tilt = 0, sq = 0, open = 1
  let H = [[-0.5, 0.62, 0.05], [0.5, 0.62, 0.05]], F = [[0, 0], [0, 0]]
  if (mode === 'walk') {
    const s = Math.sin(u.phase * Math.PI)
    y = Math.abs(s) * 0.11; sq = -Math.abs(s) * 0.05 + (1 - Math.abs(s)) * 0.06; tilt = 0.08
    F = [[Math.max(0, s) * 0.13, s * 0.2], [Math.max(0, -s) * 0.13, -s * 0.2]]
    H = [[-0.5, 0.64, -s * 0.24], [0.5, 0.64, s * 0.24]]
  } else if (mode === 'type') {
    tilt = 0.15
    const a = Math.max(0, Math.sin(t * 17 + p)), b = Math.max(0, Math.sin(t * 17 + p + Math.PI))
    H = [[-0.26, 0.84 + a * 0.08, 0.45], [0.26, 0.84 + b * 0.08, 0.45]]
  } else if (mode === 'blocked') {
    const s = Math.abs(Math.sin(t * 5 + p))
    y = s * 0.2; sq = s < 0.25 ? (0.25 - s) * 0.5 : -s * 0.05
    H = [[-0.48, 0.6, 0.05], [0.42 + Math.sin(t * 11) * 0.06, 1.6 + Math.sin(t * 11) * 0.06, 0.1]]
  } else if (mode === 'idle') {
    y = -0.1 + Math.sin(t * 1.3 + p) * 0.02; tilt = -0.24; sq = 0.05; open = 0.3
    H = [[-0.52, 0.5, 0.15], [0.52, 0.5, 0.15]]
  }
  // beat: a short gesture over the base pose (u.beat = { kind, k: 0→1, dur }); env rises and falls
  const bt = u.beat
  if (bt) {
    bt.k += dt / bt.dur
    if (bt.k >= 1) u.beat = null
    else {
      const e = Math.sin(Math.PI * Math.min(1, bt.k)), q = Math.min(1, e * 1.6)
      const mix = (a, b) => a.map((v, i) => v + (b[i] - v) * q)
      if (bt.kind === 'stretch') { H = [mix(H[0], [-0.42, 1.95, 0.05]), mix(H[1], [0.42, 1.95, 0.05])]; sq -= e * 0.12; tilt = -e * 0.12; open = 1 - e * 0.85 }
      else if (bt.kind === 'sip') { H = [H[0], mix(H[1], [0.16, 1.32, 0.42])]; tilt = -e * 0.1 }
      else if (bt.kind === 'hop') { const j = Math.max(0, Math.sin(bt.k * Math.PI * 2)); y += j * 0.32; sq += (1 - j) * e * 0.1 - j * 0.06 }
      else if (bt.kind === 'cheer') { const w = Math.sin(t * 18) * 0.12; H = [mix(H[0], [-0.55, 1.75 + w, 0.1]), mix(H[1], [0.55, 1.75 - w, 0.1])]; y += Math.abs(Math.sin(bt.k * Math.PI * 3)) * 0.18 }
      else if (bt.kind === 'think') { H = [H[0], mix(H[1], [0.22, 1.22, 0.38])]; tilt = e * 0.06 }
      else if (bt.kind === 'look') { y += e * 0.03 }
    }
  }
  u.land = damp(u.land, 0, 7, dt)
  sq += u.land * 0.2
  const sy = 1 - sq, sx = 1 + sq * 0.6
  body.scale.set(damp(body.scale.x, sx, 18, dt), damp(body.scale.y, sy, 18, dt), damp(body.scale.z, sx, 18, dt))
  body.position.y = damp(body.position.y, 0.72 * body.scale.y + y, 18, dt)
  body.rotation.x = damp(body.rotation.x, tilt, 9, dt)
  hands.forEach((h, i) => { h.position.x = damp(h.position.x, H[i][0], 14, dt); h.position.y = damp(h.position.y, H[i][1] + y, 14, dt); h.position.z = damp(h.position.z, H[i][2], 14, dt) })
  feet.forEach((f, i) => { f.position.y = damp(f.position.y, 0.08 + F[i][0], 20, dt); f.position.z = damp(f.position.z, 0.12 + F[i][1], 20, dt) })
  u.blink -= dt
  if (u.blink < 0) { u.shut = 0.13; u.blink = 2 + Math.random() * 4 }
  u.shut -= dt
  eyes.scale.y = damp(eyes.scale.y, u.shut > 0 ? 0.08 : open, 30, dt)
}

// speech-bubble glyph: ! (needs you) · zz (idle). Textures shared per look; each sprite owns its material (opacity)
const emoteTex = new Map()
export function emote(str, { color, bg, ring = null, h = 0.62, font }) {
  const key = [str, color, bg, ring].join('|')
  let t = emoteTex.get(key)
  if (!t) {
    const [c, g] = hiCanvas(128, 140)
    if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(8, 8, 112, 100, 34); g.fill(); g.beginPath(); g.moveTo(44, 104); g.lineTo(36, 132); g.lineTo(70, 104); g.fill() }
    if (ring) { g.strokeStyle = ring; g.lineWidth = 6; g.beginPath(); g.roundRect(8, 8, 112, 100, 34); g.stroke() }
    g.fillStyle = color; g.font = `800 ${str.length > 1 ? 54 : 74}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(str, 64, 60)
    t = crisp(c); t.userData.shared = true
    emoteTex.set(key, t)
  }
  const m = new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false })
  const s = new THREE.Sprite(m)
  s.scale.set((h * 128) / 140, h, 1); s.renderOrder = 10
  s.userData = { h, pop: 0 }
  return s
}

// monitor face: code lines scroll while typing; flash() drops in a lit line. Redraws at most 8×/s
const WORDS = ['ledger', 'batch', 'rows', 'session', 'file', 'hold', 'commit', 'map', 'filter', 'next', 'state', 'emit', 'cap', 'size', 'id', 'peer', 'take', 'drop']
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
export function codeLine(file, n) {
  const h = [...file].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 0)
  const g = rng((h ^ Math.imul(n + 1, 2654435761)) >>> 0)
  const ind = '  '.repeat(Math.floor(g() * 3)), k = 2 + Math.floor(g() * 4)
  const w = Array.from({ length: k }, () => WORDS[Math.floor(g() * WORDS.length)])
  const shape = Math.floor(g() * 4)
  return ind + (shape === 0 ? `const ${w[0]} = ${w.slice(1).join('.')}()` : shape === 1 ? `if (${w[0]}.${w[1]}) ${w.slice(2).join(' ') || 'return'}` : shape === 2 ? `${w[0]}(${w.slice(1).join(', ')})` : `return ${w.join(' ')}`)
}
export function codeScreen(seed, { bg, fg, accent, font = 'ui-monospace,Menlo,monospace' }) {
  const [c, g] = hiCanvas(256, 160, Math.min(TX.scale, 3))
  const tex = crisp(c)
  const lines = Array.from({ length: 40 }, (_, i) => ({ s: codeLine(seed, i), hot: 0 }))
  let off = 0, n = 40, since = 1
  const draw = () => {
    g.fillStyle = bg; g.fillRect(0, 0, 256, 160)
    g.font = `15px ${font}`; g.textBaseline = 'top'
    const top = Math.floor(off), fr = off - top
    for (let i = 0; i < 9; i++) {
      const L = lines[(top + i) % lines.length], y = 8 + (i - fr) * 18
      if (L.hot > 0) { g.fillStyle = accent; g.globalAlpha = Math.min(1, L.hot) * 0.45; g.fillRect(0, y - 2, 256, 18); g.globalAlpha = 1 }
      g.fillStyle = i === 7 ? accent : fg; g.fillText(L.s, 10, y)
    }
    tex.needsUpdate = true
  }
  draw()
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
  return {
    mat,
    step(dt, speed) {
      const was = off
      off += dt * speed; since += dt
      let hot = false
      for (const L of lines) if (L.hot > 0) { L.hot -= dt * 0.8; hot = true }
      if (since >= 0.125 && (hot || Math.floor(was * 6) !== Math.floor(off * 6))) { since = 0; draw() }
    },
    flash() { const L = lines[(Math.floor(off) + 7) % lines.length]; L.s = codeLine(seed, n++); L.hot = 1.4; since = 1 },
    dispose() { tex.dispose(); mat.dispose() },
  }
}

// confetti burst at p: falls, spins, shrinks out
export function confetti(fly, p, colors, { n = 26, up = 4.2, out = 2.2, dur = 1.6, size = 0.1 } = {}) {
  if (reduced.matches) return
  const grp = new THREE.Group(); grp.position.copy(p)
  const g = geo(`confetti${size}`, () => new THREE.PlaneGeometry(size, size * 1.6))
  const mats = colors.map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, toneMapped: false }))
  const bits = Array.from({ length: n }, (_, i) => {
    const m = new THREE.Mesh(g, mats[i % mats.length])
    const a = Math.random() * Math.PI * 2, r = out * (0.4 + Math.random() * 0.6)
    m.userData = { v: new THREE.Vector3(Math.cos(a) * r, up * (0.7 + Math.random() * 0.5), Math.sin(a) * r), s: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9) }
    grp.add(m); return m
  })
  fly(grp, dur, (k) => {
    const t = k * dur
    for (const m of bits) {
      const { v, s } = m.userData
      m.position.set(v.x * t, v.y * t - 4.9 * t * t, v.z * t)
      m.rotation.set(s.x * t, s.y * t, s.z * t)
      m.scale.setScalar(k > 0.7 ? (1 - k) / 0.3 : 1)
    }
  })
}

// navigate: orbit, pan, zoom to the cursor; a click (not a drag) picks; flyTo eases the view (instant with reduced motion)
export function navigate(S, { pickables, onPick, tip }) {
  const { camera, controls, renderer } = S, el = renderer.domElement
  const home = { pos: camera.position.clone(), target: controls.target.clone() }
  let tw = null
  const flyTo = (target, dist, pos, dur = 0.75) => {
    const p1 = pos ?? target.clone().add(camera.position.clone().sub(controls.target).setLength(dist ?? camera.position.distanceTo(controls.target)))
    if (reduced.matches) dur = 0
    tw = { dur, at: performance.now(), t0: controls.target.clone(), t1: target.clone(), p0: camera.position.clone(), p1 }
  }
  S.onFrame(() => {
    if (!tw) return
    const k = tw.dur ? Math.min(1, (performance.now() - tw.at) / 1000 / tw.dur) : 1 // wall clock: slow frames still land
    const e = ease(k)
    controls.target.lerpVectors(tw.t0, tw.t1, e)
    camera.position.lerpVectors(tw.p0, tw.p1, e)
    if (k >= 1) tw = null
  })
  controls.addEventListener('start', () => (tw = null))
  const ray = new THREE.Raycaster(), m = new THREE.Vector2()
  const hit = (e) => {
    const r = el.getBoundingClientRect()
    m.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(m, camera)
    const h = ray.intersectObjects(pickables(), true)[0]
    let o = h?.object
    while (o && !o.userData.pick) o = o.parent
    return o ? o.userData.pick : null
  }
  let down = null, last = 0
  el.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]))
  el.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) <= 6) onPick(hit(e)) })
  const tipEl = document.createElement('div'); tipEl.className = 'nav-tip'; document.body.append(tipEl)
  el.addEventListener('pointermove', (e) => {
    if (e.buttons || e.pointerType === 'touch' || performance.now() - last < 60) return
    last = performance.now()
    const p = hit(e), html = p && tip(p)
    el.style.cursor = p ? 'pointer' : 'grab'
    tipEl.style.display = html ? 'block' : 'none'
    if (html) { tipEl.innerHTML = html; tipEl.style.left = `${Math.min(e.clientX + 14, innerWidth - tipEl.offsetWidth - 8)}px`; tipEl.style.top = `${e.clientY + 14}px` }
  })
  el.addEventListener('pointerleave', () => (tipEl.style.display = 'none'))
  const reset = () => flyTo(home.target, null, home.pos)
  addEventListener('keydown', (e) => e.key === 'Escape' && reset())
  // keys: WASD / arrows pan on the floor, Q/E turn, R/F or +/- zoom, Shift = fast; off in a text field
  const held = new Set()
  const MOVE = { w: 1, a: 1, s: 1, d: 1, q: 1, e: 1, r: 1, f: 1, arrowup: 1, arrowdown: 1, arrowleft: 1, arrowright: 1 }
  const ZOOM = { Equal: 'r', NumpadAdd: 'r', Minus: 'f', NumpadSubtract: 'f' } // by code: Shift turns = into +
  const name = (e) => ZOOM[e.code] ?? e.key.toLowerCase()
  const typing = (t) => t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
  addEventListener('keydown', (e) => {
    const k = name(e)
    if (!MOVE[k] || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
    held.add(k); tw = null; e.preventDefault()
  })
  addEventListener('keyup', (e) => held.delete(name(e)))
  addEventListener('blur', () => held.clear())
  const fw = new THREE.Vector3(), rt = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), off = new THREE.Vector3()
  let vel = new THREE.Vector3(), spin = 0, zoom = 0
  S.onFrame((dt) => {
    const on = (...ks) => (ks.some((k) => held.has(k)) ? 1 : 0)
    const fast = held.has('shift') ? 2.2 : 1
    const dist = camera.position.distanceTo(controls.target)
    fw.subVectors(controls.target, camera.position).setY(0).normalize(); rt.crossVectors(fw, up).normalize()
    const want = new THREE.Vector3().addScaledVector(fw, on('w', 'arrowup') - on('s', 'arrowdown')).addScaledVector(rt, on('d', 'arrowright') - on('a', 'arrowleft'))
    if (want.lengthSq()) want.normalize().multiplyScalar(dist * 0.55 * fast)
    // eased: a key press glides in and out
    const k = reduced.matches ? 1 : 1 - Math.exp(-dt * 10)
    vel.lerp(want, k); spin += ((on('q') - on('e')) * 1.4 * fast - spin) * k; zoom += ((on('f') - on('r')) * 0.9 * fast - zoom) * k
    if (vel.lengthSq() < 1e-6 && Math.abs(spin) < 1e-4 && Math.abs(zoom) < 1e-4) return
    // stay over the office: target within the controls' max distance of the centre
    const d = vel.clone().multiplyScalar(dt), lim = controls.maxDistance * 0.45
    const t1 = controls.target.clone().add(d); t1.x = Math.max(-lim, Math.min(lim, t1.x)); t1.z = Math.max(-lim, Math.min(lim, t1.z))
    d.subVectors(t1, controls.target); controls.target.add(d); camera.position.add(d)
    off.subVectors(camera.position, controls.target).applyAxisAngle(up, spin * dt)
    off.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() * (1 + zoom * dt))))
    camera.position.copy(controls.target).add(off)
  })
  addEventListener('keydown', (e) => e.key === 'Shift' && held.add('shift'))
  return { flyTo, reset, home }
}
