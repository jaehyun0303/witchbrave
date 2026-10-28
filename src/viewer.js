import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { preloadLich } from './lichglb.js';
import { buildCookie } from './models.js';

const r = new THREE.WebGLRenderer({ antialias: true });
r.setSize(innerWidth, innerHeight);
document.body.appendChild(r.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a93a8);
const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 100);
cam.position.set(0, 1.3, 5.2);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(2, 3, 4); scene.add(d);
const ctl = new OrbitControls(cam, r.domElement);
ctl.target.set(0, 1.1, 0);
const q = new URLSearchParams(location.search), pose = q.get('pose') || 'idle';
let rig;
preloadLich().then(() => {
  rig = buildCookie({ id: 'lich', color: 0xc46bff });
  scene.add(rig.root); window.__rig = rig; window.__done = true;
});
addEventListener('resize', () => { r.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); });
r.setAnimationLoop(t => {
  if (rig) {
    const T = t / 1000;
    if (pose === 'run') { rig.legL.rotation.x = Math.sin(T * 8) * .8; rig.legR.rotation.x = -Math.sin(T * 8) * .8; rig.armL.rotation.x = -Math.sin(T * 8) * .7; rig.armR.rotation.x = Math.sin(T * 8) * .5; }
    if (pose === 'raise') { rig.armR.rotation.set(-3.0, 0, -.2); rig.armL.rotation.set(-2.6, 0, .4); }
    if (pose === 'spin') rig.root.rotation.y = T;
  }
  ctl.update(); r.render(scene, cam);
});
