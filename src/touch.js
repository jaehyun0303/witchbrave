// 모바일 터치 조작: 왼쪽 떠있는 조이스틱(이동), 오른쪽 평타 버튼 + 스킬 버튼(탭 = 자동 조준, 드래그 = 방향 조준 후 손을 떼면 발동)
export const isTouch = (() => { try { return /[?&]touch=1/.test(location.search) || matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window; } catch (_) { return false; } })();

// game.js 가 매 프레임 읽는 입력 상태. mx/my 는 화면 기준(오른쪽 +, 아래 +), 조준은 화면 기준 방향과 길이
export const TOUCH = { mx: 0, my: 0, atk: false, aim: null, until: 0 };

let root, joy, knob, base, btns = [], api, fighter = null, camBtn;
const KEYS = ['z', 'x', 'c', 'v', 'e', 'q', 'r'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function css() {
  const s = document.createElement('style');
  s.textContent = `
  #touch{position:fixed;inset:0;z-index:40;pointer-events:none;display:none;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
  #touch.on{display:block}
  #tjoy{position:absolute;left:0;bottom:0;width:46%;height:72%;pointer-events:auto;touch-action:none}
  #tbase{position:absolute;width:132px;height:132px;margin:-66px 0 0 -66px;border-radius:50%;border:4px solid #fff8;background:#0003;display:none}
  #tknob{position:absolute;left:50%;top:50%;width:62px;height:62px;margin:-31px 0 0 -31px;border-radius:50%;background:#fffd;border:3px solid #2b1830;box-shadow:0 3px 0 #2b1830}
  .tb{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;border:4px solid #2b1830;background:linear-gradient(#ffe48a,#ffc233);box-shadow:inset 0 -6px 0 rgba(0,0,0,.2),0 5px 0 #2b1830;color:#2b1830;font:900 22px/1 'Jua','Noto Sans KR',sans-serif;display:flex;align-items:center;justify-content:center;overflow:hidden;text-align:center}
  .tb small{position:absolute;bottom:5px;left:0;right:0;font:700 10px/1 'Noto Sans KR',sans-serif;white-space:nowrap;overflow:hidden;opacity:.85}
  .tb.atk{background:linear-gradient(#ff9ab0,#ff5c8a);font-size:26px;color:#fff;-webkit-text-stroke:5px #2b1830;paint-order:stroke fill}
  .tb .cdm{position:absolute;left:0;right:0;bottom:0;background:#000b}.tb .cdt{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;-webkit-text-stroke:4px #000;paint-order:stroke fill}
  .tb.ready{border-color:#fff;box-shadow:inset 0 -6px 0 rgba(0,0,0,.2),0 5px 0 #2b1830,0 0 14px #ffe48a}
  .tb.hold{transform:scale(.94)}
  .tb.bound{filter:grayscale(.85) brightness(.75)}
  .tb.bound::after{content:'⛓';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;background:repeating-linear-gradient(135deg,#0000 0 7px,#cfd4ff66 7px 9px);text-shadow:0 0 4px #000,0 0 8px #000}
  #tcz{position:absolute;inset:0;pointer-events:auto;touch-action:none}
  .tdot{position:absolute;width:26px;height:26px;border-radius:50%;background:#fff;border:3px solid #2b1830;pointer-events:none;display:none;z-index:2}
  #tcam{position:absolute;right:14px;top:74px;width:46px;height:46px;font-size:22px}
  #trot{position:fixed;inset:0;z-index:9999;background:#2b1a5c;color:#fff;display:none;flex-direction:column;align-items:center;justify-content:center;gap:14px;font:900 26px/1.3 'Jua','Noto Sans KR',sans-serif;text-align:center}
  #trot b{font-size:64px;display:block;animation:trot 1.6s ease-in-out infinite}@keyframes trot{0%,30%{transform:rotate(0)}60%,100%{transform:rotate(-90deg)}}
  @media (orientation:portrait){.touchdev #trot{display:flex}}
  .touchdev .skills{display:none!important}
  .touchdev,.touchdev body{touch-action:none;overscroll-behavior:none}
  .touchdev,.touchdev *{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
  #result,#result button{touch-action:manipulation}
  `;
  document.head.appendChild(s);
}

export function initTouch(a) {
  if (!isTouch) return; api = a; css();
  document.documentElement.classList.add('touchdev');
  let vp = document.querySelector('meta[name=viewport]'); if (!vp) { vp = document.createElement('meta'); vp.name = 'viewport'; document.head.appendChild(vp); }
  vp.setAttribute('content', 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover');
  const rot = document.createElement('div'); rot.id = 'trot'; rot.innerHTML = '<b>📱</b>가로로 돌려서 플레이해 주세요'; document.body.appendChild(rot);
  root = document.createElement('div'); root.id = 'touch';
  root.innerHTML = '<div id="tcz"></div><div id="tjoy"><div id="tbase"><div id="tknob"></div></div></div>';
  document.body.appendChild(root);
  // 카메라: 빈 화면을 한 손가락으로 끌면 회전/기울기, 두 손가락으로 벌리거나 오므리면 줌 (조이스틱·버튼은 이 위에 떠 있어서 영향 없음)
  const cz = root.querySelector('#tcz'), ps = new Map(); let pinch = 0;
  cz.addEventListener('pointerdown', e => { try { cz.setPointerCapture(e.pointerId); } catch (_) {} ps.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ps.size === 2) { const [a, b] = [...ps.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); } });
  cz.addEventListener('pointermove', e => {
    const p = ps.get(e.pointerId); if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ps.size >= 2) { const [a, b] = [...ps.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch > 0 && d > 0) api.camZoom && api.camZoom(pinch / d); pinch = d; }
    else api.camDrag && api.camDrag(dx, dy);
  });
  const czEnd = e => { ps.delete(e.pointerId); pinch = 0; }; cz.addEventListener('pointerup', czEnd); cz.addEventListener('pointercancel', czEnd);
  joy = root.querySelector('#tjoy'); base = root.querySelector('#tbase'); knob = root.querySelector('#tknob');
  let pid = null, ox = 0, oy = 0;
  const R = 58;
  joy.addEventListener('pointerdown', e => { if (pid !== null) return; pid = e.pointerId; try { joy.setPointerCapture(pid); } catch (_) {} const r = joy.getBoundingClientRect(); ox = e.clientX; oy = e.clientY; base.style.display = 'block'; base.style.left = ox - r.left + 'px'; base.style.top = oy - r.top + 'px'; knob.style.transform = ''; });
  joy.addEventListener('pointermove', e => {
    if (e.pointerId !== pid) return; let dx = e.clientX - ox, dy = e.clientY - oy; const m = Math.hypot(dx, dy);
    if (m > R) { dx *= R / m; dy *= R / m; } knob.style.transform = `translate(${dx}px,${dy}px)`;
    const u = Math.hypot(dx, dy) / R; if (u < .14) { TOUCH.mx = TOUCH.my = 0; } else { TOUCH.mx = dx / R; TOUCH.my = dy / R; }
  });
  const end = e => { if (e.pointerId !== pid) return; pid = null; TOUCH.mx = TOUCH.my = 0; base.style.display = 'none'; };
  joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
  addEventListener('contextmenu', e => isTouch && e.preventDefault());
  addEventListener('wb-result', () => showTouch(false));   // 결과창이 뜨면 터치 오버레이를 꺼서 '돌아가기' 버튼이 눌리게
  document.addEventListener('gesturestart', e => e.preventDefault());
}

