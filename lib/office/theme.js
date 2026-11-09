// The office look: toon flat (Vireo peers-view batch 5 #6). Two flat tones, no ink, no post pass (crisp), pastel sky, long low sun.
import * as THREE from 'three'

const ramp = (() => { const t = new THREE.DataTexture(new Uint8Array([110, 255]), 2, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t })()

export const theme = {
  bg: '#ffd0d6', bgGrad: ['#ffe2c6', '#ffd0d6', '#d6d0ff'], alert: '#ff5a36', glow: '#ffb36b', font: 'Fredoka', fov: 20, round: 0.07,
  // room floors by room order; repeats past 8
  tints: ['#ffd3a6', '#bfe6c4', '#ffc0d0', '#c4d4ff', '#ffe9a0', '#d9ccff', '#bfeee6', '#ffd0b0'],
  c: {
    floor: '#fbe7d0', label: '#a0754a', wall: '#f7a8a0', part: '#fbc4b4', trim: '#fff6e3', rug: '#ffe39a',
    main: '#7fc8f8', lid: '#3d9ee8', sofa: '#ff8fa3', pot: '#e86f4c', leaf: '#5cc96b', leaf2: '#3fae55',
    paper: '#ffffff', desk: '#f2b46b', leg: '#c98446', bezel: '#2d2a3e', lamp: '#fff3c4', ink: '#2d2a3e',
    bubble: '#ffffff', bubbleRing: '#2d2a3e', cork: '#e3a868', frame: '#b8743d', head: '#5a3a1e', sub: '#7a5a3e', pin: '#3d9ee8',
    card: { Working: '#ffffff', 'Needs you': '#ffd2c4', Idle: '#fff3d6', Done: '#d8f0c8' }, plane: '#ffffff', trail: '#ff8fa3', puff: '#fff6e3',
  },
  // dock + HUD tokens; dark text on cream passes AA (#2d2a3e on #fffdf4: 13:1, #6e5f4f dim: 5.6:1)
  css: '--hud-bg:#fffdf4f0;--hud-fg:#2d2a3e;--hud-dim:#6e5f4f;--hud-line:#2d2a3e;--hud-alert:#d9431f;--hud-font:"Fredoka",ui-sans-serif,-apple-system,sans-serif;--hud-display:"Fredoka",ui-sans-serif,-apple-system,sans-serif;--dock-chip:#2d2a3e0f;--dock-line:#2d2a3e33;',
  screen: { bg: '#2d2a3e', fg: '#e8e2ff' },
  confetti: ['#ffd23f', '#ff5a36', '#3d9ee8', '#5cc96b', '#ff8fa3'],
  mat: (color, x = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...x }),
  lights(scene, r) {
    scene.add(new THREE.HemisphereLight('#fff4ec', '#d6c0ff', 1.25))
    const sun = new THREE.DirectionalLight('#ffe0c0', 1.9)
    sun.position.set(18, 11, -4); sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 1; sun.shadow.bias = -0.0005
    scene.add(sun)
    const fit = (half) => { Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half }); sun.shadow.camera.updateProjectionMatrix() }
    fit(r)
    return { sun, fit }
  },
  post: null,
}
