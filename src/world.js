// 렌더러, 후처리(블룸), 맵(아레나/정신세계), 하늘
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { tex } from './tex.js';
import { heartMesh, buildCrystal } from './models.js';

function skyDome(top, mid, bot, stars) {
  const g = new THREE.Group();
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { t: { value: new THREE.Color(top) }, m: { value: new THREE.Color(mid) }, b: { value: new THREE.Color(bot) } },
    vertexShader: 'varying vec3 p; void main(){ p=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 t,m,b; varying vec3 p; void main(){ float h=p.y; vec3 c=h>0.? mix(m,t,pow(h,.6)) : mix(m,b,pow(-h,.5)); gl_FragColor=vec4(c,1.); }',
  });
  g.add(new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), m));
  if (stars) {
    const n = 700, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, y = Math.random() * .95 + .02, r = Math.sqrt(1 - y * y) * 280; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = y * 280; pos[i * 3 + 2] = Math.sin(a) * r; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({ map: tex('glow'), size: 3.2, color: stars, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false, fog: false })));
  }
  return g;
}

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x120a2a, .0085);
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, .1, 700);

  /* ----- 조명 ----- */
  const hemi = new THREE.HemisphereLight(0x8c88ff, 0x1a1030, .6); scene.add(hemi);
  const moonL = new THREE.DirectionalLight(0xb4bfff, 1.25); moonL.position.set(-14, 30, 12); moonL.castShadow = true;
  moonL.shadow.mapSize.set(2048, 2048); Object.assign(moonL.shadow.camera, { left: -32, right: 32, top: 22, bottom: -22, near: 1, far: 90 }); moonL.shadow.bias = -.0004;
  scene.add(moonL, moonL.target);
  const rimL = new THREE.DirectionalLight(0xff8ad8, .5); rimL.position.set(20, 10, -18); scene.add(rimL);

  /* ----- 메인 아레나 ----- */
  const arena = new THREE.Group(); scene.add(arena);
  const sky = skyDome(0x050314, 0x241446, 0x0a0618, 0xcfd8ff); arena.add(sky);
  const ft = tex('floor'); ft.wrapS = ft.wrapT = THREE.RepeatWrapping; ft.repeat.set(3, 2);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(48, 1.2, 28), new THREE.MeshStandardMaterial({ map: ft, roughness: .9, metalness: 0, color: 0x7a72b8 }));
  floor.position.y = -.6; floor.receiveShadow = true; arena.add(floor);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(48.6, .14, 28.6), new THREE.MeshBasicMaterial({ color: 0x6a58ff }));
  rim.position.y = .02; rim.scale.set(1, 1, 1); arena.add(rim); rim.position.y = -.05; rim.renderOrder = -1;
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(48, .02, 28)), new THREE.LineBasicMaterial({ color: 0x9a8aff })); edge.position.y = .01; arena.add(edge);
  const centerRune = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshBasicMaterial({ map: tex('rune'), color: 0x6a58ff, transparent: true, opacity: .3, blending: THREE.AdditiveBlending, depthWrite: false }));
  centerRune.rotation.x = -Math.PI / 2; centerRune.position.y = .03; arena.add(centerRune);
  // 하단 떠다니는 바위
  const rocks = [];
  for (let i = 0; i < 16; i++) {
    const r = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + Math.random() * 2.5, 0), new THREE.MeshStandardMaterial({ color: 0x2a2150, flatShading: true, roughness: .9 }));
    const a = i / 16 * 6.283 + Math.random() * .3, d = 30 + Math.random() * 30;
    r.position.set(Math.cos(a) * d * 1.3, -4 - Math.random() * 14 + (Math.random() > .7 ? 12 : 0), Math.sin(a) * d * .8 - 6);
    r.userData.b = r.position.y; r.userData.p = Math.random() * 6; r.rotation.set(Math.random() * 3, Math.random() * 3, 0); arena.add(r); rocks.push(r);
  }
  // 아레나 하단 보라빛 글로우
  const under = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), new THREE.MeshBasicMaterial({ map: tex('glow'), color: 0x5a3aff, transparent: true, opacity: .5, blending: THREE.AdditiveBlending, depthWrite: false }));
  under.rotation.x = -Math.PI / 2; under.position.y = -3; arena.add(under);
  // 장애물(크리스탈)
  const crystals = [];
  const obstacleGroup = new THREE.Group(); arena.add(obstacleGroup);

  /* ----- 정신세계 ----- */
  const mind = new THREE.Group(); mind.visible = false; scene.add(mind);
  mind.add(skyDome(0x2a0a40, 0x7a2a8a, 0x2a0830, 0xffb0ee));
  const mfloor = new THREE.Mesh(new THREE.CylinderGeometry(24, 26, 1.2, 64), new THREE.MeshStandardMaterial({ color: 0x3a1450, roughness: .5, metalness: .4, emissive: 0x2a0838 }));
  mfloor.position.y = -.6; mfloor.receiveShadow = true; mind.add(mfloor);
  const mrune = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: tex('rune'), color: 0xff6ad8, transparent: true, opacity: .6, blending: THREE.AdditiveBlending, depthWrite: false }));
  mrune.rotation.x = -Math.PI / 2; mrune.position.y = .03; mind.add(mrune);
  const hearts = [];
  for (let i = 0; i < 18; i++) {
    const h = heartMesh(new THREE.MeshStandardMaterial({ color: 0xff5fc8, emissive: 0xff2aa8, emissiveIntensity: .9, roughness: .3 }), 1 + Math.random() * 2.5);
    const a = Math.random() * 6.283, d = 18 + Math.random() * 30; h.position.set(Math.cos(a) * d, 2 + Math.random() * 22, Math.sin(a) * d - 4);
    h.userData = { p: Math.random() * 6, y: h.position.y }; mind.add(h); hearts.push(h);
  }
  const mglow = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshBasicMaterial({ map: tex('glow'), color: 0xff3fc8, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false }));
  mglow.rotation.x = -Math.PI / 2; mglow.position.y = .02; mind.add(mglow);

  /* ----- 후처리 ----- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), .6, .55, .9); composer.addPass(bloom);
  composer.addPass(new OutputPass());

  function resize() {
    const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false); composer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  const world = {
    renderer, scene, camera, composer, bloom, arena, mind, obstacleGroup, crystals, moonL, hemi, resize, inMind: false,
    setObstacles(list, S, W, H) {
      crystals.forEach(c => obstacleGroup.remove(c)); crystals.length = 0;
      for (const o of list) { const c = buildCrystal(); c.position.set((o.x - W / 2) * S, 0, (o.y - H / 2) * S); c.scale.setScalar(o.r * S / .95); c.userData.src = o; obstacleGroup.add(c); crystals.push(c); }
    },
    setMind(on) {
      this.inMind = on; arena.visible = !on; mind.visible = on;
      scene.fog.color.set(on ? 0x3a0a40 : 0x120a2a);
      bloom.strength = on ? .9 : .6;
    },
    setCut(on) {
      moonL.intensity = on ? .35 : 1.25; hemi.intensity = on ? .25 : .6; renderer.toneMappingExposure = on ? .9 : 1.05;
      scene.fog.density = on ? .0025 : .0085;
    },
    update(dt, time, charmed) {
      centerRune.rotation.z += dt * .06; mrune.rotation.z -= dt * .08;
      rocks.forEach(r => { r.position.y = r.userData.b + Math.sin(time * .5 + r.userData.p) * .6; r.rotation.y += dt * .05; });
      hearts.forEach(h => { h.position.y = h.userData.y + Math.sin(time * .8 + h.userData.p) * 1.2; h.rotation.y += dt * .6; });
      crystals.forEach((c, i) => {
        const u = c.userData; u.crystal.rotation.y += dt * .8; u.crystal.position.y = 1.7 + Math.sin(time * 1.5 + i) * .12;
        u.mat.emissive.set(charmed ? 0xff3fc8 : 0x5a46ff); u.mat.color.set(charmed ? 0xff9ae6 : 0x7a6aff);
        u.ring.material.color.set(charmed ? 0xff6ad8 : 0x8f7bff); u.ring.rotation.z += dt;
      });
    },
  };
  return world;
}
