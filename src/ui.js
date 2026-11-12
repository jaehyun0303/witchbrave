// DOM 기반 UI: 메뉴, HUD, 데미지 숫자, 컷신 레터박스/타이틀
import * as THREE from 'three';
import * as scr from './screens.js';

const $ = s => document.querySelector(s);
const v3 = new THREE.Vector3();
let api, hud = null, pops = [];
const hex = c => typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : c;

export function initUI(a) {
  api = a;
  $('#back').onclick = () => { $('#result').style.display = 'none'; api.back(); };
  scr.init(a);
}
export const buildMenu = () => scr.refresh();
export const refreshLobby = () => scr.refresh();
export const recordMatch = (S, id, win) => scr.recordMatch(S, id, win);
export const recordRaid = dmg => scr.recordRaid(dmg);
export const getView = () => scr.getView();
export const previewId = () => scr.previewId();

// 브롤스타즈식 입장 연출: 양쪽에서 캐릭터 이름이 날아들고 VS, 3-2-1 카운트다운 뒤 전투 시작
let introTimers = [];
export function intro(fs, done) {
  introTimers.forEach(clearTimeout); introTimers = [];
  const el = $('#intro'), cd = el.querySelector('.cd'), [l, r] = [el.querySelector('.ip.l'), el.querySelector('.ip.r')];
  const card = (box, f, side) => { box.innerHTML = '<small>' + side + '</small><b style="color:' + hex(f.def.color) + ';filter:brightness(1.6)">' + f.def.name + '</b><small>' + f.def.tag + ' · HP ' + f.max.toLocaleString() + (f.shieldMax ? ' · 🛡' + f.shieldMax.toLocaleString() : '') + '</small>'; };
  card(l, fs[0], '1P'); card(r, fs[1], fs[1].ctrl.kind === 'ai' ? 'CPU' : '2P');
  el.className = 'on'; cd.className = 'cd'; cd.textContent = '';
  const at = (ms, fn) => introTimers.push(setTimeout(fn, ms));
  at(60, () => el.classList.add('show'));
  at(1900, () => el.classList.add('count'));
  ['3', '2', '1', '시작!'].forEach((t, i) => at(2000 + i * 650, () => { cd.className = 'cd'; void cd.offsetWidth; cd.textContent = t; cd.classList.add('pop'); }));
  at(2000 + 4 * 650 + 200, () => { el.className = ''; done && done(); });
}
export function introCancel() { introTimers.forEach(clearTimeout); introTimers = []; $('#intro').className = ''; }

export function showGame(on) {
  const g = $('#game'); g.style.display = 'block'; g.classList.toggle('lobbymode', !on);
  if (on) scr.hide(); else { $('#hud').innerHTML = ''; $('#result').style.display = 'none'; scr.open('lobby'); }
}

export function beginBattle(B) {
  const root = $('#hud'); root.innerHTML = ''; pops.forEach(p => p.el.remove()); pops = [];
  hud = { B, panels: [], tags: [] };
  B.fighters.forEach((f, i) => {
    if ((B.explore || B.gem || B.sd) && i > 0) { addTag(f); return; }
    const keys = f.ctrl.kind === 'h2' ? ['7', '8', '9', '0'] : ['Z', 'X', 'C', 'V'];
    const mine = f.ctrl.kind === 'h1' || (f.ctrl.kind === 'h2' && B.mode === 'local');
    const p = document.createElement('div'); p.className = 'hpanel ' + (i ? 'right' : 'left');
    p.innerHTML = `<div class="pname" style="color:${hex(f.def.color)}">${f.def.name}<span class="form"></span></div>
      <div class="hpbar"><div class="hpghost"></div><div class="hpfill"></div><div class="shfill"></div><span class="hptxt"></span></div>
      ${mine ? `<div class="skills">${['z', 'x', 'c', 'v', 'e', 'q', 'r'].filter(k => f.def.skills.base[k]).map((k, j) => `<div class="slot" data-k="${k}"><i>${f.ctrl.kind === 'h2' ? { z: '7', x: '8', c: '9', v: '0', q: '6', r: '-' }[k] : k.toUpperCase()}</i><span>${f.def.skills.base[k].name}</span><div class="cdm"></div><b class="cdt"></b></div>`).join('')}</div>` : ''}`;
    root.appendChild(p);
    const tag = document.createElement('div'); tag.className = 'tag3d'; tag.innerHTML = '<div class="nm"></div><div class="mini"><div></div></div><div class="ic"></div>'; root.appendChild(tag);
    hud.panels.push({ f, el: p, fill: p.querySelector('.hpfill'), ghost: p.querySelector('.hpghost'), txt: p.querySelector('.hptxt'), sh: p.querySelector('.shfill'), form: p.querySelector('.form'), slots: [...p.querySelectorAll('.slot')], ghostV: 1 });
    hud.tags.push({ f, el: tag, bar: tag.querySelector('.mini div'), ic: tag.querySelector('.ic'), nm: tag.querySelector('.nm') });
  });
}

