import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadGLB } from './glbload.js';
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(innerWidth, innerHeight); document.body.appendChild(r.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8a93a8);
const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 100); cam.position.set(0, 0.5, 2.3);
scene.add(new THREE.AmbientLight(0xffffff, 2));
const ctl = new OrbitControls(cam, r.domElement); ctl.target.set(0, 0.5, 0);
loadGLB('assets/models/dark.glb', gl => {
  let m; gl.scene.updateMatrixWorld(true); gl.scene.traverse(o => { if (o.isMesh) m = o; });
  const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); g.computeBoundingBox(); const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  const idx = g.index.array, n = g.attributes.position.count, par = new Int32Array(n).map((_, i) => i);
  const f = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let i = 0; i < idx.length; i += 3) { const a = f(idx[i]); par[f(idx[i + 1])] = a; par[f(idx[i + 2])] = a; }
  const comp = new Map(); for (let i = 0; i < n; i++) { const rt = f(i); comp.set(rt, (comp.get(rt) || 0) + 1); }
  const col = new Float32Array(n * 3), c = new THREE.Color(), ids = new Map();
  for (let i = 0; i < n; i++) { const rt = f(i); if (!ids.has(rt)) ids.set(rt, ids.size); c.setHSL((ids.get(rt) * 0.618) % 1, 0.85, 0.5); col.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true })));
  window.__info = { verts: n, tris: idx.length / 3, comps: comp.size, top: [...comp.values()].sort((a, b) => b - a).slice(0, 12) };
});
r.setAnimationLoop(() => { ctl.update(); r.render(scene, cam); });