const pos = (r, b) => `right:${r}px;bottom:${b}px`;
function mk(cls, label, sub, size, right, bottom) {
  const el = document.createElement('div'); el.className = 'tb ' + cls; el.style.cssText = `width:${size}px;height:${size}px;${pos(right, bottom)}`;
  el.innerHTML = `<span>${label}</span>${sub ? `<small>${sub}</small>` : ''}<div class="cdm" style="height:0"></div><div class="cdt"></div>`;
  root.appendChild(el); return el;
}

export function showTouch(on, f) {
  if (!isTouch) return; fighter = on ? f : null;
  btns.forEach(b => b.el.remove()); btns = []; camBtn && camBtn.remove(); camBtn = null; TOUCH.mx = TOUCH.my = 0; TOUCH.atk = false; TOUCH.aim = null;
  root.classList.toggle('on', on); if (!on) return;
  const s = Math.min(1.15, Math.max(.8, innerHeight / 400));      // 화면 높이에 맞춰 버튼 크기 조절
  const atk = mk('atk', '평타', '', 100 * s, 22, 22); atk.querySelector('small')?.remove();
  atk.addEventListener('pointerdown', e => { try { atk.setPointerCapture(e.pointerId); } catch (_) {} TOUCH.atk = true; atk.classList.add('hold'); });
  const up = () => { TOUCH.atk = false; atk.classList.remove('hold'); }; atk.addEventListener('pointerup', up); atk.addEventListener('pointercancel', up);
  btns.push({ el: atk, k: null });
  const ks = KEYS.filter(k => f.def.skills.base[k]), C = { r: 22 + 50 * s, b: 22 + 50 * s }, Rr = 126 * s;
  const ang = [0, 33, 66, 99];
  ks.forEach((k, i) => {
    let size, r, b;
    if (i < 4) { size = 70 * s; const a = ang[i] * Math.PI / 180; r = C.r + Rr * Math.cos(a) - size / 2; b = C.b + Rr * Math.sin(a) - size / 2; }
    else { size = 54 * s; r = C.r + Rr * 1.55 * Math.cos((10 + (i - 4) * 38) * Math.PI / 180) - size / 2; b = C.b + Rr * 1.55 * Math.sin((10 + (i - 4) * 38) * Math.PI / 180) - size / 2 + 6; }
    const el = mk('', k === 'q' ? 'Q' : k === 'r' ? '궁' : k.toUpperCase(), f.def.skills.base[k].name, size, Math.max(8, r), Math.max(8, b));
    const dot = document.createElement('div'); dot.className = 'tdot'; el.appendChild(dot);
    let sx = 0, sy = 0, d = null;
    el.addEventListener('pointerdown', e => { try { el.setPointerCapture(e.pointerId); } catch (_) {} sx = e.clientX; sy = e.clientY; d = { dx: 0, dy: 0, m: 0 }; el.classList.add('hold'); });
    el.addEventListener('pointermove', e => {
      if (!d) return; let dx = e.clientX - sx, dy = e.clientY - sy; const m = Math.hypot(dx, dy), L = 74;
      if (m > L) { dx *= L / m; dy *= L / m; } d = { dx, dy, m: Math.min(m, L) };
      dot.style.display = d.m > 12 ? 'block' : 'none'; dot.style.left = size / 2 - 13 + dx * .5 + 'px'; dot.style.top = size / 2 - 13 + dy * .5 + 'px';
    });
    const fire = e => {
      if (!d) return; el.classList.remove('hold'); dot.style.display = 'none';
      TOUCH.aim = d.m > 12 ? { dx: d.dx, dy: d.dy, m: d.m } : null; TOUCH.until = performance.now() + 260; d = null;
      if (e.type === 'pointerup') api.press(k);
    };
    el.addEventListener('pointerup', fire); el.addEventListener('pointercancel', fire);
    btns.push({ el, k });
  });
  camBtn = mk('', '👁', '', 46, 14, 0); camBtn.id = 'tcam'; camBtn.style.bottom = ''; camBtn.style.top = '74px';
  camBtn.addEventListener('pointerdown', () => api.toggleCam());
}

