// Day and night from the real clock (WA-1226). The sun's height and bearing come from the date, the time and the place:
// latitude from ?lat= (else 40), longitude from the time zone. Height picks the light, the sky, stars, lamps and window tint.
import * as THREE from 'three'

const RAD = Math.PI / 180
// sun height (deg) and compass bearing (deg, 0 = north) at a local time
export function sunAt(d, lat = 40) {
  const y = d.getFullYear(), n = Math.floor((d - new Date(y, 0, 0)) / 864e5)
  const B = (2 * Math.PI * (n - 81)) / 364, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B) // min
  const std = Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset()) // min west, no DST
  const utc = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600
  const h = (utc - std / 60 + eot / 60 - 12) * 15 * RAD
  const dec = -23.44 * Math.cos(((2 * Math.PI) / 365) * (n + 10)) * RAD, f = lat * RAD
  const alt = Math.asin(Math.sin(f) * Math.sin(dec) + Math.cos(f) * Math.cos(dec) * Math.cos(h))
  const az = Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(f) - Math.tan(dec) * Math.cos(f)) // from south, west +
  return { alt: alt / RAD, az: (az / RAD + 540) % 360 }
}

// keyframes by sun height; the day sky is the look's own
const K = [
  { a: -14, sky: ['#141836', '#1f2350', '#2e2c63'], hemi: ['#7480d8', '#24203f', 0.75], sun: ['#a9b8ff', 0.5], star: 1, lamp: 1, win: '#39417c', cloud: '#5a5f8e', fly: 1 },
  { a: -5, sky: ['#2d3270', '#9a6fa6', '#ff9f86'], hemi: ['#c3a3dc', '#4a3a5f', 0.85], sun: ['#ff9a7a', 0.65], star: 0.35, lamp: 0.85, win: '#8a78b8', cloud: '#d9b4c8', fly: 0.6 },
  { a: 3, sky: ['#ffc79a', '#ff9fa0', '#b7a6f0'], hemi: ['#ffd9c4', '#c9a8e0', 1.05], sun: ['#ffa66b', 1.4], star: 0, lamp: 0.3, win: '#ffd9c0', cloud: '#ffe0d2', fly: 0 },
  { a: 22, sky: null, hemi: ['#fff4ec', '#d6c0ff', 1.25], sun: ['#ffe0c0', 1.9], star: 0, lamp: 0, win: '#ffffff', cloud: '#ffffff', fly: 0 },
].map((k) => ({ ...k, sky: k.sky?.map((c) => new THREE.Color(c)), hemi: [new THREE.Color(k.hemi[0]), new THREE.Color(k.hemi[1]), k.hemi[2]], sun: [new THREE.Color(k.sun[0]), k.sun[1]], win: new THREE.Color(k.win), cloud: new THREE.Color(k.cloud) }))
// moon phase: 0 new, 0.5 full; mean synodic month from the new moon of 2000-01-06 18:14 UTC
export const phaseAt = (d) => ((((d - Date.UTC(2000, 0, 6, 18, 14)) / 864e5 / 29.530588853) % 1) + 1) % 1
// the moon at phase p, radius R px: maria (the moon rabbit among them), craters, a lit sphere, earthshine on the dark side
const moons = new Map()
function moonAt(p, R) {
  const key = `${Math.round(p * 400)}:${R}`
  if (moons.has(key)) return moons.get(key)
  const S = R * 2, c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  g.fillStyle = '#fff3d4'; g.beginPath(); g.arc(R, R, R, 0, 7); g.fill()
  const blob = (x, y, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(R + x * R, R + y * R, rx * R, ry * R, rot, 0, 7); g.fill() }
  g.filter = `blur(${Math.max(1, R / 24)}px)`; g.fillStyle = 'rgba(176,160,132,.55)'
  blob(0.28, -0.32, 0.22, 0.17); blob(0.42, 0.02, 0.14, 0.12); blob(0.05, -0.05, 0.12, 0.1)
  // the rabbit: body, head, two ears, tail, at its mortar
  g.fillStyle = 'rgba(150,134,110,.6)'
  blob(-0.2, 0.18, 0.27, 0.19, -0.35); blob(-0.45, -0.04, 0.13, 0.12); blob(0.05, 0.3, 0.07, 0.06)
  blob(-0.36, -0.33, 0.05, 0.2, 0.3); blob(-0.26, -0.3, 0.045, 0.19, 0.55)
  blob(0.3, 0.42, 0.1, 0.07); blob(0.3, 0.32, 0.12, 0.035)
  g.filter = 'none'
  for (const [x, y, r] of [[0.12, 0.62, 0.07], [-0.55, 0.42, 0.05], [0.6, 0.38, 0.045], [-0.05, -0.62, 0.05], [0.5, -0.55, 0.035]]) {
    g.fillStyle = 'rgba(140,124,100,.45)'; blob(x, y, r, r)
    g.fillStyle = 'rgba(255,252,240,.5)'; blob(x - r * 0.25, y - r * 0.25, r * 0.55, r * 0.55)
  }
  // light: L turns from behind (new) through the right side (first quarter) to the front (full)
  const a = 2 * Math.PI * p, Lx = Math.sin(a), Lz = -Math.cos(a)
  const img = g.getImageData(0, 0, S, S), px = img.data
  for (let j = 0; j < S; j++)
    for (let i = 0; i < S; i++) {
      const x = (i + 0.5 - R) / R, y = (j + 0.5 - R) / R, rr = x * x + y * y, o = (j * S + i) * 4
      if (rr >= 1) { px[o + 3] = 0; continue }
      const z = Math.sqrt(1 - rr), d = x * Lx + z * Lz
      const t = Math.min(1, Math.max(0, (d + 0.05) / 0.17)), lit = t * t * (3 - 2 * t)
      const k = 0.16 + 0.84 * lit * (0.82 + 0.18 * z), edge = Math.min(1, (1 - Math.sqrt(rr)) * R)
      px[o] *= k; px[o + 1] *= k; px[o + 2] *= k * 1.06
      px[o + 3] = 255 * edge * (0.4 + 0.6 * lit)
    }
  g.putImageData(img, 0, 0)
  if (moons.size > 8) moons.clear()
  moons.set(key, c)
  return c
}
const smooth = (k) => k * k * (3 - 2 * k)
const minsOf = (d) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60

