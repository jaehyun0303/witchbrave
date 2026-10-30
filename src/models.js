// 절차적(코드 생성) 3D 모델. 나중에 glTF 모델로 교체할 때는 같은 rig 구조만 맞추면 된다.
import * as THREE from 'three';
import { tex } from './tex.js';
import { lichReady, applyLich } from './lichglb.js';
import { sugarReady, applySugar } from './sugarglb.js';
import { dragonReady, buildDragonGLB } from './dragonglb.js';
import { darkReady, applyDark } from './darkglb.js';

const M = (color, o = {}) => new THREE.MeshStandardMaterial({
  color, roughness: o.r ?? .55, metalness: o.m ?? 0, emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1, flatShading: o.flat ?? false,
  transparent: o.t ?? false, opacity: o.op ?? 1, side: o.side ?? THREE.FrontSide,
});
const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; };
const sph = (r, mat, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = mesh(new THREE.SphereGeometry(r, 24, 16), mat, x, y, z); m.scale.set(sx, sy, sz); return m; };
const cyl = (r0, r1, h, mat, x, y, z, seg = 16) => mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat, x, y, z);
const cone = (r, h, mat, x, y, z, seg = 16) => mesh(new THREE.ConeGeometry(r, h, seg), mat, x, y, z);
const box = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
const grp = (x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); return g; };

function heartShape() {
  const s = new THREE.Shape(); s.moveTo(0, -.5);
  s.bezierCurveTo(-.9, .1, -.5, .75, 0, .35); s.bezierCurveTo(.5, .75, .9, .1, 0, -.5);
  return s;
}
export function heartMesh(mat, size = 1) {
  const g = new THREE.ExtrudeGeometry(heartShape(), { depth: .25, bevelEnabled: true, bevelSize: .06, bevelThickness: .06, bevelSegments: 3 });
  g.center(); const m = new THREE.Mesh(g, mat); m.scale.setScalar(size); return m;
}