export function addTag(f) {
  if (!hud || hud.tags.some(t => t.f === f)) return;
  const tag = document.createElement('div'); tag.className = 'tag3d'; tag.innerHTML = '<div class="nm"></div><div class="mini"><div></div></div><div class="ic"></div>'; $('#hud').appendChild(tag);
  hud.tags.push({ f, el: tag, bar: tag.querySelector('.mini div'), ic: tag.querySelector('.ic'), nm: tag.querySelector('.nm') });
}

export function update(B, camera, renderer, dt) {
  if (!hud) return;
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  for (const p of hud.panels) {
    const f0 = p.f, f = f0.att && f0.att.statue && f0.att.possBy === f0 ? f0.att : f0, r = Math.max(0, f.hp / f.max);   // 동상에 빙의 중이면 동상의 체력을 보여준다
    p.fill.style.width = r * 100 + '%'; p.ghostV = Math.max(r, p.ghostV - dt * .25); p.ghost.style.width = p.ghostV * 100 + '%';
    p.txt.textContent = Math.ceil(f.hp).toLocaleString() + ' / ' + f.max.toLocaleString() + (f.shieldMax ? '   🛡 ' + Math.ceil(f.shield).toLocaleString() : '');
    if (p.sh) p.sh.style.width = f.shieldMax ? Math.max(0, f.shield / f.shieldMax) * 100 + '%' : '0';
    p.form.textContent = f !== f0 ? ' [' + f.def.name.replace(' 사천왕', '') + ' 조종 중 · Q: 원래 몸으로]' : f.form === 'king' ? ' [대왕거미]' : f.form === 'dragon' ? ' [용]' : f.form === 'witch' ? ' [마녀]' : f.form === 'sky' ? ' [하늘]' : f.form === 'pdragon' ? ' [용과드래곤]' : f.form === 'reign' ? ' [군림]' : f.form === 'angel' ? ' [운명의 대천사]' : f.form === 'hour' ? ' [침묵의 때]' : f.form === 'beast' ? (f.boss > 0 ? ' [괴수화 · 보스 모드]' : (f.def.id === 'mysticA' ? ' [공허의 고치]' : ' [괴수화]')) : f.boss > 0 ? ' [보스 모드]' : f.sealSoul ? ' [영혼]' : '';
    p.slots.forEach(s => {
      const pf = f.att && f.att.statue && f.att.possBy === f ? f.att : f, k = s.dataset.k, sk = pf.def.skills[pf.form][k] || { name: '-', cd: 1 }, cd = pf.cd[k] || 0;   // 동상에 빙의 중이면 동상의 스킬을 표시
      s.querySelector('span').textContent = sk.name; s.querySelector('.cdm').style.height = cd > 0 ? Math.min(100, cd / sk.cd * 100) + '%' : '0';
      s.querySelector('.cdt').textContent = cd > 0 ? cd.toFixed(1) : (f.def.id === 'lich' && f.form === 'base' && k === 'v' && !f.awake ? '🔒' : '');
      s.classList.toggle('ready', cd <= 0 && (k !== 'r' || (f.awake && f.gauge >= 100)));
      s.classList.toggle('bound', f.st.cdfreeze > 0 || f.st.silence > 0);   // 쿨타임이 멈췄거나 스킬이 봉인되면 사슬로 묶인 모양
      if (k === 'r') { s.querySelector('.cdt').textContent = !f.awake ? '🔒' : f.gauge >= 100 ? 'READY' : Math.floor(f.gauge) + '%'; s.querySelector('.cdm').style.height = f.awake ? (100 - Math.min(100, f.gauge)) + '%' : '100%'; }
    });
  }
  { let qh = document.getElementById('qhint'); const m0 = B.fighters[0], on = m0 && m0.def.id === 'mysticA' && m0.hp > 0 && (m0.att || m0.fog); if (on && !qh) { qh = document.createElement('div'); qh.id = 'qhint'; qh.style.cssText = 'position:absolute;left:50%;bottom:150px;transform:translateX(-50%);z-index:40;padding:8px 18px;border-radius:10px;background:rgba(20,10,40,.85);border:2px solid #b89aff;color:#fff;font:800 18px sans-serif;pointer-events:none;box-shadow:0 0 18px #7a4aff'; $('#game').appendChild(qh); } if (qh) { qh.style.display = on ? 'block' : 'none'; if (on) qh.textContent = m0.att && m0.att.statue ? '🗿 동상 조종 중 — [Q] 원래 몸으로 돌아가기' : m0.att ? '☁ 붙는 중 — [Z] 떨어지기' : '☁ 안개 이동 중'; } }
  for (const t of hud.tags) {
    const f = t.f; v3.set(f.root.position.x, f.root.position.y + (f.form === 'dragon' ? 6.4 : 2.9), f.root.position.z).project(camera);
    const vis = v3.z < 1 && f.hp > 0 && !B.cut && !f.hidden && !f.bushHid;
    t.el.style.display = vis ? 'block' : 'none';
    t.el.style.transform = `translate(${(v3.x * .5 + .5) * w}px,${(-v3.y * .5 + .5) * h}px) translate(-50%,-100%)`;
    t.bar.style.width = Math.max(0, f.hp / f.max) * 100 + '%';
    let ic = (f.gems ? '💎' + f.gems + ' ' : '') + (f.bty ? '⭐' + f.bty + ' ' : ''); const s = f.st;
    const me = B.fighters[0], isAlly = f !== me && f.team !== undefined && f.team === me.team;   // 아군은 이름 앞 ▼ 표시 + 초록 체력바
    if (t.nmv !== f.nick || t.ally !== isAlly) { t.nmv = f.nick; t.ally = isAlly; t.nm.textContent = (isAlly ? '▼ 아군 · ' : '') + (f.nick || ''); t.nm.style.color = f === me ? '#ffe066' : isAlly ? '#6dff8a' : '#ff9a9a'; t.bar.style.background = isAlly || (f === me && me.team !== undefined) ? '#4be36a' : ''; t.el.querySelector('.mini').style.borderColor = isAlly ? '#2fbf4a' : ''; }
    if (s.slow > 0) ic += '🐌'; if (s.silence > 0) ic += '🔇'; if (s.charm > 0 || s.charmS > 0) ic += '💘'; if (s.stun > 0) ic += '💫'; if (s.lock > 0) ic += '⛓'; if (s.cdfreeze > 0) ic += '⏳'; if (f.mflame) ic += '🔥'; if (f.noHeal > 0) ic += '💔'; if (s.ctl > 0) ic += '🧠'; if (s.rev > 0) ic += '🔄'; if (f.pseal > 0) ic += '🔒'; if (f.shock > 0) ic += '⚡'; if (f.soul) ic += '👻'; else if (f.ult && f.ult.armed) ic += '✨';
    t.ic.textContent = ic;
  }
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]; p.t += dt; const u = p.t / p.dur;
    if (u >= 1) { p.el.remove(); pops.splice(i, 1); continue; }
    v3.copy(p.pos); v3.y += u * 1.8; v3.project(camera);
    p.el.style.transform = `translate(${(v3.x * .5 + .5) * w + p.dx}px,${(-v3.y * .5 + .5) * h}px) translate(-50%,-50%) scale(${(1 + Math.max(0, .25 - p.t) * 4) * p.sc})`;
    p.el.style.opacity = u < .6 ? 1 : 1 - (u - .6) / .4;
  }
  const m = $('#mindtimer'); m.style.display = B.mind || B.raid || B.series ? 'block' : 'none'; if (B.mind) m.textContent = '정신세계 ' + Math.ceil(B.mind.t) + 's'; else if (B.series) { m.style.color = '#ffd873'; m.textContent = `ROUND ${B.series.round}  ·  ${B.series.w[0]} : ${B.series.w[1]}  (먼저 3승)`; } else if (B.raid) { m.style.color = '#ffd873'; m.textContent = '레이드 ' + Math.max(0, Math.ceil(B.raid.t)) + 's · 누적 피해 ' + Math.round(B.raid.dmg).toLocaleString(); }
}

