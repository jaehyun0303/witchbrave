// 리깅된 리치드래곤(변신) glb. Tripo 자동 리깅(78본)이라 본 이름으로 날개/다리/머리를 직접 돌린다.
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadGLB } from './glbload.js';

export const DRAGON_S = 7;
let cache = null;
export const dragonReady = () => cache;
export function preloadDragon(url = (typeof window !== 'undefined' && window.__DRAGON_URL) || 'assets/models/lich-rig.glb') {
  return new Promise(res => loadGLB(url, gl => { cache = gl.scene; res(cache); }, e => { console.warn('dragon glb load failed', e); res(null); }));
}

export function buildDragonGLB() {
  const root = new THREE.Group(), model = clone(cache), bones = {}, rest = {};
  model.scale.setScalar(DRAGON_S); root.add(model);
  model.traverse(o => {
    if (o.isBone) { bones[o.name] = o; rest[o.name] = o.quaternion.clone(); }
    if (o.isMesh) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0x4a2480); o.material.emissiveIntensity = .55; o.castShadow = true; o.frustumCulled = false; }
  });
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model); model.position.y = -box.min.y; model.userData.y0 = model.position.y;
  return { root, body: model, glb: true, bones, rest, head: bones.Head || model };
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler();
export function poseBone(D, name, x, y, z) {
  const b = D.bones[name]; if (!b) return;
  b.quaternion.copy(D.rest[name]).multiply(_q.setFromEuler(_e.set(x, y, z)));
}
