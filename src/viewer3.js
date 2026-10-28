import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { preloadSugar, sugarReady, NAMES } from './sugarglb.js';
import { buildCookie } from './models.js';
const r = new THREE.WebGLRenderer({ antialias: true }); r.setSize(innerWidth, innerHeight); document.body.appendChild(r.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8a93a8);
const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 100); cam.position.set(0, 1.2, 5.2);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6)); const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(2, 3, 4); scene.add(d);
const ctl = new OrbitControls(cam, r.domElement); ctl.target.set(0, 1.0, 0);
const q = new URLSearchParams(location.search); let rig;
preloadSugar().then(() => {
  rig = buildCookie({ id: 'sugar', color: 0xff8ad0 }); scene.add(rig.root); window.__rig = rig;
  if (q.get('color')) { const cols = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xff8800, 0x000000]; rig.root.traverse(o => { if (o.isMesh) { const n = o.parent; } }); const all = [rig.head, rig.legL, rig.legR, rig.armL, rig.armR, ...(rig.extras.sugarWings || []), rig.extras.sugarTail]; all.forEach((g, i) => g.traverse(o => { if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: [0x888888, 0xff0000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0xff8800][i] }); })); }
});
r.setAnimationLoop(t => { if (rig) { const T = t / 1000; const w = rig.extras.sugarWings; if (q.get('flap') && w) { w[0].rotation.z = Math.sin(T * 6) * .3; w[1].rotation.z = -Math.sin(T * 6) * .3; } } ctl.update(); r.render(scene, cam); });