// 쿨타임/잠금 표시 (ui.js 의 슬롯과 같은 규칙)
export function updateTouch() {
  const f = fighter; if (!f || !btns.length) return;
  for (const b of btns) {
    if (!b.k) continue; const pf = f.att && f.att.statue && f.att.possBy === f ? f.att : f, k = b.k, sk = pf.def.skills[pf.form][k]; if (!sk) continue; const cd = pf.cd[k];
    const cdm = b.el.querySelector('.cdm'), cdt = b.el.querySelector('.cdt'), sm = b.el.querySelector('small');
    if (sm && sm.textContent !== sk.name) sm.textContent = sk.name;
    let h = cd > 0 ? Math.min(100, cd / sk.cd * 100) : 0, t = cd > 0 ? cd.toFixed(1) : '';
    if (k === 'r') { t = !f.awake ? '🔒' : f.gauge >= 100 ? '' : Math.floor(f.gauge) + '%'; h = f.awake ? 100 - Math.min(100, f.gauge) : 100; }
    else if (f.def.id === 'lich' && f.form === 'base' && k === 'v' && !f.awake && cd <= 0) t = '🔒';
    cdm.style.height = h + '%'; if (cdt.textContent !== t) cdt.textContent = t;
    b.el.classList.toggle('ready', cd <= 0 && (k !== 'r' || (f.awake && f.gauge >= 100)));
    b.el.classList.toggle('bound', f.st.cdfreeze > 0 || f.st.silence > 0);
  }
}
