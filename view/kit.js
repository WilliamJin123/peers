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
  const flyTo = (target, zoom = camera.zoom, pos) => {
    tw = { k: 0, t0: controls.target.clone(), t1: target.clone(), p0: camera.position.clone(),
      p1: pos ?? camera.position.clone().add(target.clone().sub(controls.target)), z0: camera.zoom, z1: zoom }
  }
  S.onFrame((dt) => {
    if (!tw) return
    tw.k = Math.min(1, tw.k + dt / 0.75)
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
