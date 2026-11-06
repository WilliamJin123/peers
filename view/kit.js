// three.js stage + parts shared by the 3D samples.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export { THREE }

// iso ortho stage; `span` = world units that must fit the short side
export function stage({ bg, span = 26, shadows = true, iso = true, fov = 0 } = {}) {
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
    const w = innerWidth, h = innerHeight, a = w / h
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
      return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight, v.z < 1]
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
