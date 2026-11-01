// 맵 정의(크기·분위기·지형지물 개수) + 배치 생성 + 지형지물 3D 모델.
// 배치는 중심 대칭(점대칭)이라 두 플레이어에게 공평하다.
import * as THREE from 'three';
import { buildCrystal } from './models.js';

const S = .04;   // 로직 좌표 → 월드 (game.js 와 동일)

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export const MAPS = [
  { id: 'plain', name: '달빛 수정 평원', seed: 11, W: 3400, H: 1900,
    floor: 0x7a72b8, rim: 0x6a58ff, edge: 0x9a8aff, fog: [0x120a2a, .0055], sky: [0x050314, 0x241446, 0x0a0618, 0xcfd8ff], hemi: [0x8c88ff, 0x1a1030], moon: 0xb4bfff, bloom: .6,
    pal: { leaf: 0x3a8f7a, trunk: 0x4a3a5a, rock: 0x3b3466, bush: 0x2f9d86, bush2: 0x7be0b8, wall: 0x6a5f9a, accent: 0x8f7bff },
    n: { crystal: 9, rock: 7, bush: 8 }, decor: ['tuft', 'flower'] },
  { id: 'forest', name: '마녀의 숲', seed: 23, W: 3800, H: 2100,
    floor: 0x2c5036, rim: 0x2fbf7a, edge: 0x7affb0, fog: [0x0b1a16, .007], sky: [0x02100c, 0x0f3a2a, 0x03140e, 0xb8ffe0], hemi: [0x8fe8b8, 0x0a2018], moon: 0xa8ffd8, bloom: .5,
    pal: { leaf: 0x2f8f5a, trunk: 0x5a3f2a, rock: 0x4a5a52, bush: 0x2a9a4a, bush2: 0x8ae86a, wall: 0x5a6a5a, accent: 0xb8ff7a },
    n: { tree: 13, rock: 6, bush: 14 }, decor: ['tuft', 'mush'] },
  { id: 'ruins', name: '고대 폐허', seed: 37, W: 3400, H: 1900,
    floor: 0xb8a98a, rim: 0xd8a460, edge: 0xffd9a0, fog: [0x2a1f18, .005], sky: [0x1c0e12, 0x7a4a3a, 0x1a0e0e, 0xffe0b8], hemi: [0xffe2c0, 0x2a1c14], moon: 0xffd8a8, bloom: .45,
    pal: { leaf: 0x6a8a4a, trunk: 0x5a4a3a, rock: 0x8a7a64, bush: 0x5f8f3a, bush2: 0xb8d86a, wall: 0xa8987a, accent: 0xffc060 },
    n: { pillar: 12, wall: 6, rock: 4, bush: 8 }, decor: ['tuft', 'pebble'] },
  { id: 'candy', name: '설탕 언덕', seed: 51, W: 3600, H: 2000,
    floor: 0xffc9e0, rim: 0xff7ac0, edge: 0xffffff, fog: [0xf4b8dc, .0035], sky: [0xff9ad8, 0xffe0f4, 0xffd0ec, 0], hemi: [0xffd6f0, 0xd890c0], moon: 0xfff0f8, bloom: .3,
    pal: { leaf: 0x7be0b0, trunk: 0xffffff, rock: 0xffa6cc, bush: 0x6fe0a8, bush2: 0xc8ffe0, wall: 0xffe0f0, accent: 0xff5fa8 },
    n: { lolli: 9, candy: 9, bush: 9 }, decor: ['tuft', 'flower'] },
];