/* ================= 쿠키 (일반 형태) ================= */
export function buildCookie(def) {
  const id = def.id, col = new THREE.Color(def.color);
  const P = {
    silent: { skin: 0xf1ebe0, hair: 0xf6f8ff, eye: 0x9fc0ff, cloth: 0x34447f, trim: 0xcfd8ff },
    lich: { skin: 0xd9a8f0, hair: 0x2a1442, eye: 0xff5fd0, cloth: 0x6a2f9a, trim: 0xe9b5ff },
  }[id] || { skin: col.clone().lerp(new THREE.Color(0xffffff), .35).getHex(), hair: col.clone().multiplyScalar(.5).getHex(), eye: 0xffffff, cloth: col.clone().multiplyScalar(.45).getHex(), trim: def.color };
  const root = grp(), body = grp(); root.add(body);
  const skin = M(P.skin), hair = M(P.hair, { r: .7 }), cloth = M(P.cloth, { r: .8 }), trim = M(P.trim, { e: P.trim, ei: .5, m: .3 });
  const eyeM = M(P.eye, { e: P.eye, ei: 1.4 }), dark = M(0x15101f);

  // 다리
  const legL = grp(-.2, .6, 0), legR = grp(.2, .6, 0);
  for (const l of [legL, legR]) { l.add(cyl(.12, .13, .5, cloth, 0, -.25, 0), sph(.16, dark, 0, -.52, .05, 1, .7, 1.3)); body.add(l); }
  // 몸통
  const torso = grp(0, .95, 0); body.add(torso);
  torso.add(sph(.4, cloth, 0, 0, 0, 1, 1.1, .85), sph(.42, trim, 0, -.28, 0, 1, .14, .9));
  // 머리
  const head = grp(0, 1.65, 0); body.add(head);
  head.add(sph(.64, skin, 0, 0, 0, 1.05, .93, 1));
  for (const s of [-1, 1]) {
    head.add(sph(.075, eyeM, s * .22, .02, .6, 1, 1.3, .7));
    head.add(sph(.06, new THREE.MeshBasicMaterial({ color: 0xffffff }), s * .24, .06, .66));
    head.add(sph(.07, M(0xff9ab0, { t: true, op: .45 }), s * .36, -.14, .5, 1.4, .8, .5));
  }
  head.add(sph(.05, dark, 0, -.17, .62, 1.6, .5, .6));
  // 팔
  const mkArm = s => { const a = grp(s * .46, 1.18, 0); a.add(cyl(.09, .09, .46, skin, 0, -.23, 0), sph(.12, skin, 0, -.5, 0)); body.add(a); return a; };
  const armL = mkArm(-1), armR = mkArm(1);
  const hand = grp(0, -.5, 0); armR.add(hand);
  const rig = { root, body, head, torso, legL, legR, armL, armR, hand, weapon: null, extras: {} };

  if (id === 'silent') {
    head.add(sph(.68, hair, 0, .1, -.05, 1.05, .9, 1.02)); // 은발
    for (const s of [-1, 1]) head.add(cone(.16, .5, hair, s * .5, .1, .15, 8)).rotation;
    body.add(cone(.62, 1.3, cloth, 0, .55, -.2, 20)); // 롱코트 자락
    torso.add(sph(.2, trim, 0, .45, .3, 1, .5, .5));
    // 달빛 후광
    const halo = new THREE.Mesh(new THREE.TorusGeometry(.5, .025, 8, 40), new THREE.MeshBasicMaterial({ color: 0xcfe0ff }));
    halo.position.set(0, .95, -.3); halo.rotation.x = .3; head.add(halo); rig.extras.halo = halo;
    // 검
    const sw = grp(); const bladeM = M(0xe8f0ff, { e: 0x8fb4ff, ei: 1.6, m: .6, r: .2 });
    sw.add(box(.14, 1.9, .035, bladeM, 0, -1.0, 0), box(.5, .09, .1, trim, 0, -.1, 0), cyl(.04, .04, .35, dark, 0, .12, 0));
    const tip = cone(.07, .3, bladeM, 0, -2.08, 0, 4); tip.rotation.x = Math.PI; sw.add(tip);
    sw.rotation.x = -1.0; hand.add(sw); rig.weapon = sw; rig.extras.bladeM = bladeM;
    // 떠도는 소금 결정
    rig.extras.crystals = []; for (let i = 0; i < 4; i++) { const c = mesh(new THREE.OctahedronGeometry(.1), M(0xdfe8ff, { e: 0x9fb8ff, ei: 1.2 }), 0, 0, 0); c.userData.a = i / 4 * 6.283; body.add(c); rig.extras.crystals.push(c); }
  } else if (id === 'lich') {
    head.add(sph(.67, hair, 0, .12, -.06, 1.05, .88, 1.0));
    for (const s of [-1, 1]) { // 뿔
      const h = cone(.1, .55, M(0xf3e9d8, { r: .4 }), s * .42, .62, 0, 10); h.rotation.z = -s * .45; head.add(h);
    }
    const crown = grp(0, .68, .05); const gold = M(0xffcf5a, { e: 0xffa020, ei: .6, m: .8, r: .3 });
    crown.add(new THREE.Mesh(new THREE.TorusGeometry(.3, .04, 8, 24), gold)); crown.children[0].rotation.x = Math.PI / 2;
    for (let i = 0; i < 5; i++) { const a = i / 5 * 6.283, t = cone(.05, .2, gold, Math.cos(a) * .3, .1, Math.sin(a) * .3, 6); crown.add(t); }
    head.add(crown);
    body.add(cone(.55, 1.1, cloth, 0, .55, -.2, 20));
    const wing = M(0x6a2a9a, { e: 0x8a2be2, ei: .6, t: true, op: .85, side: THREE.DoubleSide });
    for (const s of [-1, 1]) { const w = mesh(new THREE.ConeGeometry(.35, 1.0, 3), wing, s * .5, 1.1, -.4); w.rotation.set(.2, 0, s * 1.0); body.add(w); rig.extras['wing' + s] = w; }
    // 큐트 도끼
    const ax = grp(); const shaft = M(0x3a1d52, { r: .5 }), blade = M(0xff7ae0, { e: 0xff3fc8, ei: 1.5, m: .5, r: .25 });
    ax.add(cyl(.045, .045, 1.5, shaft, 0, -.6, 0));
    for (const s of [-1, 1]) { const b = heartMesh(blade, .5); b.scale.set(.5, .5, .2); b.position.set(s * .32, -1.25, 0); b.rotation.z = s * 1.5; ax.add(b); }
    ax.rotation.x = -1.0; hand.add(ax); rig.weapon = ax;
  } else {
    // 임시 캐릭터 액세서리
    head.add(sph(.67, hair, 0, .12, -.06, 1.05, .88, 1.0));
    if (id === 'dark') { const hat = grp(0, .66, 0); hat.add(cone(.42, .9, cloth, 0, .45, 0, 16), cyl(.8, .8, .06, cloth, 0, 0, 0, 24)); hat.rotation.z = .12; head.add(hat); }
    if (id === 'shadow') { for (const s of [-1, 1]) { const h = cone(.12, .6, M(0xe8e0ff), s * .4, .62, 0, 8); h.rotation.z = -s * .35; head.add(h); } }
    if (id === 'sugar') { const h = new THREE.Mesh(new THREE.TorusGeometry(.4, .04, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffe0f2 })); h.position.y = .95; h.rotation.x = Math.PI / 2; head.add(h); }
    const wp = grp(); wp.add(cyl(.04, .04, 1.4, M(0x333344), 0, -.5, 0), sph(.2, M(def.color, { e: def.color, ei: 1.4 }), 0, -1.25, 0)); wp.rotation.x = -1.0; hand.add(wp); rig.weapon = wp;
  }
  if (id === 'lich' && lichReady()) { applyLich(rig); delete rig.extras['wing-1']; delete rig.extras['wing1']; }
  if (id === 'sugar' && sugarReady()) applySugar(rig);
  if (id === 'dark' && darkReady()) applyDark(rig);
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return rig;
}

