// 어둠마녀 쿠키 glb(정적 단일 메시)에 뼈대를 심는다 (SkinnedMesh).
// 뼈: root(고정, 얼굴·망토·머리카락 전부) / boneS(지팡이를 쥔 손, 지팡이는 통째로 이 뼈에 묶음) / boneO(반대쪽 얇은 팔).
// 부위는 삼각형이 아니라 "연결된 표면 조각(차트)" 단위로 고른다: 조각 안 정점의 절반 이상이 지팡이/팔 모양 안에 있으면 그 조각 전체가 뼈를 따라간다.
// 그래서 지팡이가 일부만 움직이거나 얼굴이 따라 움직이는 일이 없다. 다리는 움직이지 않는다.
import * as THREE from 'three';
import { loadGLB } from './glbload.js';

export const DARK_S = 2.4;
// 모델 좌표: 발바닥 y=0, 가운데 x=z=0, 정면 +z, 폭 .9 높이 1.15. 지팡이를 쥔 쪽이 -x(화면 왼쪽).
export const CUT = {
  ornament: { c: [-.30, .92, .14], r: [.32, .34, .22], xMax: -.07 },   // 지팡이 머리 장식(타원체)
  shaft: { a: [-.20, .63, .11], b: [-.13, .10, .05], r: .04 },         // 자루(3D 선분 + 반지름)
  base: { c: [-.144, .15, .05], r: [.12, .07, .05] },                  // 아래 십자 끝(타원체)
  hand: { c: [-.12, .47, .07], r: .09 },                               // 쥔 손(구)
  armO: { c: [.152, .362], r: [.054, .126], z0: .02 },                 // 반대쪽 얇은 팔: xy 타원 + 앞쪽 층
  vote: .5,                                                            // 조각 안 정점이 이 비율 이상 모양 안에 있으면 조각 전체 채택
};
export const PIVOT = { S: [-.12, .47, .07], O: [.152, .49, .06] };      // 어깨(회전축)
const ARM_LEN = .25;                                                      // 얇은 팔 길이(어깨→손끝), 가중치 그라데이션 구간

const ell3 = (p, e) => ((p[0] - e.c[0]) / e.r[0]) ** 2 + ((p[1] - e.c[1]) / e.r[1]) ** 2 + ((p[2] - e.c[2]) / e.r[2]) ** 2 <= 1;
export function inStaff(x, y, z) {
  const C = CUT, P = [x, y, z];
  if ((x < C.ornament.xMax && ell3(P, C.ornament)) || ell3(P, C.base)) return true;
  const A = C.shaft.a, B = C.shaft.b, ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], ap = [x - A[0], y - A[1], z - A[2]];
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  if (Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t) < C.shaft.r) return true;
  return Math.hypot(x - C.hand.c[0], y - C.hand.c[1], z - C.hand.c[2]) < C.hand.r;
}
export function inArmO(x, y, z) {
  const a = CUT.armO; return ((x - a.c[0]) / a.r[0]) ** 2 + ((y - a.c[1]) / a.r[1]) ** 2 <= 1 && z >= a.z0;
}

