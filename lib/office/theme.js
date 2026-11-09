// The office look: toon × mini (Vireo peers-view batch 5). Cel bands + ink through a long lens, tilt-shift after the ink.
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { Pass } from 'three/addons/postprocessing/Pass.js'
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js'
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js'
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js'

// ink as a composer pass, so tilt-shift runs after it
class InkPass extends Pass {
  constructor(fx, scene, camera) { super(); Object.assign(this, { fx, scene, camera }); this.needsSwap = false }
  render(renderer, writeBuffer, readBuffer) { renderer.setRenderTarget(this.renderToScreen ? null : readBuffer); renderer.clear(); this.fx.render(this.scene, this.camera) }
}
const ramp = (() => { const t = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t })()

export const theme = {
  bg: '#fdf4dc', alert: '#ff5a36', glow: '#ffb36b', font: 'Fredoka', fov: 20, round: 0.07,
  // room floors by room order; repeats past 8
  tints: ['#ffd9a8', '#cfeab0', '#ffc9d6', '#c9dcff', '#ffe9a0', '#d9ccff', '#bfeee6', '#ffd0b0'],
  c: {
    floor: '#f7e3bd', label: '#a0754a', wall: '#ffb88a', part: '#ffcf9e', trim: '#fff6e3', rug: '#ffe39a',
    main: '#7fc8f8', lid: '#3d9ee8', sofa: '#ff8fa3', pot: '#e86f4c', leaf: '#5cc96b', leaf2: '#3fae55',
    paper: '#ffffff', desk: '#f2b46b', leg: '#c98446', bezel: '#2d2a3e', lamp: '#fff3c4', ink: '#2d2a3e',
    bubble: '#ffffff', bubbleRing: '#2d2a3e', cork: '#e3a868', frame: '#b8743d', head: '#5a3a1e', sub: '#7a5a3e', pin: '#3d9ee8',
    card: { Working: '#ffffff', 'Needs you': '#ffd2c4', Idle: '#fff3d6', Done: '#d8f0c8' }, plane: '#ffffff', trail: '#ff8fa3', puff: '#fff6e3',
  },
  // dock + HUD tokens; dark text on cream passes AA (#2d2a3e on #fffdf4: 13:1, #6e5f4f dim: 5.6:1)
  css: '--hud-bg:#fffdf4f0;--hud-fg:#2d2a3e;--hud-dim:#6e5f4f;--hud-line:#2d2a3e;--hud-alert:#d9431f;--hud-font:"Fredoka",ui-sans-serif,-apple-system,sans-serif;--dock-chip:#ffe39a80;--dock-line:#2d2a3e33;',
  screen: { bg: '#2d2a3e', fg: '#e8e2ff' },
  confetti: ['#ffd23f', '#ff5a36', '#3d9ee8', '#5cc96b', '#ff8fa3'],
  mat: (color, x = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...x }),
  lights(scene, r) {
    scene.add(new THREE.HemisphereLight('#ffffff', '#ffe2b8', 1.1))
    const sun = new THREE.DirectionalLight('#fff1dc', 2.1)
    sun.position.set(10, 22, 6); sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 2; sun.shadow.bias = -0.0005
    scene.add(sun)
    const fit = (half) => { Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half }); sun.shadow.camera.updateProjectionMatrix() }
    fit(r)
    return { sun, fit }
  },
  post(S) {
    const fx = new OutlineEffect(S.renderer, { defaultThickness: 0.0035, defaultColor: [0.18, 0.16, 0.24], defaultAlpha: 1 })
    const h = new ShaderPass(HorizontalTiltShiftShader), v = new ShaderPass(VerticalTiltShiftShader)
    const size = (w, H) => { h.uniforms.h.value = 1.4 / w; v.uniforms.v.value = 1.4 / H; h.uniforms.r.value = v.uniforms.r.value = 0.52 }
    const c = new EffectComposer(S.renderer)
    for (const p of [new InkPass(fx, S.scene, S.camera), h, v, new OutputPass()]) c.addPass(p)
    return { render: () => c.render(), setSize: (w, H) => { c.setSize(w, H); size(w, H) }, setPixelRatio: (r) => c.setPixelRatio(r) }
  },
}