/* ---------- 배치 ---------- */
export function layoutMap(map) {
  const { W, H } = map, R = rng(map.seed), objs = [], props = [], bushes = [];
  const spawns = [[W * .1, H / 2], [W * .9, H / 2]];
  const all = () => [...objs, ...bushes];
  const free = (x, y, r, pad) => {
    if (x < r + 110 || x > W - r - 110 || y < r + 110 || y > H - r - 110) return false;
    for (const s of spawns) if (Math.hypot(x - s[0], y - s[1]) < r + 340) return false;
    for (const o of all()) if (Math.hypot(x - o.x, y - o.y) < r + o.r + pad) return false;
    return true;
  };
  const rr = (a, b) => a + R() * (b - a);
  // 한쪽에 놓고 점대칭 위치에도 같이 놓는다
  const pair = (x, y, r, pad, add) => {
    if (!free(x, y, r, pad)) return false;
    if (Math.hypot(x - (W - x), y - (H - y)) < 2 * r + pad + 20) return false;
    add(x, y, false); if (!free(W - x, H - y, r, pad)) { undo(); return false; }
    add(W - x, H - y, true); return true;
  };
  let undoFn = null; const undo = () => undoFn && undoFn();
  const place = (n, rmin, rmax, pad, mk) => {
    let made = 0;
    for (let tries = 0; made < n && tries < n * 80; tries++) {
      const r = rr(rmin, rmax), x = rr(120, W / 2), y = rr(120, H - 120), rot = rR();
      const snap = [objs.length, props.length, bushes.length];
      undoFn = () => { objs.length = snap[0]; props.length = snap[1]; bushes.length = snap[2]; };
      const ok = pair(x, y, r, pad, (px, py, m) => mk(px, py, r, rot, m));
      if (ok) made++;
    }
  };
  const rR = () => R() * 6.283;
  const N = map.n;
  // 중앙 지형지물 (자기 자신과 대칭)
  const center = (kind, r) => { objs.push({ x: W / 2, y: H / 2, r, kind }); props.push({ kind, x: W / 2, y: H / 2, r, rot: 0, v: R() }); };
  if (N.crystal) center('crystal', 40);
  if (N.tree) center('tree', 40);
  if (N.pillar) center('pillar', 34);
  if (N.lolli) center('lolli', 36);
  const solid = (kind, rmin, rmax, pad) => N[kind] && place(N[kind], rmin, rmax, pad, (x, y, r, rot) => { objs.push({ x, y, r, kind }); props.push({ kind, x, y, r, rot, v: R() }); });
  solid('crystal', 30, 38, 90); solid('tree', 30, 40, 70); solid('pillar', 26, 32, 80); solid('lolli', 30, 38, 80); solid('candy', 38, 60, 70);
  solid('rock', 40, 70, 70);
  // 벽: 짧은 원 여러 개로 충돌, 모델은 상자 하나
  if (N.wall) place(N.wall, 150, 210, 90, (x, y, half, rot, m) => {
    const a = props.length && m ? props[props.length - 1].rot : (R() < .5 ? 0 : Math.PI / 2);
    const len = half * 2, ca = Math.cos(a), sa = Math.sin(a);
    for (let k = -half + 18; k <= half - 18; k += 34) objs.push({ x: x + ca * k, y: y + sa * k, r: 22, kind: 'wall' });
    props.push({ kind: 'wall', x, y, r: half, len, rot: a, v: 0 });
  });
  // 풀숲: 크고 넓게
  if (N.bush) place(N.bush, 120, 190, 40, (x, y, r) => bushes.push({ x, y, r }));
  // 장식(충돌 없음, 대칭 아님)
  const decor = [];
  for (const kind of map.decor) {
    const cnt = kind === 'tuft' ? 360 : 90;
    for (let i = 0; i < cnt; i++) {
      const x = rr(80, W - 80), y = rr(80, H - 80);
      if (all().some(o => Math.hypot(x - o.x, y - o.y) < o.r + 12)) continue;
      decor.push({ kind, x, y, s: rr(.6, 1.4), rot: rR(), v: R() });
    }
  }
  return { objs, props, bushes, decor };
}

/* ---------- 3D ---------- */
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: o.r ?? .85, metalness: o.m ?? 0, flatShading: o.flat ?? true, emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1 });
const add = (g, geo, m, x = 0, y = 0, z = 0, shadow = true) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; g.add(o); return o; };
const pick = (arr, v) => arr[Math.floor(v * arr.length) % arr.length];