export function buildSkinGeo(gltfScene) {
  let m; gltfScene.updateMatrixWorld(true); gltfScene.traverse(o => { if (o.isMesh) m = o; });
  const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); g.computeBoundingBox();
  const b = g.boundingBox; g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);   // 발바닥 y=0, 가운데 정렬
  const pos = g.attributes.position, idx = g.index.array, n = pos.count;
  // 연결된 표면 조각(차트)
  const par = new Int32Array(n).map((_, i) => i), find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let i = 0; i < idx.length; i += 3) { const a = find(idx[i]); par[find(idx[i + 1])] = a; par[find(idx[i + 2])] = a; }
  const tot = new Map(), sv = new Map(), ov = new Map();
  for (let v = 0; v < n; v++) {
    const r = find(v), x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    tot.set(r, (tot.get(r) || 0) + 1);
    if (inStaff(x, y, z)) sv.set(r, (sv.get(r) || 0) + 1);
    else if (inArmO(x, y, z)) ov.set(r, (ov.get(r) || 0) + 1);
  }
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), kind = new Uint8Array(n);   // kind 0 몸, 1 지팡이, 2 팔
  const smooth = t => t * t * (3 - 2 * t);
  for (let v = 0; v < n; v++) {
    const r = find(v), T = tot.get(r), s = (sv.get(r) || 0) / T, o = (ov.get(r) || 0) / T;
    let w = 0, bone = 0;
    if (s >= CUT.vote && s >= o) { bone = 1; w = 1; kind[v] = 1; }                                    // 지팡이 조각: 통째로 손 뼈
    else if (o >= CUT.vote) { bone = 2; w = smooth(Math.max(0, Math.min(1, (CUT.armO.c[1] + CUT.armO.r[1] - pos.getY(v)) / ARM_LEN / .5))); kind[v] = 2; }   // 팔: 어깨 쪽은 고정, 손끝으로 갈수록 따라감
    si[v * 4] = 0; si[v * 4 + 1] = bone; sw[v * 4] = 1 - w; sw[v * 4 + 1] = w;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.userData.kind = kind;
  return { geo: g, material: m.material };
}

let cache = null;
export const darkReady = () => cache;
export function preloadDark(url = (typeof window !== 'undefined' && window.__DARK_URL) || 'assets/models/dark.glb') {
  return new Promise(res => loadGLB(url, gl => { try { cache = buildSkinGeo(gl.scene); } catch (e) { console.warn('dark skin failed', e); } res(cache); }, e => { console.warn('dark glb load failed', e); res(null); }));
}

// 디버그: 가중치를 색으로 (몸 회색, 지팡이 노랑, 팔 청록)
export function debugMaterial(geo) {
  const kind = geo.userData.kind, n = kind.length, col = new Float32Array(n * 3), pal = [[.55, .55, .55], [1, 1, 0], [0, 1, 1]];
  for (let v = 0; v < n; v++) col.set(pal[kind[v]], v * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); return new THREE.MeshBasicMaterial({ vertexColors: true });
}

// buildCookie 의 rig 에 뼈대 메시를 끼운다. rig.armR 이 boneS(지팡이 팔), rig.armL 이 boneO(얇은 팔)의 부모라 기존 애니메이션이 그대로 뼈를 움직인다.
export function applyDark(rig, debug = false) {
  const { body, head, torso, legL, legR, armL, armR, hand } = rig;
  body.clear(); [head, legL, legR, armL, armR, torso].forEach(g => g.clear());
  const place = (grp, p) => grp.position.set(p[0] * DARK_S, p[1] * DARK_S, p[2] * DARK_S);
  place(armR, PIVOT.S); place(armL, PIVOT.O);
  head.position.set(0, rig.headY ?? 1.65, 0);           // 머리는 움직이지 않는다(얼굴 고정)
  torso.position.set(0, 1.0, 0);
  const rootB = new THREE.Bone(), boneS = new THREE.Bone(), boneO = new THREE.Bone();
  body.add(rootB); armR.add(boneS); armL.add(boneO);
  body.add(legL, legR, torso, head, armL, armR);
  body.updateMatrixWorld(true);
  const mesh = new THREE.SkinnedMesh(cache.geo, debug ? debugMaterial(cache.geo) : cache.material.clone());
  mesh.scale.setScalar(DARK_S); mesh.castShadow = true; mesh.frustumCulled = false;
  body.add(mesh); mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([rootB, boneS, boneO]));
  armR.add(hand); hand.position.set(0, 0, 0);
  if (rig.weapon) { rig.weapon.visible = false; rig.weapon = null; }   // 지팡이는 메시에 포함
  rig.skinned = mesh;
}
