// 이터널슈가 쿠키 glb(정적 단일 메시)를 부위별로 나눠 buildCookie 의 rig 에 맞춘다.
// 모델 좌표: 높이 0~0.87, 정면 +z. 좌우 대칭이라 x<0 을 L, x>0 을 R 로 둔다.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

export const SUGAR_S = 2.4;
export const CUT = { wingX: 0.22, tailY: 0.2, tailX0: -0.14, tailX1: -0.025, tailZ: 9, legY: 0.28, legX: 0.1, armX0: 0.04, armX1: 0.13, armY0: 0.29, armY1: 0.42, armZ0: 0.0 };
export const PIVOT = {
  head: [0, 0.45, 0], legL: [-0.05, 0.28, 0], legR: [0.05, 0.28, 0], armL: [-0.1, 0.48, 0.05], armR: [0.1, 0.48, 0.05],
  wingL: [-0.2, 0.5, -0.05], wingR: [0.2, 0.5, -0.05], tail: [-0.05, 0.2, -0.03],
};
export const NAMES = ['head', 'legL', 'legR', 'armL', 'armR', 'wingL', 'wingR', 'tail'];

export function classify(x, y, z) {
  if (Math.abs(x) > CUT.wingX) return x < 0 ? 'wingL' : 'wingR';
  if (y < CUT.tailY && x > CUT.tailX0 && x < CUT.tailX1 && z < CUT.tailZ) return 'tail';
  if (y < CUT.legY && Math.abs(x) < CUT.legX) return x < 0 ? 'legL' : 'legR';
  if (y > CUT.armY0 && y < CUT.armY1 && z > CUT.armZ0 && Math.abs(x) > CUT.armX0 && Math.abs(x) < CUT.armX1) return x < 0 ? 'armL' : 'armR';
  return 'head';
}

function subset(src, idx) {
  const pos = src.attributes.position, nor = src.attributes.normal, uv = src.attributes.uv;
  const map = new Map(), P = [], N = [], U = [], I = [];
  for (let k = 0; k < idx.length; k++) {
    const v = idx[k]; let j = map.get(v);
    if (j === undefined) { j = P.length / 3; map.set(v, j); P.push(pos.getX(v), pos.getY(v), pos.getZ(v)); if (nor) N.push(nor.getX(v), nor.getY(v), nor.getZ(v)); if (uv) U.push(uv.getX(v), uv.getY(v)); }
    I.push(j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  if (nor) g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  g.setIndex(I); return g;
}

export function splitSugar(gltfScene) {
  let m; gltfScene.updateMatrixWorld(true); gltfScene.traverse(o => { if (o.isMesh) m = o; });
  const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld);
  const pos = g.attributes.position, idx = g.index.array, B = {}; NAMES.forEach(n => B[n] = []);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    B[classify((pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3, (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3)].push(a, b, c);
  }
  const geos = {}; for (const n of NAMES) geos[n] = subset(g, B[n]);
  return { geos, material: m.material };
}

let cache = null;
export const sugarReady = () => cache;
export function preloadSugar(url = (typeof window !== 'undefined' && window.__SUGAR_URL) || 'assets/models/sugar.glb') {
  return new Promise(res => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(url, gl => { try { cache = splitSugar(gl.scene); } catch (e) { console.warn('sugar split failed', e); } res(cache); }, undefined, e => { console.warn('sugar glb load failed', e); res(null); }));
}

function partGroup(name) {
  const mesh = new THREE.Mesh(cache.geos[name], cache.material.clone()); mesh.castShadow = true;
  const p = new THREE.Vector3(...PIVOT[name]);
  mesh.scale.setScalar(SUGAR_S); mesh.position.copy(p).multiplyScalar(-SUGAR_S);
  const g = new THREE.Group(); g.position.copy(p).multiplyScalar(SUGAR_S); g.add(mesh); return g;
}

export function applySugar(rig) {
  const { body, head, torso, legL, legR, armL, armR, hand } = rig;
  const mk = (grp, name) => { const pg = partGroup(name); grp.clear(); grp.position.copy(pg.position); grp.add(...pg.children); };
  body.clear();
  mk(head, 'head'); mk(legL, 'legL'); mk(legR, 'legR'); mk(armL, 'armL'); mk(armR, 'armR');
  torso.clear(); torso.position.set(0, 1.0, 0);
  armR.add(hand); hand.position.set(0.02 * SUGAR_S, -0.12 * SUGAR_S, 0.08 * SUGAR_S);
  if (rig.weapon) rig.weapon.visible = false; // 무기 모델이 오면 교체
  const wingL = partGroup('wingL'), wingR = partGroup('wingR'), tail = partGroup('tail');
  body.add(legL, legR, torso, head, armL, armR, wingL, wingR, tail);
  rig.extras.sugarWings = [wingL, wingR]; rig.extras.sugarTail = tail;
  rig.headY = head.position.y;
}
