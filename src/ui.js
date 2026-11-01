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
    const keys = f.ctrl.kind === 'h2' ? ['7', '8', '9', '0'] : ['Z', 'X', 'C', 'V'];
    const mine = f.ctrl.kind === 'h1' || (f.ctrl.kind === 'h2' && B.mode === 'local');
    const p = document.createElement('div'); p.className = 'hpanel ' + (i ? 'right' : 'left');
    p.innerHTML = `<div class="pname" style="color:${hex(f.def.color)}">${f.def.name}<span class="form"></span></div>
      <div class="hpbar"><div class="hpghost"></div><div class="hpfill"></div><div class="shfill"></div><span class="hptxt"></span></div>
      ${mine ? `<div class="skills">${['z', 'x', 'c', 'v', 'q', 'r'].filter(k => f.def.skills.base[k]).map((k, j) => `<div class="slot" data-k="${k}"><i>${f.ctrl.kind === 'h2' ? { z: '7', x: '8', c: '9', v: '0', q: '6', r: '-' }[k] : k.toUpperCase()}</i><span>${f.def.skills.base[k].name}</span><div class="cdm"></div><b class="cdt"></b></div>`).join('')}</div>` : ''}`;
    root.appendChild(p);
    const tag = document.createElement('div'); tag.className = 'tag3d'; tag.innerHTML = '<div class="mini"><div></div></div><div class="ic"></div>'; root.appendChild(tag);
    hud.panels.push({ f, el: p, fill: p.querySelector('.hpfill'), ghost: p.querySelector('.hpghost'), txt: p.querySelector('.hptxt'), sh: p.querySelector('.shfill'), form: p.querySelector('.form'), slots: [...p.querySelectorAll('.slot')], ghostV: 1 });
    hud.tags.push({ f, el: tag, bar: tag.querySelector('.mini div'), ic: tag.querySelector('.ic') });
  });
}

export function update(B, camera, renderer, dt) {
  if (!hud) return;
  const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
  for (const p of hud.panels) {
    const f = p.f, r = Math.max(0, f.hp / f.max);
    p.fill.style.width = r * 100 + '%'; p.ghostV = Math.max(r, p.ghostV - dt * .25); p.ghost.style.width = p.ghostV * 100 + '%';
    p.txt.textContent = Math.ceil(f.hp).toLocaleString() + ' / ' + f.max.toLocaleString() + (f.shieldMax ? '   🛡 ' + Math.ceil(f.shield).toLocaleString() : '');
    if (p.sh) p.sh.style.width = f.shieldMax ? Math.max(0, f.shield / f.shieldMax) * 100 + '%' : '0';
    p.form.textContent = f.form === 'dragon' ? ' [용]' : f.form === 'witch' ? ' [마녀]' : '';
    p.slots.forEach(s => {
      const k = s.dataset.k, sk = f.def.skills[f.form][k], cd = f.cd[k];
      s.querySelector('span').textContent = sk.name; s.querySelector('.cdm').style.height = cd > 0 ? Math.min(100, cd / sk.cd * 100) + '%' : '0';
      s.querySelector('.cdt').textContent = cd > 0 ? cd.toFixed(1) : (f.def.id === 'lich' && f.form === 'base' && k === 'v' && !f.awake ? '🔒' : '');
      s.classList.toggle('ready', cd <= 0 && (k !== 'r' || (f.awake && f.gauge >= 100)));
      if (k === 'r') { s.querySelector('.cdt').textContent = !f.awake ? '🔒' : f.gauge >= 100 ? 'READY' : Math.floor(f.gauge) + '%'; s.querySelector('.cdm').style.height = f.awake ? (100 - Math.min(100, f.gauge)) + '%' : '100%'; }
    });
  }
  for (const t of hud.tags) {
    const f = t.f; v3.set(f.root.position.x, f.root.position.y + (f.form === 'dragon' ? 6.4 : 2.9), f.root.position.z).project(camera);
    const vis = v3.z < 1 && f.hp > 0 && !B.cut && !f.hidden && !f.bushHid;
    t.el.style.display = vis ? 'block' : 'none';
    t.el.style.transform = `translate(${(v3.x * .5 + .5) * w}px,${(-v3.y * .5 + .5) * h}px) translate(-50%,-100%)`;
    t.bar.style.width = Math.max(0, f.hp / f.max) * 100 + '%';
    let ic = ''; const s = f.st;
    if (s.slow > 0) ic += '🐌'; if (s.silence > 0) ic += '🔇'; if (s.charm > 0) ic += '💘'; if (s.stun > 0) ic += '💫'; if (s.lock > 0) ic += '⛓'; if (s.cdfreeze > 0) ic += '⏳'; if (s.ctl > 0) ic += '🧠'; if (s.rev > 0) ic += '🔄'; if (f.soul) ic += '👻'; else if (f.ult && f.ult.armed) ic += '✨';
    t.ic.textContent = ic;
  }
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i]; p.t += dt; const u = p.t / p.dur;
    if (u >= 1) { p.el.remove(); pops.splice(i, 1); continue; }
    v3.copy(p.pos); v3.y += u * 1.8; v3.project(camera);
    p.el.style.transform = `translate(${(v3.x * .5 + .5) * w + p.dx}px,${(-v3.y * .5 + .5) * h}px) translate(-50%,-50%) scale(${(1 + Math.max(0, .25 - p.t) * 4) * p.sc})`;
    p.el.style.opacity = u < .6 ? 1 : 1 - (u - .6) / .4;
  }
  const m = $('#mindtimer'); m.style.display = B.mind || B.raid ? 'block' : 'none'; if (B.mind) m.textContent = '정신세계 ' + Math.ceil(B.mind.t) + 's'; else if (B.raid) { m.style.color = '#ffd873'; m.textContent = '레이드 ' + Math.max(0, Math.ceil(B.raid.t)) + 's · 누적 피해 ' + Math.round(B.raid.dmg).toLocaleString(); }
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
export function vignette(on) { $('#game').classList.toggle('vig', on); }
export function result(text, sub) { $('#rtext').textContent = text; $('#rsub').textContent = sub || ''; $('#result').style.display = 'flex'; }
export function hideHud() { hud = null; $('#mindtimer').style.display = 'none'; }
