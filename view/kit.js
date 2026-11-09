// three.js stage + parts shared by the 3D samples.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { navChrome } from './chrome.js'

export { THREE }

// iso ortho stage; `span` = world units that must fit the short side
export function stage({ bg, span = 26, shadows = true, iso = true, fov = 0, inset } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.shadowMap.enabled = shadows
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  document.body.append(renderer.domElement)
  const scene = new THREE.Scene()
  if (bg) scene.background = new THREE.Color(bg)
  const camera = fov ? new THREE.PerspectiveCamera(fov, 1, 0.1, 400) : new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400)
  if (iso) camera.position.set(30, 28, 30)
  camera.lookAt(0, 0, 0)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.enableDamping = true
  controls.minPolarAngle = 0.35
  controls.maxPolarAngle = 1.15
  controls.minZoom = 0.6
  controls.maxZoom = 3
  const fit = () => {
    // inset: () => {right, bottom} px kept free for a dock
    const ins = inset?.() || { right: 0, bottom: 0 }
    const w = innerWidth - ins.right, h = innerHeight - ins.bottom, a = w / h
    size.w = w; size.h = h
    const half = span / 2
    // portrait: fit width; landscape: fit height
    const hh = a < 1 ? half / a : half
    if (fov) camera.aspect = a
    else { camera.left = -hh * a; camera.right = hh * a; camera.top = hh; camera.bottom = -hh }
    camera.updateProjectionMatrix()
    renderer.setSize(w, h)
    post?.setSize(w, h)
  }
  let post = null
  const size = { w: innerWidth, h: innerHeight }
  fit()
  addEventListener('resize', fit)
  const frames = new Set()
  const clock = new THREE.Clock()
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05)
    const t = clock.elapsedTime
    for (const f of frames) f(dt, t)
    controls.update()
    post ? post.render() : renderer.render(scene, camera)
  })
  const v = new THREE.Vector3()
  return {
    scene, camera, renderer, controls,
    onFrame: (f) => frames.add(f),
    usePost: (p) => { post = p; fit() },
    fit,
    // world → css px
    project(p) {
      v.copy(p).project(camera)
      return [(v.x * 0.5 + 0.5) * size.w, (-v.y * 0.5 + 0.5) * size.h, v.z < 1]
    },
  }
}

export const clay = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, ...extra })

export function box(w, h, d, mat, r = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d, 1, 1, 1), mat)
  m.castShadow = m.receiveShadow = true
  if (r) m.rotation.y = r
  return m
}

// clay bean: body + eyes + raisable hand; y=0 at feet
export function bean(color) {
  const g = new THREE.Group()
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.55, 8, 16), clay(color))
  body.position.y = 0.7
  body.castShadow = true
  g.add(body)
  const eyeM = new THREE.MeshStandardMaterial({ color: '#2b2722', roughness: 0.4 })
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), eyeM)
    e.position.set(s * 0.15, 0.98, 0.38)
    body.parent === g && g.add(e)
  }
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), clay(color))
  hand.position.set(0.48, 0.65, 0.05)
  hand.castShadow = true
  g.add(hand)
  g.userData = { body, hand, speed: 3.2, target: null, done: null }
  return g
}

// move toward target on xz; returns true while moving
export function walk(g, dt) {
  const u = g.userData
  if (!u.target) return false
  const dx = u.target.x - g.position.x, dz = u.target.z - g.position.z
  const d = Math.hypot(dx, dz)
  if (d < 0.05) {
    g.position.x = u.target.x; g.position.z = u.target.z
    u.target = null
    const f = u.done; u.done = null; f?.()
    return false
  }
  const s = Math.min(d, u.speed * dt)
  g.position.x += (dx / d) * s; g.position.z += (dz / d) * s
  g.rotation.y = Math.atan2(dx, dz)
  return true
}

export const goTo = (g, x, z, done) => {
  g.userData.target = { x, z }
  g.userData.done = done
}

// short-lived things that animate over `dur` seconds then remove themselves
export function flights(scene, onFrame) {
  const live = new Set()
  onFrame((dt) => {
    for (const f of live) {
      f.k += dt / f.dur
      if (f.k >= 1) { f.end?.(); scene.remove(f.obj); live.delete(f); continue }
      f.step(f.k, f.obj)
    }
  })
  return (obj, dur, step, end) => { scene.add(obj); live.add({ obj, dur, step, end, k: 0 }) }
}

export const arc = (a, b, k, h) => new THREE.Vector3(
  a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k + Math.sin(Math.PI * k) * h, a.z + (b.z - a.z) * k)

export const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2)

// flat text lying on the ground (canvas texture); w world units wide
export function textPlane(str, { size = 64, color = '#8c8374', w = 4, weight = 600, font = 'ui-sans-serif,-apple-system,sans-serif' } = {}) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128
  const g = c.getContext('2d'); g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(str, 8, 64)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }))
  m.rotation.x = -Math.PI / 2
  return m
}

