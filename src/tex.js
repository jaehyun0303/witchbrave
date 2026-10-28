// VFX 텍스처. 기본은 코드로 생성한 임시 텍스처이고,
// www/assets/vfx/manifest.json 에 이름을 적어두면 같은 이름의 PNG 로 자동 교체된다.
import * as THREE from 'three';

const cache = {};
const manifest = new Set();
let manifestLoaded = false;

function make(size, draw, w = size, h = size) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  draw(x, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const rg = (x, cx, cy, r0, r1, stops) => {
  const g = x.createRadialGradient(cx, cy, r0, cx, cy, r1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
};
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

const GEN = {
  glow: () => make(128, (x, s) => {
    x.fillStyle = rg(x, s / 2, s / 2, 0, s / 2, [[0, 'rgba(255,255,255,1)'], [.2, 'rgba(255,255,255,.7)'], [.5, 'rgba(255,255,255,.18)'], [1, 'rgba(255,255,255,0)']]);
    x.fillRect(0, 0, s, s);
  }),
  spark: () => make(128, (x, s) => {
    const c = s / 2;
    x.fillStyle = rg(x, c, c, 0, c, [[0, 'rgba(255,255,255,1)'], [.15, 'rgba(255,255,255,.5)'], [1, 'rgba(255,255,255,0)']]);
    x.fillRect(0, 0, s, s);
    x.globalCompositeOperation = 'lighter';
    for (const [w, h] of [[s, 5], [5, s]]) {
      const g = x.createLinearGradient(c - w / 2, c - h / 2, c + w / 2, c + h / 2);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(c - w / 2, c - h / 2, w, h);
    }
  }),
  ring: () => make(256, (x, s) => {
    x.fillStyle = rg(x, s / 2, s / 2, 0, s / 2, [[0, 'rgba(255,255,255,0)'], [.72, 'rgba(255,255,255,0)'], [.88, 'rgba(255,255,255,1)'], [.94, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]);
    x.fillRect(0, 0, s, s);
  }),
  // 초승달 모양 검기 (가로로 긴 형태, 위로 볼록)
  slash: () => make(256, (x, w, h) => {
    x.clearRect(0, 0, w, h);
    const g = x.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.35, 'rgba(255,255,255,.9)'); g.addColorStop(.5, 'rgba(255,255,255,1)'); g.addColorStop(.65, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    for (const [blur, a] of [[28, .6], [12, .9], [0, 1]]) {
      x.save(); x.shadowColor = 'rgba(255,255,255,' + a + ')'; x.shadowBlur = blur; x.fillStyle = g;
      x.beginPath(); x.moveTo(6, h * .72);
      x.quadraticCurveTo(w / 2, -h * .25, w - 6, h * .72);
      x.quadraticCurveTo(w / 2, h * .22, 6, h * .72);
      x.fill(); x.restore();
    }
  }, 256, 256),
  heart: () => make(128, (x, s) => {
    const p = () => {
      x.beginPath(); x.moveTo(s / 2, s * .82);
      x.bezierCurveTo(s * .05, s * .52, s * .12, s * .12, s * .38, s * .2);
      x.bezierCurveTo(s * .46, s * .23, s * .5, s * .3, s / 2, s * .34);
      x.bezierCurveTo(s * .5, s * .3, s * .54, s * .23, s * .62, s * .2);
      x.bezierCurveTo(s * .88, s * .12, s * .95, s * .52, s / 2, s * .82); x.closePath();
    };
    x.shadowColor = 'white'; x.shadowBlur = 14; x.fillStyle = 'rgba(255,255,255,.85)'; p(); x.fill();
    x.shadowBlur = 0; x.fillStyle = 'white'; x.save(); x.translate(s / 2, s * .52); x.scale(.72, .72); x.translate(-s / 2, -s * .52); p(); x.fill(); x.restore();
  }),
  rune: () => make(512, (x, s) => {
    const c = s / 2; x.translate(c, c); x.strokeStyle = 'white'; x.fillStyle = 'white'; x.lineCap = 'round';
    const circ = (r, w) => { x.lineWidth = w; x.beginPath(); x.arc(0, 0, r, 0, 7); x.stroke(); };
    x.shadowColor = 'white'; x.shadowBlur = 10;
    circ(c * .97, 5); circ(c * .9, 2); circ(c * .62, 3); circ(c * .38, 2);
    for (let i = 0; i < 72; i++) { const a = i / 72 * 6.283, l = i % 6 ? 8 : 18; x.lineWidth = 2; x.beginPath(); x.moveTo(Math.cos(a) * c * .9, Math.sin(a) * c * .9); x.lineTo(Math.cos(a) * (c * .9 - l), Math.sin(a) * (c * .9 - l)); x.stroke(); }
    const poly = (n, step, r, w) => { x.lineWidth = w; x.beginPath(); for (let i = 0; i <= n; i++) { const a = i * step / n * 6.283 - 1.5708; const px = Math.cos(a) * r, py = Math.sin(a) * r; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); };
    poly(8, 3, c * .62, 3); poly(6, 2, c * .62, 2); poly(5, 2, c * .38, 2); poly(3, 1, c * .38, 2);
    for (let i = 0; i < 8; i++) { const a = i / 8 * 6.283; x.save(); x.rotate(a); x.translate(c * .76, 0); x.lineWidth = 3; x.beginPath(); x.moveTo(-12, -14); x.lineTo(12, 0); x.lineTo(-12, 14); x.closePath(); x.stroke(); x.fillRect(-4, -4, 8, 8); x.restore(); }
    x.globalAlpha = .9; x.beginPath(); x.arc(0, 0, 8, 0, 7); x.fill();
  }),
  // 세로 광선(기둥)용: 아래가 진하고 위로 갈수록 옅음, 좌우는 부드럽게
  beam: () => make(128, (x, w, h) => {
    const img = x.createImageData(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const u = Math.abs(i / w - .5) * 2, v = j / h;
      const edge = Math.pow(1 - u, 1.6), core = Math.exp(-u * u * 6);
      const a = Math.min(1, (edge * .5 + core * .9)) * Math.pow(v, .6) * (v < .985 ? 1 : 0);
      const k = (j * w + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = a * 255;
    }
    x.putImageData(img, 0, 0);
  }, 128, 256),
  smoke: () => make(128, (x, s) => {
    for (let i = 0; i < 18; i++) {
      const px = s / 2 + (rand() - .5) * s * .4, py = s / 2 + (rand() - .5) * s * .4, r = s * (.12 + rand() * .2);
      x.fillStyle = rg(x, px, py, 0, r, [[0, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]); x.fillRect(0, 0, s, s);
    }
  }),
  crack: () => make(512, (x, s) => {
    const c = s / 2; x.translate(c, c); x.strokeStyle = 'white'; x.shadowColor = 'white'; x.shadowBlur = 8; x.lineCap = 'round';
    const branch = (px, py, a, len, w, d) => {
      if (len < 10 || d > 4) return; const nx = px + Math.cos(a) * len, ny = py + Math.sin(a) * len;
      x.lineWidth = w; x.beginPath(); x.moveTo(px, py); x.lineTo(nx, ny); x.stroke();
      branch(nx, ny, a + (rand() - .5) * .6, len * .72, w * .7, d + 1);
      if (rand() < .6) branch(nx, ny, a + (rand() - .5) * 1.6, len * .55, w * .6, d + 1);
    };
    for (let i = 0; i < 11; i++) branch(0, 0, i / 11 * 6.283 + rand() * .4, c * .3, 5, 0);
    x.fillStyle = rg(x, 0, 0, 0, c * .5, [[0, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']]); x.fillRect(-c, -c, s, s);
  }),
  moon: () => make(512, (x, w, h) => {
    x.fillStyle = '#e9e2c4'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      const px = rand() * w, py = rand() * h, r = 4 + rand() * rand() * 70;
      x.fillStyle = rg(x, px, py, 0, r, [[0, 'rgba(120,110,80,.38)'], [.8, 'rgba(150,140,105,.2)'], [1, 'rgba(255,250,220,.0)']]); x.fillRect(px - r, py - r, r * 2, r * 2);
      x.strokeStyle = 'rgba(255,252,230,.35)'; x.lineWidth = 2; x.beginPath(); x.arc(px, py, r * .9, 0, 7); x.stroke();
    }
  }, 1024, 512),
  floor: () => make(1024, (x, s) => {
    x.fillStyle = '#141029'; x.fillRect(0, 0, s, s);
    const n = 16, t = s / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = 20 + rand() * 14; x.fillStyle = `rgb(${v},${v - 3},${v + 22})`; x.fillRect(i * t + 2, j * t + 2, t - 4, t - 4);
    }
    x.strokeStyle = 'rgba(120,100,255,.35)'; x.lineWidth = 2;
    for (let i = 0; i <= n; i++) { x.beginPath(); x.moveTo(i * t, 0); x.lineTo(i * t, s); x.stroke(); x.beginPath(); x.moveTo(0, i * t); x.lineTo(s, i * t); x.stroke(); }
  }),
};

export const hasOverride = n => manifest.has(n);

export function tex(name) {
  if (cache[name]) return cache[name];
  const t = GEN[name] ? GEN[name]() : GEN.glow();
  cache[name] = t;
  if (manifest.has(name)) loadOverride(name);
  return t;
}
function loadOverride(name) {
  const img = new Image();
  img.onload = () => { const t = cache[name]; if (t) { t.image = img; t.needsUpdate = true; } };
  img.src = 'assets/vfx/' + name + '.png';
}
// 서버로 실행했을 때만 동작 (file:// 이면 조용히 무시)
export function loadManifest() {
  if (manifestLoaded || location.protocol === 'file:') return; manifestLoaded = true;
  try {
    fetch('assets/vfx/manifest.json').then(r => r.ok ? r.json() : []).then(list => {
      (list || []).forEach(n => { manifest.add(n); if (cache[n]) loadOverride(n); });
    }).catch(() => {});
  } catch (e) {}
}
export const TEX_NAMES = Object.keys(GEN);