/* ================= 리치드래곤 (뼈 용) ================= */
export function buildDragon() {
  if (dragonReady()) return buildDragonGLB();
  const root = grp(), body = grp(); root.add(body); const S = 2.2; body.scale.setScalar(S);
  const bone = M(0xe9e2d0, { r: .6 }), boneD = M(0xb9b09a, { r: .7 }), purple = M(0x7a2bd0, { e: 0xa040ff, ei: 1.6 }), flame = new THREE.MeshBasicMaterial({ color: 0xd066ff });
  const spine = grp(0, 1.0, 0); body.add(spine);
  // 갈비뼈
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(.42 - Math.abs(i - 2) * .04, .035, 6, 14, Math.PI * .9), bone);
    r.position.set(0, 0, .6 - i * .24); r.rotation.set(0, 0, s > 0 ? -.2 : Math.PI + .2 - Math.PI * .9 + .2); r.rotation.z = s > 0 ? -.35 : Math.PI - Math.PI * .9 + .35; spine.add(r);
  }
  const core = sph(.28, purple, 0, .05, .1, 1, 1, 2); spine.add(core);
  spine.add(sph(.3, boneD, 0, .38, 0, .9, .35, 3.4));
  // 목 + 머리
  const neck = grp(0, .35, .75); spine.add(neck);
  let prev = neck; const segs = [];
  for (let i = 0; i < 4; i++) { const g = grp(0, .1, .22); g.add(sph(.15 - i * .01, bone, 0, 0, 0)); prev.add(g); segs.push(g); prev = g; }
  const head = grp(0, .08, .3); prev.add(head);
  head.add(box(.34, .26, .5, bone, 0, 0, .15), box(.26, .18, .22, boneD, 0, -.02, .5));
  const jaw = grp(0, -.14, .05); jaw.add(box(.28, .08, .5, boneD, 0, 0, .3)); head.add(jaw);
  for (const s of [-1, 1]) {
    head.add(sph(.065, flame, s * .12, .06, .3));
    const h = cone(.06, .55, bone, s * .15, .2, -.05, 8); h.rotation.set(-.9, 0, -s * .35); head.add(h);
  }
  // 날개
  const wings = [];
  for (const s of [-1, 1]) {
    const w = grp(s * .25, .35, .35); spine.add(w);
    const arm = box(.05, .05, 1.5, bone, s * .75, 0, 0); arm.rotation.y = s * .1; w.add(arm);
    for (let i = 0; i < 4; i++) { const f = box(.035, .035, 1.5 - i * .15, boneD, s * (.2 + i * .3), 0, -.3 - i * .15); f.rotation.y = s * (.15 + i * .1); w.add(f); }
    const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(1.5, .1); shape.lineTo(1.25, -.7); shape.lineTo(.8, -.45); shape.lineTo(.4, -.9); shape.lineTo(0, -.4);
    const mem = new THREE.Mesh(new THREE.ShapeGeometry(shape), M(0x5a1a9a, { e: 0x7a2bd0, ei: .7, t: true, op: .6, side: THREE.DoubleSide }));
    mem.rotation.x = -Math.PI / 2; mem.scale.set(s, 1, 1); mem.position.y = 0; w.add(mem);
    wings.push({ g: w, s });
  }
  // 꼬리
  const tail = grp(0, 0, -.7); spine.add(tail); let tp = tail; const tailSegs = [];
  for (let i = 0; i < 9; i++) { const g = grp(0, 0, -.2); g.add(sph(.13 - i * .011, i % 2 ? bone : boneD, 0, 0, 0), cone(.03, .12, bone, 0, .12 - i * .01, 0, 6)); tp.add(g); tailSegs.push(g); tp = g; }
  // 다리
  const legs = [];
  for (const [z, s] of [[.35, -1], [.35, 1], [-.35, -1], [-.35, 1]]) { const l = grp(s * .32, -.05, z); l.add(cyl(.07, .05, .7, bone, 0, -.35, 0), sph(.1, boneD, 0, -.72, .06, 1, .6, 1.5)); spine.add(l); legs.push(l); }
  body.position.y = .0; spine.position.y = 1.0;
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { root, body, spine, neck, segs, head, jaw, wings, tail, tailSegs, legs, core };
}

