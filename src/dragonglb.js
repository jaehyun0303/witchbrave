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

// 리치드래곤 모델의 '머리만' 떼어낸 스킨드 메시 (꿈·안개·종말의 하늘 등에서 거대한 머리로 쓴다).
// 한 덩어리 스킨드 메시라서, 가장 영향력이 큰 뼈가 Head/눈 뼈인 정점의 삼각형만 남긴 새 지오메트리로 바꿔 끼운다.
let headCache = null;
function headGeo(src) {
  if (headCache) return headCache;
  const g = src.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, bones = src.skeleton.bones, ok = new Set();
  bones.forEach((b, i) => { if (/^(Head|R_Eye|L_Eye|Jaw|Tongue|Teeth)/i.test(b.name)) ok.add(i); });
  const dom = new Uint8Array(si.count);
  for (let v = 0; v < si.count; v++) { let best = 0, bw = -1; for (let k = 0; k < 4; k++) { const w = sw.getComponent(v, k); if (w > bw) { bw = w; best = si.getComponent(v, k); } } dom[v] = ok.has(best) ? 1 : 0; }
  const idx = g.index, keep = []; for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2); if (dom[a] && dom[b] && dom[c]) keep.push(a, b, c); }
  const ng = new THREE.BufferGeometry(); for (const k in g.attributes) ng.setAttribute(k, g.attributes[k]); ng.setIndex(keep);
  headCache = { geo: ng, n: keep.length / 3 }; return headCache;
}
export function buildDragonHead() {
  if (!cache) return null;
  const model = clone(cache); let sm = null; model.traverse(o => { if (o.isSkinnedMesh && !sm) sm = o; }); if (!sm) return null;
  const h = headGeo(sm); if (h.n < 200) return null;
  sm.geometry = h.geo; sm.material = sm.material.clone(); sm.material.emissive = new THREE.Color(0x6a28b0); sm.material.emissiveIntensity = .7; sm.frustumCulled = false; sm.castShadow = false;
  model.updateMatrixWorld(true);
  const pos = h.geo.attributes.position, v = new THREE.Vector3(), box = new THREE.Box3(); const used = new Set(h.geo.index.array);
  for (const i of used) { v.fromBufferAttribute(pos, i).applyMatrix4(sm.matrixWorld); box.expandByPoint(v); }
  const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3()), root = new THREE.Group(); model.position.sub(c); root.add(model);
  root.userData.size = Math.max(s.x, s.y, s.z); return root;
}