// warm key light + soft shadows sized to `r`
export function sunlight(scene, { r = 17, sky = '#fff7ec', ground = '#d6c8af', hemi = 1.25, key = 1.7 } = {}) {
  scene.add(new THREE.HemisphereLight(sky, ground, hemi))
  const sun = new THREE.DirectionalLight('#fff1dc', key)
  sun.position.set(10, 22, 6)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r })
  sun.shadow.radius = 6
  scene.add(sun)
  return sun
}

// pose a bean by session state; call each frame. returns nothing
export function pose(b, x, t, moving, at) {
  const u = b.userData, p = x.id.charCodeAt(4) * 0.7
  let y = 0, lean = 0, handY = 0.65
  if (moving) y = Math.abs(Math.sin(t * 12 + p)) * 0.12
  else if (x.state === 'work' && at) { y = Math.sin(t * 7 + p) * 0.03; lean = 0.12; handY = 0.75 + Math.abs(Math.sin(t * 14 + p)) * 0.08 }
  else if (x.state === 'blocked') { y = Math.abs(Math.sin(t * 5 + p)) * 0.16; handY = 1.55 + Math.sin(t * 10) * 0.08 }
  else if (x.state === 'idle' && !moving) { y = -0.15; lean = -0.2 }
  u.body.position.y = 0.7 + y
  u.body.rotation.x += (lean - u.body.rotation.x) * 0.15
  u.hand.position.y += (handY + y - u.hand.position.y) * 0.25
}


// navigate: pan on the ground, zoom to the cursor, click (not drag) picks, flyTo eases the view; Esc or Reset goes home
// pick target: any object, or a parent, with userData.pick
export function navigate(S, { pickables = () => [], onPick, onHover, tip, minZoom = 0.6, maxZoom = 5 } = {}) {
  const { camera, controls, renderer } = S, el = renderer.domElement
  Object.assign(controls, { enablePan: true, screenSpacePanning: false, minZoom, maxZoom, zoomToCursor: true })
  const home = { pos: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom }
  let tw = null
  const flyTo = (target, zoom = camera.zoom, pos, dur = 0.75) => {
    tw = { k: 0, dur, at: performance.now(), t0: controls.target.clone(), t1: target.clone(), p0: camera.position.clone(),
      p1: pos ?? camera.position.clone().add(target.clone().sub(controls.target)), z0: camera.zoom, z1: zoom }
  }
  S.onFrame((dt) => {
    if (!tw) return
    tw.k = Math.min(1, (performance.now() - tw.at) / 1000 / tw.dur) // wall clock: slow frames still land
    const e = ease(tw.k)
    controls.target.lerpVectors(tw.t0, tw.t1, e)
    camera.position.lerpVectors(tw.p0, tw.p1, e)
    camera.zoom = tw.z0 + (tw.z1 - tw.z0) * e
    camera.updateProjectionMatrix()
    if (tw.k >= 1) tw = null
  })
  const ray = new THREE.Raycaster(), m = new THREE.Vector2()
  const hit = (e) => {
    const r = el.getBoundingClientRect()
    m.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(m, camera)
    const h = ray.intersectObjects(pickables(), true)[0]
    let o = h?.object
    while (o && !o.userData.pick) o = o.parent
    return o ? { pick: o.userData.pick, obj: o, point: h.point } : null
  }
  let down = null, last = 0
  el.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]))
  el.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return
    const h = hit(e)
    onPick?.(h?.pick ?? null, h)
  })
  el.addEventListener('pointermove', (e) => {
    if (e.buttons || performance.now() - last < 60) return
    last = performance.now()
    const h = hit(e)
    el.style.cursor = h ? 'pointer' : 'grab'
    onHover?.(h?.pick ?? null, h)
    chrome.tip(e, h && tip?.(h.pick))
  })
  const reset = () => flyTo(home.target, home.zoom, home.pos)
  const chrome = navChrome({ reset, hint: 'drag to turn · right-drag to pan · scroll to zoom · click to inspect' })
  return { flyTo, reset, home }
}

// camera-facing label (canvas sprite); h = world height
export function sign(str, { color = '#2b2722', bg = '#fbf9f4', h = 0.5, weight = 600, font = 'ui-sans-serif,-apple-system,sans-serif', pad = 18 } = {}) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), fs = 56
  g.font = `${weight} ${fs}px ${font}`
  const w = Math.ceil(g.measureText(str).width) + pad * 2
  c.width = w; c.height = fs + pad * 1.4
  g.font = `${weight} ${fs}px ${font}`
  if (bg) { g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, c.width, c.height, c.height / 2); g.fill() }
  g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(str, pad, c.height / 2 + 2)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }))
  s.scale.set((h * c.width) / c.height, h, 1)
  return s
}