/* ================= 달 (컷신) ================= */
export function buildMoon(R = 18) {
  const group = grp(), tilt = grp(); group.add(tilt);
  const mat = () => new THREE.MeshBasicMaterial({ map: tex('moon'), color: 0xfff6dc });
  const cap = () => new THREE.MeshBasicMaterial({ color: 0xfff0b0, side: THREE.DoubleSide });
  const halves = [];
  for (const s of [-1, 1]) {
    const h = grp();
    const geo = new THREE.SphereGeometry(R, 64, 40, s < 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI);
    h.add(new THREE.Mesh(geo, mat()));
    const c = new THREE.Mesh(new THREE.CircleGeometry(R * .999, 48), cap()); c.rotation.y = Math.PI / 2; h.add(c);
    tilt.add(h); halves.push(h);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex('glow'), color: 0xcfd8ff, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(R * 5); group.add(glow);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  line.position.z = R + .5; line.scale.set(.5, 0.01, 1); tilt.add(line);
  tilt.rotation.z = -.62;
  return { group, tilt, halves, glow, line, R };
}

/* ================= 맵 소품 ================= */
export function buildCrystal() {
  const g = grp(); const m = M(0x7a6aff, { e: 0x5a46ff, ei: 1.1, flat: true, r: .2, t: true, op: .92 });
  const c = mesh(new THREE.OctahedronGeometry(.9), m, 0, 1.6, 0); c.scale.set(.8, 1.7, .8); g.add(c);
  g.add(cyl(1, 1.2, .35, M(0x4a3f8a), 0, .17, 0, 8));
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.35, 32), new THREE.MeshBasicMaterial({ color: 0x8f7bff, transparent: true, opacity: .6, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .06; g.add(ring);
  g.userData = { crystal: c, ring, mat: m };
  return g;
}