export function buildProp(map, p) {
  const g = new THREE.Group(), pal = map.pal, w = p.r * S;
  switch (p.kind) {
    case 'crystal': { const c = buildCrystal(); c.scale.setScalar(p.r * S / .95); g.add(c); g.userData.crystal = c; break; }
    case 'tree': {
      const s = w / 1.2, lm = mat(pal.leaf, { e: pal.leaf, ei: .08 });
      add(g, new THREE.CylinderGeometry(.35 * s, .55 * s, 2.4 * s, 7), mat(pal.trunk), 0, 1.2 * s, 0);
      [[2.5, 2.0, 3.0], [2.0, 1.8, 4.4], [1.4, 1.6, 5.6]].forEach(([r, h, y]) => add(g, new THREE.ConeGeometry(r * s, h * s * 1.5, 8), lm, 0, y * s, 0));
      g.rotation.y = p.rot; break;
    }
    case 'rock': {
      const m = mat(pal.rock), a = add(g, new THREE.DodecahedronGeometry(w * 1.25, 0), m, 0, w * .6, 0); a.scale.set(1, .75, .9); a.rotation.set(p.rot, p.rot * 2, 0);
      if (p.v > .5) { const b = add(g, new THREE.DodecahedronGeometry(w * .6, 0), m, w * .9, w * .3, w * .5); b.rotation.set(p.v, p.rot, 0); }
      break;
    }
    case 'pillar': {
      const m = mat(pal.wall), broken = p.v > .55, h = broken ? 2.8 + p.v * 1.2 : 5.4;
      add(g, new THREE.BoxGeometry(w * 3, .5, w * 3), m, 0, .25, 0);
      add(g, new THREE.CylinderGeometry(w * .95, w * 1.05, h, 10), m, 0, .5 + h / 2, 0);
      if (!broken) add(g, new THREE.BoxGeometry(w * 3, .55, w * 3), m, 0, .5 + h + .27, 0);
      else { const c = add(g, new THREE.BoxGeometry(w * 1.5, .5, w * 1.2), m, w * 1.8, .25, w * 1.2); c.rotation.y = p.rot; }
      break;
    }
    case 'wall': {
      const m = mat(pal.wall), len = p.len * S;
      add(g, new THREE.BoxGeometry(len, 1.9, .95), m, 0, .95, 0);
      add(g, new THREE.BoxGeometry(len + .2, .3, 1.15), mat(pal.accent, { e: pal.accent, ei: .12 }), 0, 2.0, 0);
      for (let i = -1; i <= 1; i += 1) add(g, new THREE.BoxGeometry(.7, .6, .8), m, i * len * .3, 2.4, 0);
      g.rotation.y = -p.rot; break;
    }
    case 'lolli': {
      const s = w / 1.2, col = pick([0xff5fa8, 0x6fd8ff, 0xffd86f, 0xb88aff], p.v);
      add(g, new THREE.CylinderGeometry(.14 * s, .14 * s, 3.4 * s, 8), mat(0xffffff, { flat: false }), 0, 1.7 * s, 0);
      const d = add(g, new THREE.CylinderGeometry(1.7 * s, 1.7 * s, .35 * s, 24), mat(col, { flat: false, r: .4, e: col, ei: .1 }), 0, 4.2 * s, 0); d.rotation.x = Math.PI / 2;
      const r1 = add(g, new THREE.TorusGeometry(1.1 * s, .12 * s, 6, 24), mat(0xffffff, { flat: false }), 0, 4.2 * s, .22 * s);
      add(g, new THREE.TorusGeometry(.55 * s, .12 * s, 6, 20), mat(0xffffff, { flat: false }), 0, 4.2 * s, .22 * s);
      g.rotation.y = p.rot; g.rotation.z = (p.v - .5) * .16; break;
    }
    case 'candy': {
      const col = pick([0xffa6cc, 0xa6e8ff, 0xfff1a6, 0xd2b0ff], p.v), s = add(g, new THREE.SphereGeometry(w * 1.1, 16, 12), mat(col, { flat: false, r: .45 }), 0, w * .85, 0); s.scale.y = .85;
      const t = add(g, new THREE.TorusGeometry(w * 1.0, w * .1, 6, 24), mat(0xffffff, { flat: false }), 0, w * .85, 0); t.rotation.set(p.rot, p.rot * .5, 0); break;
    }
  }
  g.position.set(0, 0, 0);
  return g;
}