export function pop(pos, text, color, big) {
  const el = document.createElement('div'); el.className = 'dmg' + (big ? ' big' : ''); el.textContent = text; el.style.color = hex(color) || '#fff';
  $('#hud').appendChild(el);
  pops.push({ el, pos: pos.clone(), t: 0, dur: big ? 1.1 : .85, dx: (Math.random() - .5) * 50, sc: big ? 1.5 : 1 });
}
let toastT;
export function toast(t) { const e = $('#toast'); e.textContent = t; e.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => e.style.opacity = 0, 1600); }
export function flash(color, dur = .4, a = .85) {
  const e = $('#flash'); e.style.transition = 'none'; e.style.background = color; e.style.opacity = a;
  requestAnimationFrame(() => requestAnimationFrame(() => { e.style.transition = `opacity ${dur}s ease-out`; e.style.opacity = 0; }));
}
export function cinema(on) { $('#game').classList.toggle('cinema', on); }
export function title(text, sub) {
  const e = $('#ctitle'); e.innerHTML = text ? `<div>${text}</div><small>${sub || ''}</small>` : ''; e.classList.toggle('show', !!text);
}
export function dim(n) {   // 암흑의 기운: 중첩(0~3)마다 시야가 좁아진다
  let e = document.getElementById('dimv');
  if (!e) { if (!n) return; e = document.createElement('div'); e.id = 'dimv'; e.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:30;transition:background .35s'; $('#game').appendChild(e); }
  if (e._n === n) return; e._n = n;
  const r = [[0, 0], [40, 62], [27, 44], [15, 30]][n] || [0, 0];
  e.style.background = n ? `radial-gradient(circle at 50% 55%, rgba(0,0,0,0) ${r[0]}vmin, rgba(2,0,8,.96) ${r[1]}vmin)` : 'none';
}
export function tint(color) {   // 전체 화면 색조 (종말의 하늘 등). '' 이면 제거
  let e = document.getElementById('tintv');
  if (!color) { if (e) e.remove(); return; }
  if (!e) { e = document.createElement('div'); e.id = 'tintv'; e.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:29;mix-blend-mode:screen'; $('#game').appendChild(e); }
  e.style.background = color;
}
const FEAR = ['죽어', '도망쳐', '끝이야', '뒤를 봐', '눈을 떠', '소용없어', '함께 가자', '무서워?', '어둠', '아직이야', '살려줘', '이제 늦었어'];
export function fear(on) {   // 보라 브레스에 맞으면 무서운 글자가 화면을 덮는다
  let e = document.getElementById('fearv');
  if (!on) { if (e) e.remove(); return; }
  if (!e) { e = document.createElement('div'); e.id = 'fearv'; e.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:31;overflow:hidden;background:radial-gradient(circle,rgba(20,0,40,.3),rgba(10,0,20,.82))'; $('#game').appendChild(e); e._t = 0; }
  const now = performance.now(); if (now - e._t > 200) {
    e._t = now; const s = document.createElement('span'); s.textContent = FEAR[Math.floor(Math.random() * FEAR.length)];
    s.style.cssText = `position:absolute;left:${Math.random() * 80}%;top:${Math.random() * 85}%;font:900 ${28 + Math.random() * 60}px sans-serif;color:rgba(255,40,80,.88);text-shadow:0 0 14px #700;transform:rotate(${Math.random() * 40 - 20}deg)`; e.appendChild(s); if (e.children.length > 16) e.firstChild.remove();
  }
}
export function pink(on) {   // 거대 하트: 시야가 핑크빛
  let e = document.getElementById('pinkv');
  if (!on) { if (e) e.remove(); return; }
  if (!e) { e = document.createElement('div'); e.id = 'pinkv'; e.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:30;background:rgba(255,110,200,.42);mix-blend-mode:screen'; $('#game').appendChild(e); }
}
export function vignette(on) { $('#game').classList.toggle('vig', on); }
export function result(text, sub) { try { dispatchEvent(new Event('wb-result')); } catch (_) {}$('#rtext').textContent = text; $('#rsub').textContent = sub || ''; $('#result').style.display = 'flex'; }
export function hideHud() { hud = null; $('#mindtimer').style.display = 'none'; }

/* 유리 깨짐 연출 (리치드래곤 궁극기) */
export function glass(on) {
  const old = document.getElementById('glass'); if (old) old.remove();
  if (!on) return;
  const g = document.createElement('div'); g.id = 'glass'; g.style.cssText = 'position:absolute;inset:0;z-index:60;pointer-events:none;overflow:hidden';
  $('#game').appendChild(g);
  const C = 9, R = 6, P = [], jit = () => (Math.random() - .5) * 7;
  for (let r = 0; r <= R; r++) { P[r] = []; for (let c = 0; c <= C; c++) P[r][c] = [c / C * 100 + (c === 0 || c === C ? 0 : jit()), r / R * 100 + (r === 0 || r === R ? 0 : jit())]; }
  let svg = '';
  const tri = (a, b, c) => {
    const d = document.createElement('div'), cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
    d.className = 'shard'; d.dataset.cx = cx; d.dataset.cy = cy;
    d.style.cssText = 'position:absolute;inset:0;clip-path:polygon(' + [a, b, c].map(p => p[0] + '% ' + p[1] + '%').join(',') + ');background:linear-gradient(' + Math.round(Math.random() * 360) + 'deg,rgba(255,255,255,.22),rgba(255,90,140,.14));transform-origin:' + cx + '% ' + cy + '%;transition:transform 1.1s cubic-bezier(.5,0,1,.7),opacity 1.1s ease-in';
    g.appendChild(d); svg += '<polygon points="' + [a, b, c].map(p => p[0] + ',' + p[1]).join(' ') + '"/>';
  };
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { const a = P[r][c], b = P[r][c + 1], d = P[r + 1][c], e = P[r + 1][c + 1]; if ((r + c) % 2) { tri(a, b, d); tri(b, e, d); } else { tri(a, b, e); tri(a, e, d); } }
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 100 100'); s.setAttribute('preserveAspectRatio', 'none'); s.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;transition:opacity .5s';
  s.innerHTML = '<g fill="none" stroke="rgba(255,255,255,.75)" stroke-width=".18" vector-effect="non-scaling-stroke">' + svg + '</g>'; s.id = 'glasslines'; g.appendChild(s);
}
export function glassFall() {
  const g = document.getElementById('glass'); if (!g) return;
  const l = g.querySelector('#glasslines'); if (l) l.style.opacity = 0;
  g.querySelectorAll('.shard').forEach(d => { const dx = (Math.random() - .5) * 40, dy = 70 + Math.random() * 60, rot = (Math.random() - .5) * 120; requestAnimationFrame(() => { d.style.transform = 'translate(' + dx + 'vw,' + dy + 'vh) rotate(' + rot + 'deg)'; d.style.opacity = 0; }); });
}

export function voidText(text) {   // 공허의 고치: 허무한 문구가 화면에 떠올랐다 사라진다
  const s = document.createElement('div'); s.textContent = text; const rot = () => (Math.random() * 8 - 4);
  s.style.cssText = 'position:absolute;left:' + (6 + Math.random() * 55) + '%;top:' + (10 + Math.random() * 70) + '%;font:700 ' + (26 + Math.random() * 30) + 'px serif;color:rgba(238,238,252,.95);text-shadow:0 0 16px #8a70ff,0 0 4px #000;letter-spacing:4px;pointer-events:none;z-index:32;opacity:0;transition:opacity .6s,transform 2.6s;transform:translateY(0) rotate(' + rot() + 'deg)';
  const g = $('#game'); g.appendChild(s); requestAnimationFrame(() => { s.style.opacity = 1; s.style.transform = 'translateY(-26px) rotate(' + rot() + 'deg)'; });
  setTimeout(() => { s.style.opacity = 0; }, 1800); setTimeout(() => s.remove(), 2700);
}
let pickKey = null;
export function pick(title, items, cb) {   // 선택 창: 숫자키/클릭 = 선택, Esc = 취소. cb(index | -1)
  const old = document.getElementById('pickv'); if (old) old.remove(); if (pickKey) { removeEventListener('keydown', pickKey, true); pickKey = null; }
  const e = document.createElement('div'); e.id = 'pickv';
  e.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;background:rgba(14,10,30,.92);border:2px solid #9a6aff;border-radius:12px;padding:16px 20px;min-width:340px;max-width:90%;color:#fff;font:600 16px sans-serif;box-shadow:0 0 30px #5a3acc';
  const h = document.createElement('div'); h.textContent = title; h.style.cssText = 'margin-bottom:10px;color:#e0d0ff'; e.appendChild(h);
  const done = i => { e.remove(); if (pickKey) { removeEventListener('keydown', pickKey, true); pickKey = null; } cb(i); };
  items.forEach((t, i) => { const b = document.createElement('div'); b.textContent = (i + 1) + '. ' + t; b.style.cssText = 'padding:8px 10px;margin:4px 0;background:rgba(154,106,255,.18);border-radius:8px;cursor:pointer'; b.onpointerdown = ev => { ev.stopPropagation(); done(i); }; e.appendChild(b); });
  pickKey = ev => { if (ev.code === 'Escape') { ev.stopPropagation(); ev.preventDefault(); done(-1); } else if (/^Digit[1-9]$/.test(ev.code)) { const i = +ev.code.slice(5) - 1; if (i < items.length) { ev.stopPropagation(); ev.preventDefault(); done(i); } } };
  addEventListener('keydown', pickKey, true); $('#game').appendChild(e);
}