// ---- batch 4: motion kit (additive; older samples keep bean/walk/pose) ----

export const easeOutBack = (k, s = 1.70158) => 1 + (s + 1) * (k - 1) ** 3 + s * (k - 1) ** 2
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt))
const angTo = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d }

// stepped time: f runs only every 1/fps s with the summed dt (stop-motion, pixel art)
export const stepped = (fps, f) => {
  if (!fps) return f
  let acc = 0
  return (dt, t) => { acc += dt; if (acc < 1 / fps) return; f(acc, Math.floor(t * fps) / fps); acc = 0 }
}

function capsuleShape(r, len) {
  const s = new THREE.Shape()
  s.moveTo(-r, -len / 2); s.lineTo(-r, len / 2); s.absarc(0, len / 2, r, Math.PI, 0, true)
  s.lineTo(r, -len / 2); s.absarc(0, -len / 2, r, 0, Math.PI, true)
  return s
}

// rigged figure: rig → body (eyes on it), two hands, two feet. kind 'cutout' = flat card that faces the camera
export function figure(color, { mat = clay, kind = 'bean', ink = '#2b2722', rim = '#fffdf7' } = {}) {
  const g = new THREE.Group(), rig = new THREE.Group(); g.add(rig)
  const M = mat(color), cut = kind === 'cutout'
  let body
  if (cut) {
    body = new THREE.Group()
    const face = new THREE.Mesh(new THREE.ExtrudeGeometry(capsuleShape(0.42, 0.55), { depth: 0.05, bevelEnabled: false }), M)
    const back = new THREE.Mesh(new THREE.ShapeGeometry(capsuleShape(0.5, 0.55)), mat(rim))
    back.position.z = -0.02; face.castShadow = back.castShadow = true
    body.add(back, face)
  } else { body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.55, 8, 16), M); body.castShadow = true }
  body.position.y = 0.72; rig.add(body)
  const eyes = new THREE.Group(); eyes.position.set(0, 0.26, cut ? 0.06 : 0.36); body.add(eyes)
  const eyeM = new THREE.MeshBasicMaterial({ color: ink })
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(cut ? new THREE.CircleGeometry(0.065, 16) : new THREE.SphereGeometry(0.06, 10, 10), eyeM)
    e.position.x = s * 0.15; eyes.add(e)
  }
  const part = (geo) => { const m = new THREE.Mesh(geo, M); m.castShadow = true; rig.add(m); return m }
  const hands = [-1, 1].map((s) => { const h = part(cut ? new THREE.CircleGeometry(0.13, 16) : new THREE.SphereGeometry(0.12, 12, 12)); h.position.set(s * 0.5, 0.62, 0.05); return h })
  const feet = [-1, 1].map((s) => { const f = part(cut ? new THREE.CircleGeometry(0.12, 16) : new THREE.SphereGeometry(0.12, 12, 8)); if (!cut) f.scale.set(1.25, 0.7, 1.7); f.position.set(s * 0.17, 0.08, 0.12); return f })
  g.userData = { rig, body, eyes, hands, feet, hand: hands[1], kind, speed: 3.2, v: 0, target: null, done: null, phase: 0, land: 0, blink: 1 + Math.random() * 3, shut: 0, seed: Math.random() * 6 }
  return g
}

// eased walk: speeds up, slows to a stop, turns smoothly; phase counts steps
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

// pose by mode: walk | type | blocked | wait | idle | stand. land > 0 squashes, < 0 stretches
export function act(g, mode, t, dt) {
  const u = g.userData, p = u.seed, { body, hands, feet, eyes } = u
  let y = Math.sin(t * 2.2 + p) * 0.012, tilt = 0, sway = 0, sq = 0
  let H = [[-0.5, 0.62, 0.05], [0.5, 0.62, 0.05]], F = [[0, 0], [0, 0]], open = 1
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
  } else if (mode === 'wait') {
    tilt = -0.04; sway = Math.sin(t * 1.6 + p) * 0.06
    H = [[-0.18, 0.66, 0.42], [0.18, 0.7 + Math.max(0, Math.sin(t * 6 + p)) * 0.05, 0.42]]
  } else if (mode === 'idle') {
    y = -0.1 + Math.sin(t * 1.3 + p) * 0.02; tilt = -0.24; sq = 0.05; open = 0.3
    H = [[-0.52, 0.5, 0.15], [0.52, 0.5, 0.15]]
  }
  u.land = damp(u.land, 0, 7, dt)
  sq += u.land * 0.2
  const sy = 1 - sq, sx = 1 + sq * 0.6
  body.scale.set(damp(body.scale.x, sx, 18, dt), damp(body.scale.y, sy, 18, dt), damp(body.scale.z, sx, 18, dt))
  body.position.y = damp(body.position.y, 0.72 * body.scale.y + y, 18, dt)
  body.rotation.x = damp(body.rotation.x, tilt, 9, dt)
  body.rotation.z = damp(body.rotation.z, sway, 6, dt)
  hands.forEach((h, i) => { h.position.x = damp(h.position.x, H[i][0], 14, dt); h.position.y = damp(h.position.y, H[i][1] + y, 14, dt); h.position.z = damp(h.position.z, H[i][2], 14, dt) })
  feet.forEach((f, i) => { f.position.y = damp(f.position.y, 0.08 + F[i][0], 20, dt); f.position.z = damp(f.position.z, 0.12 + F[i][1], 20, dt) })
  u.blink -= dt
  if (u.blink < 0) { u.shut = 0.13; u.blink = 2 + Math.random() * 4 }
  u.shut -= dt
  eyes.scale.y = damp(eyes.scale.y, u.shut > 0 ? 0.08 : open, 30, dt)
}