// looks: its live sky (3 colours); out: materials to tint (windows, clouds, bulbs), set by the scene as it builds
export function createDaylight({ scene, looks, view = null, lat = 40, at = null }) {
  const hemi = new THREE.HemisphereLight('#fff4ec', '#d6c0ff', 1.25)
  const sun = new THREE.DirectionalLight('#ffe0c0', 1.9)
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 1; sun.shadow.bias = -0.0005
  scene.add(hemi, sun)
  const fit = (half) => { Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half }); sun.shadow.camera.updateProjectionMatrix() }
  fit(20)

  // sky: gradient, stars and the moon on a canvas behind the scene, sized to the view (a square stretched blurs and squashes);
  // drawn again only when it changes
  const cv = document.createElement('canvas'); cv.width = cv.height = 2
  const g = cv.getContext('2d'), tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; scene.background = tex
  let r = 41; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647
  const STARS = Array.from({ length: 140 }, () => [rnd(), rnd() * 0.6, 0.6 + rnd() * 1.3, rnd()])
  let skyKey = '', size = ''
  function fitSky() {
    const w = view?.clientWidth || innerWidth || 1280, h = view?.clientHeight || innerHeight || 800, k = Math.min(devicePixelRatio || 1, 2, 2048 / Math.max(w, h))
    const W = Math.round(w * k), H = Math.round(h * k)
    if (`${W}x${H}` === size) return k
    size = `${W}x${H}`; skyKey = ''
    cv.width = W; cv.height = H; tex.dispose() // new size: a new GPU texture
    return k
  }
  function drawSky(cols, star, phase) {
    const k = fitSky(), W = cv.width, H = cv.height
    const key = cols.map((c) => c.getHexString()).join() + star.toFixed(2) + Math.round(phase * 400)
    if (key === skyKey) return
    skyKey = key
    const gr = g.createLinearGradient(0, 0, 0, H)
    cols.forEach((c, i) => gr.addColorStop(i / (cols.length - 1), `#${c.getHexString()}`))
    g.fillStyle = gr; g.fillRect(0, 0, W, H)
    if (star > 0.01) {
      g.fillStyle = '#ffffff'
      for (const [x, y, s, b] of STARS) { g.globalAlpha = star * (0.35 + b * 0.65) * (1 - y / 0.7); g.beginPath(); g.arc(x * W, y * H, s * k, 0, 7); g.fill() }
      const R = Math.round(Math.min(46, Math.max(16, Math.min(W, H) / k * 0.035)) * k), mx = W * 0.78, my = H * 0.13 + R
      const lit = (1 - Math.cos(2 * Math.PI * phase)) / 2 // lit fraction of the face
      const halo = g.createRadialGradient(mx, my, R * 0.8, mx, my, R * 3.2)
      halo.addColorStop(0, `rgba(255,244,214,${0.22 * lit})`); halo.addColorStop(1, 'rgba(255,244,214,0)')
      g.globalAlpha = star; g.fillStyle = halo; g.fillRect(mx - R * 3.2, my - R * 3.2, R * 6.4, R * 6.4)
      g.drawImage(moonAt(phase, R), mx - R, my - R)
    }
    g.globalAlpha = 1
    tex.needsUpdate = true
  }

  const out = { windows: [], clouds: [], flies: [], bulbs: [] }
  const st = { alt: 30, az: 180, lamp: 0, star: 0, dark: false, mins: minsOf(new Date()) }
  let preview = at // minutes, or null = the clock
  const sky = [new THREE.Color(), new THREE.Color(), new THREE.Color()]
  const S0 = new THREE.Vector3(1, 0, 0.25).normalize(), UP = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), moon = new THREE.Vector3()
  const lerpC = (o, a, b, k) => o.lerpColors(a, b, k)
  const tmpC = new THREE.Color(), flyDay = new Map()

  function apply() {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setMinutes(st.mins)
    const { alt, az } = sunAt(d, lat)
    st.alt = alt; st.az = az
    let i = 0; while (i < K.length - 2 && alt > K[i + 1].a) i++
    const A = K[i], B = K[i + 1], k = smooth(Math.min(1, Math.max(0, (alt - A.a) / (B.a - A.a))))
    const skyA = A.sky ?? looks.sky, skyB = B.sky ?? looks.sky
    sky.forEach((c, j) => lerpC(c, skyA[j], skyB[j], k))
    lerpC(hemi.color, A.hemi[0], B.hemi[0], k); lerpC(hemi.groundColor, A.hemi[1], B.hemi[1], k); hemi.intensity = A.hemi[2] + (B.hemi[2] - A.hemi[2]) * k
    lerpC(sun.color, A.sun[0], B.sun[0], k); sun.intensity = A.sun[1] + (B.sun[1] - A.sun[1]) * k
    st.star = A.star + (B.star - A.star) * k; st.lamp = A.lamp + (B.lamp - A.lamp) * k
    const fly = A.fly + (B.fly - A.fly) * k
    lerpC(tmpC, A.win, B.win, k); for (const m of out.windows) m.color.copy(tmpC)
    lerpC(tmpC, A.cloud, B.cloud, k); for (const m of out.clouds) m.color.copy(tmpC)
    for (const m of out.flies) { if (!flyDay.has(m)) flyDay.set(m, m.color.clone()); m.color.lerpColors(flyDay.get(m), FIREFLY, fly) }
    for (const m of out.bulbs) m.color.lerpColors(BULB_OFF, BULB_ON, Math.max(0.15, st.lamp))
    drawSky(sky, st.star, phaseAt(d))
    // sun from its bearing (south = front right of the screen); below the horizon the moon takes over, high in the back
    const ang = (az - 180) * RAD, el = Math.max(alt, 12) * RAD
    dir.copy(S0).applyAxisAngle(UP, -ang).multiplyScalar(Math.cos(el)).addScaledVector(UP, Math.sin(el))
    moon.copy(S0).applyAxisAngle(UP, -ang + Math.PI).multiplyScalar(Math.cos(40 * RAD)).addScaledVector(UP, Math.sin(40 * RAD))
    dir.lerp(moon, smooth(Math.min(1, Math.max(0, (-2 - alt) / 8)))).normalize()
    sun.position.copy(dir).multiplyScalar(30)
    const dark = alt < -2
    if (dark !== st.dark) { st.dark = dark; document.body.classList.toggle('dusk', dark) }
  }

  // clock or preview; the shown time eases to the target, the short way round midnight
  let since = 9
  function frame(dt) {
    const target = preview ?? minsOf(new Date())
    let d = target - st.mins; if (d > 720) d -= 1440; if (d < -720) d += 1440
    const moving = Math.abs(d) > 0.2
    st.mins = moving ? (st.mins + d * (1 - Math.exp(-dt * 4)) + 1440) % 1440 : target
    since += dt
    if (moving || since > 2 || looks.busy) { since = 0; apply() }
  }
  apply()
  return {
    sun, hemi, fit, out, frame, st, apply,
    get preview() { return preview },
    set preview(m) { preview = m == null ? null : ((m % 1440) + 1440) % 1440 },
  }
}
const FIREFLY = new THREE.Color('#fff2a0'), BULB_OFF = new THREE.Color('#d9d2c0'), BULB_ON = new THREE.Color('#fff1b8')