// 풀숲: 흔들리는 풀잎 수십 개를 InstancedMesh 하나로
export function buildBush(map, b, seed) {
  const g = new THREE.Group(), R = rng(seed * 977 + 13), n = Math.round(b.r * b.r / 280), w = b.r * S;
  const base = new THREE.Mesh(new THREE.CircleGeometry(w * 1.02, 28), new THREE.MeshBasicMaterial({ color: map.pal.bush, transparent: true, opacity: .32, depthWrite: false }));
  base.rotation.x = -Math.PI / 2; base.position.y = .04; g.add(base);
  const geo = new THREE.ConeGeometry(.2, 1.7, 4); geo.translate(0, .85, 0);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9, flatShading: true }), n);
  const c1 = new THREE.Color(map.pal.bush), c2 = new THREE.Color(map.pal.bush2), col = new THREE.Color();
  const data = [];
  for (let i = 0; i < n; i++) {
    const a = R() * 6.283, d = Math.sqrt(R()) * w * .96;
    data.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, s: .8 + R() * 1.0, ry: R() * 6, ph: R() * 6.28 });
    col.copy(c1).lerp(c2, R() * .8); im.setColorAt(i, col);
  }
  im.castShadow = false; im.receiveShadow = false; g.add(im);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  g.userData.update = t => {
    for (let i = 0; i < n; i++) {
      const d = data[i]; e.set(Math.sin(t * 1.6 + d.ph) * .14, d.ry, Math.cos(t * 1.3 + d.ph * 1.7) * .14); q.setFromEuler(e);
      sc.set(1, d.s, 1); ps.set(d.x, 0, d.z); m4.compose(ps, q, sc); im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
  };
  g.userData.update(0);
  return g;
}

// 바닥 장식: 종류별 InstancedMesh
export function buildDecor(map, list, W, H) {
  const g = new THREE.Group(), pal = map.pal, by = {};
  list.forEach(d => (by[d.kind] ||= []).push(d));
  const dm = new THREE.Object3D();
  const inst = (geo, material, arr, fn) => {
    const im = new THREE.InstancedMesh(geo, material, arr.length);
    arr.forEach((d, i) => { dm.position.set((d.x - W / 2) * S, 0, (d.y - H / 2) * S); dm.rotation.set(0, d.rot, 0); dm.scale.setScalar(d.s); fn && fn(dm, d); dm.updateMatrix(); im.setMatrixAt(i, dm.matrix); });
    im.receiveShadow = false; g.add(im); return im;
  };
  if (by.tuft) { const geo = new THREE.ConeGeometry(.12, .8, 4); geo.translate(0, .4, 0); inst(geo, mat(pal.bush2), by.tuft, (o, d) => o.scale.set(d.s, d.s * (.6 + d.v), d.s)); inst(geo, mat(pal.bush), by.tuft, (o, d) => { o.position.x += .18; o.position.z += .1; o.scale.set(d.s, d.s * (.5 + d.v * .8), d.s); }); }
  if (by.flower) { const geo = new THREE.SphereGeometry(.16, 6, 5); geo.translate(0, .55, 0); const im = inst(geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .6 }), by.flower); const cs = [0xffe066, 0xff8ad0, 0xffffff, 0x9ad8ff]; by.flower.forEach((d, i) => im.setColorAt(i, new THREE.Color(cs[Math.floor(d.v * 4) % 4]))); const st = new THREE.CylinderGeometry(.025, .025, .5, 4); st.translate(0, .25, 0); inst(st, mat(pal.bush), by.flower); }
  if (by.mush) {
    const cap = new THREE.SphereGeometry(.34, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2); cap.translate(0, .32, 0);
    const im = inst(cap, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x66ffb0, emissiveIntensity: .7, roughness: .5 }), by.mush); const cs = [0x66ffb0, 0xff8ad0, 0x9ad8ff]; by.mush.forEach((d, i) => im.setColorAt(i, new THREE.Color(cs[Math.floor(d.v * 3) % 3])));
    const st = new THREE.CylinderGeometry(.07, .09, .34, 6); st.translate(0, .17, 0); inst(st, mat(0xe8e2d0), by.mush);
  }
  if (by.pebble) { const geo = new THREE.DodecahedronGeometry(.22, 0); geo.translate(0, .1, 0); inst(geo, mat(pal.rock), by.pebble, (o, d) => o.scale.set(d.s, d.s * .6, d.s * (.8 + d.v * .5))); }
  return g;
}