// speech-bubble glyph over a head: ! (blocked) · zz (idle) · … (wait)
export function emote(str, { color = '#2b2722', bg = '#fbf9f4', ring = null, h = 0.62, font = 'ui-sans-serif,-apple-system,sans-serif' } = {}) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 140
  const g = c.getContext('2d')
  g.fillStyle = bg; g.beginPath(); g.roundRect(8, 8, 112, 100, 34); g.fill()
  g.beginPath(); g.moveTo(44, 104); g.lineTo(36, 132); g.lineTo(70, 104); g.fill()
  if (ring) { g.strokeStyle = ring; g.lineWidth = 6; g.beginPath(); g.roundRect(8, 8, 112, 100, 34); g.stroke() }
  g.fillStyle = color; g.font = `800 ${str.length > 1 ? 54 : 74}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(str, 64, 60)
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }))
  s.scale.set(h * 128 / 140, h, 1); s.renderOrder = 10
  s.userData = { h, pop: 0 }
  return s
}

// monitor face: code lines that scroll while typing; flash(add) drops in a highlighted line
import { codeLine } from './sim.js'
export function codeScreen(seed, { bg = '#25221e', fg = '#cfc6b6', accent = '#6a9bcc', font = 'ui-monospace,Menlo,monospace', glow = 1 } = {}) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 160
  const g = c.getContext('2d')
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
  const lines = Array.from({ length: 40 }, (_, i) => ({ s: codeLine(seed, i), hot: 0 }))
  let off = 0, n = 40, drawn = -1
  const draw = () => {
    g.fillStyle = bg; g.fillRect(0, 0, 256, 160)
    g.font = `15px ${font}`; g.textBaseline = 'top'
    const top = Math.floor(off), fr = off - top
    for (let i = 0; i < 9; i++) {
      const L = lines[(top + i) % lines.length], y = 8 + (i - fr) * 18
      if (L.hot > 0) { g.fillStyle = accent; g.globalAlpha = Math.min(1, L.hot) * 0.45; g.fillRect(0, y - 2, 256, 18); g.globalAlpha = 1 }
      g.fillStyle = i === 7 ? accent : fg; g.fillText(L.s, 10, y)
    }
    g.fillStyle = accent; g.fillRect(0, 0, 4, 160)
    tex.needsUpdate = true
  }
  draw()
  const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
  mat.color.setScalar(glow)
  return {
    mat, tex,
    step(dt, speed) {
      off += dt * speed
      let hot = false
      for (const L of lines) if (L.hot > 0) { L.hot -= dt * 0.8; hot = true }
      const q = Math.floor(off * 6)
      if (q !== drawn || hot) { drawn = q; draw() }
    },
    flash() { const L = lines[(Math.floor(off) + 7) % lines.length]; L.s = codeLine(seed, n++); L.hot = 1.4 },
  }
}

// paper plane: nose on +z, folded wings, keel
export function paperPlane(mat) {
  const v = [0, 0, 0.36, -0.24, 0.03, -0.2, 0, 0, -0.2, 0, 0, 0.36, 0, 0, -0.2, 0.24, 0.03, -0.2, 0, 0, 0.36, 0, 0, -0.2, 0, -0.1, -0.2]
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geo.computeVertexNormals()
  const m = new THREE.Mesh(geo, mat); m.castShadow = true
  if (mat) mat.side = THREE.DoubleSide
  return m
}

// confetti burst at p: falls, spins, shrinks out. fly = flights(); colors = palette
export function confetti(fly, p, colors, { n = 26, up = 4.2, out = 2.2, dur = 1.6, size = 0.1 } = {}) {
  const grp = new THREE.Group(); grp.position.copy(p)
  const geo = new THREE.PlaneGeometry(size, size * 1.6)
  const bits = Array.from({ length: n }, (_, i) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, toneMapped: false }))
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
