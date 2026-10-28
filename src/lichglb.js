// 리치드래곤 쿠키 glb(정적 단일 메시)를 부위별로 나눠 buildCookie의 rig에 맞춘다.
// 모델 좌표: 높이 0~0.98, 정면 +z, 캐릭터 오른팔이 +x. 왼팔은 없어서 오른팔을 좌우 반전해서 만든다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export const LICH_S = 2.3;
// 부위 경계 (모델 좌표). viewer 로 색칠해 보며 조정한다.
export const CUT = {
  legY: 0.33, legX0: -0.28, legX1: 0.25, legSplitX: -0.07,
  armX0: 0.09, armX1: 0.22, armY0: 0.34, armY1: 0.50, armZ0: -0.1,
};
export const PIVOT = {
  head: [0, 0.5, 0], legL: [-0.1, 0.3, 0], legR: [0.08, 0.3, 0], armR: [0.1, 0.47, 0],
};

export function classify(cx, cy, cz) {
  if (cy < CUT.legY && cx > CUT.legX0 && cx < CUT.legX1) return cx < CUT.legSplitX ? 'legL' : 'legR';
  if (cx > CUT.armX0 && cx < CUT.armX1 && cy > CUT.armY0 && cy < CUT.armY1 && cz > CUT.armZ0) return 'armR';
  return 'head';
}

function subset(src, idx, mirror) {
  const pos = src.attributes.position, nor = src.attributes.normal, uv = src.attributes.uv;
  const map = new Map(), P = [], N = [], U = [], I = [];
  for (let k = 0; k < idx.length; k++) {
    const v = idx[k]; let j = map.get(v);
    if (j === undefined) {
      j = P.length / 3; map.set(v, j);
      P.push(mirror ? -pos.getX(v) : pos.getX(v), pos.getY(v), pos.getZ(v));
      if (nor) N.push(mirror ? -nor.getX(v) : nor.getX(v), nor.getY(v), nor.getZ(v));
      if (uv) U.push(uv.getX(v), uv.getY(v));
    }
    I.push(j);
  }
  if (mirror) for (let i = 0; i < I.length; i += 3) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I); return g;
}

export function splitLich(gltfScene) {
  let m; gltfScene.updateMatrixWorld(true); gltfScene.traverse(o => { if (o.isMesh) m = o; });
  const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld);
  const pos = g.attributes.position, idx = g.index.array, buckets = { head: [], legL: [], legR: [], armR: [] };
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    buckets[classify(cx, cy, cz)].push(a, b, c);
  }
  const geos = {};
  for (const k of ['head', 'legL', 'legR', 'armR']) geos[k] = subset(g, buckets[k], false);
  geos.armL = subset(g, buckets.armR, true);
  return { geos, material: m.material };
}

let cache = null;
export function lichReady() { return cache; }
export function preloadLich(url = (typeof window !== 'undefined' && window.__LICH_URL) || 'assets/models/lich.glb') {
  return new Promise(res => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(url, gl => { try { cache = splitLich(gl.scene); } catch (e) { console.warn('lich split failed', e); } res(cache); }, undefined, e => { console.warn('lich glb load failed', e); res(null); }));
}

// buildCookie 가 쓰는 부위 mesh 를 만든다: 피벗 그룹 + 안쪽 mesh.
export function partGroup(name, pivot, mirrorX = false) {
  const { geos, material } = cache;
  const mat = material.clone();
  const mesh = new THREE.Mesh(geos[name], mat); mesh.castShadow = true;
  const p = new THREE.Vector3(...pivot); if (mirrorX) p.x = -p.x;
  mesh.scale.setScalar(LICH_S); mesh.position.copy(p).multiplyScalar(-LICH_S);
  const g = new THREE.Group(); g.position.copy(p).multiplyScalar(LICH_S); g.add(mesh); return g;
}

// 절차적 rig 의 몸을 glb 부위로 교체한다 (rig 구조·이름은 그대로).
export function applyLich(rig) {
  const { body, head, torso, legL, legR, armL, armR, hand } = rig;
  const mk = (grp, name, pivot, mirror) => { const pg = partGroup(name, pivot, mirror); grp.clear(); grp.position.copy(pg.position); grp.add(...pg.children); };
  body.clear();
  mk(head, 'head', PIVOT.head); mk(legL, 'legL', PIVOT.legL); mk(legR, 'legR', PIVOT.legR);
  mk(armR, 'armR', PIVOT.armR); mk(armL, 'armL', PIVOT.armR, true);
  torso.clear(); torso.position.set(0, 1.0, 0);
  armR.add(hand); hand.position.set(0.08 * LICH_S, -0.04 * LICH_S, 0.05 * LICH_S);
  if (axeGeo) { hand.remove(rig.weapon); rig.weapon = makeAxe(); hand.add(rig.weapon); }
  else if (rig.weapon) rig.weapon.scale.setScalar(0.6);
  body.add(legL, legR, torso, head, armL, armR);
  rig.headY = head.position.y;
}

// 큐트 도끼 glb: 자루 끝(아래)을 손 피벗에 두고 도끼날이 -y 로 향하게 뒤집는다 (절차적 도끼와 같은 방향).
let axeGeo = null, axeMat = null;
export function preloadAxe(url = (typeof window !== 'undefined' && window.__AXE_URL) || 'assets/models/axe.glb') {
  return new Promise(res => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(url, gl => {
    try {
      let m; gl.scene.updateMatrixWorld(true); gl.scene.traverse(o => { if (o.isMesh) m = o; });
      const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); g.computeBoundingBox();
      const b = g.boundingBox; g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); g.rotateZ(Math.PI);
      axeGeo = g; axeMat = m.material;
    } catch (e) { console.warn('axe failed', e); }
    res(axeGeo);
  }, undefined, e => { console.warn('axe load failed', e); res(null); }));
}
export function makeAxe() {
  const mesh = new THREE.Mesh(axeGeo, axeMat.clone()); mesh.castShadow = true; mesh.scale.setScalar(1.25);
  const g = new THREE.Group(); g.add(mesh); return g;
}
