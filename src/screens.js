// 로비 UI. 디자인 목업(src/ui-screens/*.html, 1280x720 아트보드)을 그대로 불러와 화면 크기에 맞추고, 게임 데이터(코인·캐릭터·모드 등)를 채운다.
// 3D 캐릭터는 UI 위에 올린 투명 캔버스가 getView() 영역에만 그린다 (자리 표시 실루엣은 제거).
import LOADING from './ui-screens/loading.html';
import { playGacha } from './gachafx.js';
import { ART_A, ART_B } from './loadart.js';
import * as hub from './hub.js';
import LOBBY from './ui-screens/lobby.html';
import MODE from './ui-screens/mode-select.html';
import CHARSEL from './ui-screens/character-select.html';
import EVENTS from './ui-screens/events-missions.html';
import GACHA from './ui-screens/gacha.html';
import SHOP from './ui-screens/shop.html';

/* ---------- 확장용 데이터: 모드 / 캐릭터 메타 / 미션 ---------- */
// 모드를 늘리려면 MODES 에 항목을 추가한다. ready:false 는 "준비 중" 표시.
export const MODES = [
  { id: 'ai', title: 'AI 대전', desc: '1 vs 1 · 상대는 AI', long: 'AI 상대와 1 대 1로 싸웁니다. 승리하면 코인과 트로피를 얻어요.', chips: ['1 vs 1', 'AI 상대'], ready: true },
  { id: 'online', title: '온라인 대전', desc: '서버 매칭 1 vs 1', long: '서버에서 상대를 찾아 1 대 1로 싸웁니다. 곧 열립니다.', chips: ['1 vs 1', '서버 매칭'], ready: false },
  { id: 'cap', title: '3v3 점령', desc: '3 vs 3 거점 점령', long: '곧 열립니다.', chips: ['3 vs 3', '거점 점령'], ready: false },
  { id: 'raid', title: '보스 레이드', desc: '4인 협동 보스 처치', long: '곧 열립니다.', chips: ['4인 협동', '보스 처치'], ready: false },
  { id: 'duel', title: '1v1 결투', desc: '1 vs 1 먼저 3승', long: '곧 열립니다.', chips: ['1 vs 1', '먼저 3승'], ready: false },
  { id: 'rank', title: '랭크 매치', desc: '3 vs 3 시즌 랭킹', long: '곧 열립니다.', chips: ['3 vs 3', '시즌 랭킹'], ready: false },
];
const META = {   // 등급 / 역할(탭 분류) / 설명용 능력치 (0~100)
  silent: { rar: '비스트', group: '딜러', role: '근접 검사', atk: 62, spd: 55, rng: 25 },
  lich: { rar: '드래곤', group: '딜러', role: '마법 딜러', atk: 70, spd: 50, rng: 60 },
  shadow: { rar: '비스트', group: '암살자', role: '암살자', atk: 55, spd: 70, rng: 50 },
  sugar: { rar: '비스트', group: '서포터', role: '서포터', atk: 45, spd: 45, rng: 75 },
  dark: { rar: '레전더리', group: '딜러', role: '마녀', atk: 65, spd: 50, rng: 55 },
};
// 등급제: 커먼 < 레어 < 에픽 < 슈퍼에픽 < 레전더리 < 에인션트 < 비스트 < 드래곤
export const RARITIES = ['커먼', '레어', '에픽', '슈퍼에픽', '레전더리', '에인션트', '비스트', '드래곤'];
const RC = { 커먼: ['#9bb4c9', '#c1d2e0'], 레어: ['#5cc8ff', '#8fdcff'], 에픽: ['#b57cff', '#cfa5ff'], 슈퍼에픽: ['#ff6fb5', '#ffa0d0'], 레전더리: ['#ffb02e', '#ffd873'], 에인션트: ['#2fd39a', '#8af0c8'], 비스트: ['#ff5a4d', '#ff9a8c'], 드래곤: ['#7a5cff', '#3fe0ff'] };
export const rarGrade = r => Math.max(1, RARITIES.indexOf(r) + 1);
const meta = id => META[id] || { rar: '커먼', group: '딜러', role: '', atk: 50, spd: 50, rng: 50 };
const DAILY = [
  { id: 'd1', t: '경기 1회 플레이하기', k: 'plays', n: 1, r: 100 }, { id: 'd2', t: 'AI에게 1번 승리하기', k: 'wins', n: 1, r: 200 },
  { id: 'd3', t: '승리 3번 달성하기', k: 'wins', n: 3, r: 300 }, { id: 'd4', t: '뽑기 1회 돌리기', k: 'gachas', n: 1, r: 100 }, { id: 'd5', t: '상점에서 무료 선물 받기', k: 'gift', n: 1, r: 100 }, { id: 'd6', t: '출석 체크하기', k: 'att', n: 1, r: 150 },
];
const WEEKLY = [
  { id: 'w1', t: '경기 10회 플레이하기', k: 'wplays', n: 10, r: 500 }, { id: 'w2', t: '승리 5번 달성하기', k: 'wwins', n: 5, r: 600 },
  { id: 'w3', t: '뽑기 5회 돌리기', k: 'wgachas', n: 5, r: 400 }, { id: 'w4', t: '승리 10번 달성하기', k: 'wwins', n: 10, r: 1000 }, { id: 'w5', t: '경기 25회 플레이하기', k: 'wplays', n: 25, r: 1000 }, { id: 'w6', t: '출석 5일 하기', k: 'watt', n: 5, r: 800 },
];
export const SEASON = { no: 1, name: '찬란한 지식의 봄', part: 1, parts: ['거짓은 심연을 삼키고', '진리는 따스히 세상을 비추리라'], main: ['shadow'] };   // 메인 고등급: 쉐도우밀크 · 퓨어바닐라(미구현) 및 각성
const partName = () => SEASON.parts[SEASON.part - 1];
const TIPS = ['스킬은 적이 모여 있을 때 사용하면 더 효과적이에요.', '맵이 넓어졌어요. 장애물 뒤에서 투사체를 피해 보세요.', '쉐도우밀크의 장막 안에서는 Q로 쉐도우 스텝을 쓸 수 있어요.', '데미지를 많이 넣으면 궁극기 게이지가 차올라요.'];

/* ---------- DOM 도우미 ---------- */
const parse = h => new DOMParser().parseFromString(h, 'text/html').body.firstElementChild;
const textNodes = el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), a = []; while (w.nextNode()) a.push(w.currentNode); return a; };
const findText = (el, s, nth = 0) => textNodes(el).filter(t => t.data.trim() === s)[nth];
const setText = (el, from, to, nth = 0) => { const t = findText(el, from, nth); if (t) t.data = t.data.replace(from, to); return t; };
const byLabel = (el, l) => el.querySelector('[aria-label="' + l + '"]');
const btnByText = (el, s) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === s);
const fmt = n => Math.round(n).toLocaleString();
const hexOf = c => '#' + c.toString(16).padStart(6, '0');

let pickupId = null, api, host, toastEl, wraps = {}, cur = null, view = null, prevId = null, viewId = null, filter = '전체', missionTab = 'daily', pop = null;
const st = { mode: 'ai', foe: 'random' };
const S = () => api.SAVE;
const today = () => new Date().toISOString().slice(0, 10);
const weekKey = () => Math.floor((Date.now() + 4 * 864e5) / (7 * 864e5));

export function ensureSave(SAVE) {
  SAVE.gems = SAVE.gems || 0; SAVE.tickets = SAVE.tickets || 0; SAVE.pity = SAVE.pity || 0; SAVE.totalWins = SAVE.totalWins || 0; SAVE.tro = SAVE.tro || {};
  const m = SAVE.mi = Object.assign({ day: '', wk: 0, plays: 0, wins: 0, gachas: 0, gift: 0, att: 0, wplays: 0, wwins: 0, wgachas: 0, watt: 0, claimed: {} }, SAVE.mi);
  if (m.day !== today()) { m.day = today(); m.plays = m.wins = m.gachas = m.gift = m.att = 0; DAILY.forEach(d => delete m.claimed[d.id]); }
  if (m.wk !== weekKey()) { m.wk = weekKey(); m.wplays = m.wwins = m.wgachas = m.watt = 0; WEEKLY.forEach(d => delete m.claimed[d.id]); }
  return m;
}
export function recordMatch(SAVE, charId, win) {
  const m = ensureSave(SAVE); m.plays++; m.wplays++;
  if (win) { m.wins++; m.wwins++; SAVE.totalWins++; }
  SAVE.tro[charId] = Math.max(0, (SAVE.tro[charId] || 0) + (win ? 8 : -4)); hub.hubMatch(win);
}
export const recordRaid = dmg => hub.hubRaid(dmg);
const charLv = id => Math.min(15, 1 + Math.floor((S().wins[id] || 0) / 2));
const claimable = list => { const m = ensureSave(S()); return list.filter(d => m[d.k] >= d.n && !m.claimed[d.id]); };

/* ---------- 화면 관리 ---------- */
const HTMLS = { loading: LOADING, lobby: LOBBY, mode: MODE, chars: CHARSEL, events: EVENTS, gacha: GACHA, shop: SHOP };
function ensureHost() {
  if (host) return;
  const css = document.createElement('style');
  css.textContent = `#ui{position:fixed;inset:0;z-index:30;background:#6fd3ff;overflow:hidden;user-select:none}
  #ui .scr{position:absolute;left:0;top:0;width:1280px;height:720px;transform-origin:0 0;display:none}
  #ui button{font:inherit;color:#2b1830}#ui button:hover:not(:disabled){filter:brightness(1.07)}#ui button:active:not(:disabled){transform:translateY(2px)}
  #ui-toast{position:fixed;left:50%;bottom:9%;transform:translateX(-50%);z-index:80;background:#2b1830;color:#fff;border:3px solid #fff3df;border-radius:16px;padding:8px 20px;font:20px 'Jua','Noto Sans KR',sans-serif;opacity:0;transition:opacity .2s;pointer-events:none}
  #ui-toast.on{opacity:1}`;
  document.head.appendChild(css);
  host = document.createElement('div'); host.id = 'ui'; document.body.appendChild(host);
  toastEl = document.createElement('div'); toastEl.id = 'ui-toast'; document.body.appendChild(toastEl);
  addEventListener('resize', fit);
}
let toastT = 0;
export function toast(msg) { ensureHost(); toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 1700); }
const soon = () => toast('준비 중이에요');
function fit() {
  const s = Math.min(innerWidth / 1280, innerHeight / 720), ox = (innerWidth - 1280 * s) / 2, oy = (innerHeight - 720 * s) / 2;
  host && (host.dataset.s = s, host.dataset.ox = ox, host.dataset.oy = oy);
  for (const w of Object.values(wraps)) w.style.transform = `translate(${ox}px,${oy}px) scale(${s})`;
}
export function getView() {   // 3D 캐릭터를 그릴 영역(CSS px). 화면이 3D 를 쓰지 않으면 null
  if (!view || !host || host.style.display === 'none') return null;
  const s = +host.dataset.s, ox = +host.dataset.ox, oy = +host.dataset.oy;
  return { x: ox + view.x * s, y: oy + view.y * s, w: view.w * s, h: view.h * s, f: view.f };
}
let busy = 0;   // 뽑기 연출/결과가 떠 있는 동안에는 3D 캐릭터를 그리지 않는다 (UI 위를 덮어서 보상이 가려지는 문제 방지)
export const previewId = () => busy ? null : (cur === 'chars' ? viewId : cur === 'lobby' ? api.picked() : cur === 'gacha' ? pickupId : null);

export function open(name) {
  ensureHost(); host.style.display = 'block';
  let w = wraps[name]; if (!w) { w = wraps[name] = document.createElement('div'); w.className = 'scr'; host.appendChild(w); }
  w.innerHTML = ''; const art = parse(HTMLS[name]); build[name](art); w.appendChild(art);
  for (const [k, v] of Object.entries(wraps)) v.style.display = k === name ? 'block' : 'none';
  cur = name; host.style.background = art.style.backgroundColor || '#6fd3ff';
  view = name === 'lobby' ? { x: 440, y: 150, w: 400, h: 470, f: .72 } : name === 'chars' ? { x: 760, y: 100, w: 480, h: 226, f: .86 } : name === 'gacha' ? { x: 430, y: 175, w: 280, h: 290, f: .8 } : null;
  fit();
}
export function hide() { if (host) host.style.display = 'none'; view = null; cur = null; }
export function refresh() { if (cur && build[cur]) open(cur); }
export function openCustom(name, html, bg = '#3a2048') {
  ensureHost(); host.style.display = 'block'; const w = wraps[name] || (wraps[name] = Object.assign(document.createElement('div'), { className: 'scr' })); host.appendChild(w); w.innerHTML = html;
  for (const [k, v] of Object.entries(wraps)) v.style.display = k === name ? 'block' : 'none';
  cur = name; view = null; host.style.background = bg; fit(); return w;
}
export function init(a) { api = a; ensureSave(S()); hub.initHub({ S, api: a, toast, openCustom, back: () => open('lobby') }); viewId = api.picked(); open('lobby'); }

/* ---------- 로딩 ---------- */
export function bootLoading() {
  ensureHost(); const w = wraps.loading = document.createElement('div'); w.className = 'scr'; host.appendChild(w);
  const art = parse(LOADING); { const n = textNodes(art).find(t => t.data.includes('[업데이트 이름]')); if (n) n.data = 'SEASON ' + SEASON.no + ' · ' + SEASON.name; setText(art, '[버전 번호]', 'v0.1.0 · PART ' + SEASON.part + ' ' + partName()); } setText(art, TIPS[0] ? 'TIP · 스킬은 적이 모여 있을 때 사용하면 더 효과적이에요.' : '', 'TIP · ' + TIPS[Math.floor(Math.random() * TIPS.length)]);
  for (const [lab, svg] of [['캐릭터 A 일러스트 자리', ART_A], ['캐릭터 B 일러스트 자리', ART_B]]) { const ph = art.querySelector(`svg[aria-label="${lab}"]`); if (ph) { const t = document.createElement('div'); t.innerHTML = svg; ph.replaceWith(t.firstChild); } }
  w.appendChild(art); w.style.display = 'block'; host.style.background = '#2b1a5c'; host.style.display = 'block'; cur = 'loading'; fit(); setProgress(0);
}
let ld = null;   // 로딩 상태: 막대/퍼센트/문구 노드, 표시값(부드럽게 차오름), 목표값
function ldFind(w) {
  const bar = w.querySelector('[style*="width:64%"]'), pct = findText(w, '64%'), label = findText(w, '로딩 중...');
  bar.style.transition = 'none';
  return { w, bar, pct, label, shown: 0, target: 0, ready: false, cb: null, started: false, t0: performance.now() };
}
export function setProgress(p) {
  const w = wraps.loading; if (!w) return;
  if (!ld) { ld = ldFind(w); ldTick(); }
  ld.target = Math.max(ld.target, p);
}
function ldTick() {
  if (!ld) return;
  // 실제 진행도를 따라가되, 너무 빨리 끝나지 않도록 최소 시간(약 2.4초)에 걸쳐 차오르게 한다
  const el = (performance.now() - ld.t0) / 2400, goal = Math.min(ld.target, Math.min(1, el));
  ld.shown += (goal - ld.shown) * .12 + (goal > ld.shown ? .002 : 0); if (ld.shown > goal) ld.shown = goal;
  const pc = Math.round(ld.shown * 100);
  ld.bar.style.width = pc + '%'; ld.pct.data = pc + '%';
  if (ld.ready && ld.shown >= .995 && !ld.started) ldPrompt();
  else requestAnimationFrame(ldTick);
}
function ldPrompt() {
  ld.started = true; ld.bar.style.width = '100%'; ld.pct.data = '100%';
  ld.label.data = 'Click to Start'; const lab = ld.label.parentElement;
  const sn = textNodes(ld.w).find(t => t.data.startsWith('SEASON ')); if (sn) sn.parentElement.style.visibility = 'hidden';
  Object.assign(lab.style, { animation: 'ldblink 1s ease-in-out infinite', left: '0', width: '1280px', textAlign: 'center', fontSize: '34px', top: '560px', lineHeight: '40px' });
  const go = () => { host.removeEventListener('pointerdown', go); try { const d = document.documentElement; (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d); screen.orientation?.lock?.('landscape').catch(() => {}); } catch (_) {} const cb = ld.cb; ld = null; cb && cb(); };
  host.addEventListener('pointerdown', go);
}
// 모든 모델이 준비되면 호출: 게이지가 끝까지 차면 "Click to Start" 를 띄우고, 클릭하면 cb 실행
export function loadingDone(cb) { if (!ld && wraps.loading) { ld = ldFind(wraps.loading); ldTick(); } ld.target = 1; ld.ready = true; ld.cb = cb; }

/* ---------- 공통: 재화 칩, 닫기 ---------- */
function currencies(art, gemsText, coinsText) {
  if (gemsText) setText(art, '1,250', fmt(S().gems), 0); if (coinsText) setText(art, '48,300', fmt(S().coins), 0);
}
const back = () => open('lobby');
function wireClose(art) { const c = byLabel(art, '닫기') || byLabel(art, '뒤로'); if (c) c.onclick = back; }

/* ---------- 로비 ---------- */
const build = {};
build.lobby = art => {
  const SAVE = S(), id = api.picked(), c = api.CHARS[id], mt = meta(id), em = claimable(DAILY).length + claimable(WEEKLY).length;
  byLabel(art, '3D 캐릭터 모델 자리').remove();
  setText(art, 'PLAYER_01', '플레이어'); setText(art, 'Lv 12', 'Lv ' + (1 + Math.floor(SAVE.totalWins / 3)));
  setText(art, '1,250', fmt(SAVE.gems)); setText(art, '48,300', fmt(SAVE.coins)); setText(art, '12', fmt(SAVE.tickets));
  setText(art, 'CHARACTER 01', c.name); setText(art, '전설', mt.rar); setText(art, 'Lv 9', 'Lv ' + charLv(id)); setText(art, '482', fmt(SAVE.tro[id] || 0));
  const chip = findText(art, mt.rar)?.parentElement; if (chip) chip.style.background = RC[mt.rar][0];
  setText(art, '3v3 점령', (MODES.find(m => m.id === st.mode) || MODES[0]).title);
  const evb = byLabel(art, '이벤트'), mib = byLabel(art, '미션'), badge = (b, n) => { const s = [...b.querySelectorAll('span')].find(x => /^\d+$/.test(x.textContent.trim())); if (s) { if (n) s.textContent = n; else s.remove(); } };
  badge(evb, hub.eventBadge()); badge(mib, claimable(DAILY).length);
  setText(art, '별빛 축제', '시즌 ' + SEASON.no); setText(art, '한정 이벤트', partName()); setText(art, 'D-5', 'PART ' + SEASON.part); setText(art, '시즌 패스 Lv 7', '시즌 ' + SEASON.no + ' 패스 Lv ' + hub.passLevel());
  byLabel(art, '플레이').onclick = () => { const foe = st.foe === 'random' ? api.ORDER[Math.floor(Math.random() * api.ORDER.length)] : st.foe; hide(); api.start(api.picked(), foe, st.mode); };
  byLabel(art, '캐릭터 선택').onclick = () => { viewId = api.picked(); filter = '전체'; open('chars'); };
  byLabel(art, '모드 변경').onclick = () => open('mode');
  byLabel(art, '상점').onclick = () => open('shop'); byLabel(art, '뽑기').onclick = () => open('gacha');
  byLabel(art, '이벤트').onclick = () => hub.openEvent('pick'); byLabel(art, '미션').onclick = () => { missionTab = 'daily'; open('events'); };
  byLabel(art, '별빛 축제 이벤트').onclick = () => hub.openEvent('pick');
  const mailB = byLabel(art, '우편함'); mailB.setAttribute('aria-label', '출석 체크');
  mailB.innerHTML = '<svg aria-hidden="true" width="30" height="30" viewBox="0 0 30 30" style="position:absolute;left:6px;top:6px"><rect x="3" y="6" width="24" height="20" rx="3" fill="#fff" stroke="#2b1830" stroke-width="2.5"/><rect x="3" y="6" width="24" height="6" fill="#ff5c8a" stroke="#2b1830" stroke-width="2.5"/><path d="M9 18l4 4 8-8" fill="none" stroke="#2b1830" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' + (hub.attendReady() ? '<span style="position:absolute;right:-6px;top:-8px;width:20px;height:20px;border-radius:50%;background:#ff3b5c;border:3px solid #2b1830"></span>' : '');
  mailB.onclick = hub.openAttend; byLabel(art, '시즌 패스').onclick = hub.openPass;
  byLabel(art, '설정').onclick = openSettings;
  byLabel(art, '프로필').onclick = () => hub.openProfile('info');
  for (const l of ['채팅', '친구 초대 1', '친구 초대 2', '보석 충전', '코인 충전', '뽑기권 충전']) byLabel(art, l).onclick = l === '코인 충전' || l === '뽑기권 충전' ? () => open('shop') : soon;
};

/* ---------- 모드 선택 ---------- */
const OLD_MODE = [['3v3 점령', '3 vs 3 거점 점령'], ['서바이벌', '10인 개인전 최후의 1인'], ['보물 쟁탈', '3 vs 3 보석 10개 모으기'], ['보스 레이드', '4인 협동 보스 처치'], ['1v1 결투', '1 vs 1 먼저 3승'], ['랭크 매치', '3 vs 3 시즌 랭킹']];
build.mode = art => {
  const panel = [...art.children].find(e => e.style.width === '1040px'), cards = [...panel.querySelectorAll(':scope>button')].filter(b => b.style.width === '320px');
  const bTitle = findText(art, '3v3 점령', 1), bDesc = textNodes(art).find(t => t.data.trim().startsWith('3명이 한 팀')), bBtn = btnByText(panel, '선택하기');
  const OUT = cards[0].style.outline, outOff = cards[0].style.outlineOffset, badge = [...cards[0].querySelectorAll('span')].find(s => s.textContent.trim() === '선택됨');
  let sel = Math.max(0, MODES.findIndex(m => m.id === st.mode));
  const OLD_CHIP = [['3 vs 3', '거점 점령'], ['10인 개인전', '최후의 1인'], ['3 vs 3', '보석 10개 모으기'], ['4인 협동', '보스 처치'], ['1 vs 1', '먼저 3승'], ['3 vs 3', '시즌 랭킹']];
  cards.forEach((card, i) => { const m = MODES[i]; if (!m) return; setText(card, OLD_MODE[i][0], m.title); setText(card, OLD_CHIP[i][0], m.chips[0]); setText(card, OLD_CHIP[i][1], m.chips[1]); });
  const paint = () => {
    cards.forEach((c, i) => { c.style.outline = i === sel ? OUT : ''; c.style.outlineOffset = i === sel ? outOff : ''; c.setAttribute('aria-pressed', i === sel); if (badge) { if (i === sel) c.appendChild(badge); } });
    bTitle.data = MODES[sel].title; bDesc.data = MODES[sel].long;
  };
  cards.forEach((c, i) => c.onclick = () => { if (!MODES[i] || !MODES[i].ready) return soon(); sel = i; paint(); });
  paint();
  for (const t of ['랭크', '이벤트']) { const b = btnByText(panel, t); if (b) b.onclick = soon; }
  bBtn.onclick = () => { st.mode = MODES[sel].id; back(); };
  byLabel(art, '닫기').onclick = back;
  // 상대 선택 (AI 대전의 상대 캐릭터)
  const foeOpts = ['random', ...api.ORDER], chip = document.createElement('button');
  chip.style.cssText = "position:absolute;left:690px;top:86px;width:320px;height:44px;padding:0;border:3px solid #2b1830;border-radius:16px;background:#fff;box-shadow:0 3px 0 #2b1830;font-family:'Jua',sans-serif;font-size:19px;color:#2b1830;cursor:pointer";
  const label = () => '상대: ' + (st.foe === 'random' ? '랜덤' : api.CHARS[st.foe].name) + '  ▶'; chip.textContent = label();
  chip.onclick = () => { st.foe = foeOpts[(foeOpts.indexOf(st.foe) + 1) % foeOpts.length]; chip.textContent = label(); }; panel.appendChild(chip);
};

/* ---------- 캐릭터 선택 ---------- */
build.chars = art => {
  const SAVE = S(), left = [...art.children].find(e => e.style.width === '700px'), right = [...art.children].find(e => e.style.left === '744px');
  currencies(art, true, true); wireClose(art);
  const oldCards = [...left.querySelectorAll(':scope>button')], tSel = oldCards[0].cloneNode(true), tNorm = oldCards[1].cloneNode(true), tLock = oldCards[6].cloneNode(true);
  oldCards.forEach(c => c.remove());
  const stripe = (card, r) => { const [a, b] = RC[r]; card.firstElementChild.style.background = `repeating-linear-gradient(45deg,${a} 0,${a} 14px,${b} 14px,${b} 28px)`; };
  const list = api.ORDER.filter(id => filter === '전체' || meta(id).group === filter);
  list.forEach((id, i) => {
    const un = SAVE.unlocked.includes(id), mt = meta(id), c = api.CHARS[id], picked = api.picked() === id, shown = viewId === id;
    const card = (un ? (picked ? tSel : tNorm) : tLock).cloneNode(true);
    card.style.left = 22 + 166 * (i % 4) + 'px'; card.style.top = 20 + 188 * Math.floor(i / 4) + 'px'; stripe(card, mt.rar);
    if (!un) {
      setText(card, '전설', mt.rar); setText(card, 'CHARACTER 07', c.name); const bar = card.querySelector('span[style*="width:118px"]');
      if (bar) { bar.outerHTML = `<span style="position:absolute;left:0;top:150px;width:146px;text-align:center;font-family:'Noto Sans KR',sans-serif;font-weight:700;font-size:13px;line-height:16px;color:#4d3a55">${fmt(c.cost)} 코인으로 해금</span>`; }
      card.setAttribute('aria-label', c.name + ' 잠김');
    } else {
      setText(card, picked ? 'Lv 9' : 'Lv 7', 'Lv ' + charLv(id)); setText(card, picked ? 'CHARACTER 01' : 'CHARACTER 02', c.name);
      const rt = textNodes(card).find(t => t.data.includes(' · ')); if (rt) rt.data = mt.rar + ' · ' + mt.group; card.setAttribute('aria-label', c.name + (picked ? ' 선택중' : ''));
    }
    if (shown && !picked) card.style.outline = '5px solid #5cc8ff', card.style.outlineOffset = '2px';
    card.onclick = () => { viewId = id; open('chars'); }; left.appendChild(card);
  });
  // 탭
  const tabs = [...art.querySelectorAll(':scope>button[aria-pressed]')].filter(b => b.style.top === '22px');
  tabs.forEach(b => { const on = b.textContent.trim() === filter; b.setAttribute('aria-pressed', on); b.style.background = on ? '#ffb02e' : '#ffe4bd'; b.onclick = () => { filter = b.textContent.trim(); const l = api.ORDER.filter(x => filter === '전체' || meta(x).group === filter); if (l.length && !l.includes(viewId)) viewId = l[0]; open('chars'); }; });
  // 오른쪽 미리보기 패널
  const id = viewId, c = api.CHARS[id], mt = meta(id), un = SAVE.unlocked.includes(id), sk = c.skills.base;
  byLabel(right, '3D 캐릭터 모델 자리').remove();
  const rchip = findText(right, '전설')?.parentElement; setText(right, '전설', mt.rar); if (rchip) rchip.style.background = RC[mt.rar][0];
  setText(right, 'CHARACTER 01', c.name); setText(right, '탱커', mt.group); setText(right, 'Lv 9 / 15', `Lv ${charLv(id)} / 15`); setText(right, '트로피 482', '트로피 ' + fmt(SAVE.tro[id] || 0));
  const rows = [...right.children].filter(e => e.style.height === '24px' && e.style.width === '456px'), vals = [[c.hp / 30000 * 100, fmt(c.hp) + (c.shield ? ' +' + fmt(c.shield) : '')], [mt.atk, ['낮음', '보통', '높음'][mt.atk > 60 ? 2 : mt.atk > 50 ? 1 : 0]], [mt.spd, mt.spd > 55 ? '빠름' : '보통'], [mt.rng, mt.rng > 55 ? '원거리' : mt.rng < 35 ? '근거리' : '중거리']];
  rows.forEach((r, i) => { const fill = r.querySelector('span span'); if (fill) fill.style.width = Math.min(100, vals[i][0]) + '%'; r.lastElementChild.textContent = vals[i][1]; });
  const sks = sk.r ? sk.r.name : sk.v.name; setText(right, '3연발 사격', sk.a.name); setText(right, '방패 돌진', sk.z.name + ' · ' + sk.x.name); setText(right, '광역 충격파', sks);
  const bs = [...right.querySelectorAll(':scope>button')], bSkin = bs[0], bUp = bs[1], bSel = bs[2];
  bSkin.onclick = soon; bUp.onclick = soon;
  bSel.textContent = un ? (api.picked() === id ? '선택중' : '선택') : `해금 ${fmt(c.cost)}`;
  bSel.onclick = () => { if (un) { api.pick(id); toast(c.name + ' 선택!'); open('chars'); } else if (SAVE.coins >= c.cost) { SAVE.coins -= c.cost; SAVE.unlocked.push(id); api.persist(); toast(c.name + ' 해금!'); open('chars'); } else toast('코인이 부족해요'); };
};

/* ---------- 이벤트 · 미션 ---------- */
build.events = art => {
  const SAVE = S(), m = ensureSave(SAVE), list = missionTab === 'weekly' ? WEEKLY : DAILY;
  byLabel(art, '닫기').onclick = back;
  const P = [...art.children].find(e => e.tagName === 'DIV' && parseInt(e.style.width) > 1000 && parseInt(e.style.width) < 1280) || art;
  const tabs = [...P.querySelectorAll(':scope>button[aria-pressed]')].filter(b => b.style.left === '16px');
  const names = { '이벤트': 'weekly', '일일 미션': 'daily', '주간 미션': 'weekly' };
  tabs.forEach(b => { const t = b.textContent.replace(/\d+/g, '').trim(), on = names[t] === missionTab && t !== '이벤트'; b.setAttribute('aria-pressed', on); b.style.background = on ? '#3ddbb0' : '#ffe4bd'; b.onclick = () => { if (!names[t] || t === '이벤트') return soon(); missionTab = names[t]; open('events'); }; });
  const dayTab = tabs.find(b => b.textContent.includes('일일 미션')), nDaily = claimable(DAILY).length; if (dayTab) { const bd = [...dayTab.querySelectorAll('span')].find(s => /^\d+$/.test(s.textContent.trim())); if (bd) { if (nDaily) bd.textContent = nDaily; else bd.remove(); } }
  const box = [...P.querySelectorAll(':scope>div')].find(e => e.style.top === '92px' && e.style.width === '548px');
  const done = list.filter(d => m.claimed[d.id]).length, pts = done * (100 / list.length);
  const pt = [...box.querySelectorAll('span')].find(s => s.textContent.includes('진행도')); pt.firstChild.data = (missionTab === 'weekly' ? '이번 주 진행도 ' : '오늘의 진행도 '); pt.querySelector('span').textContent = Math.round(pts); pt.lastChild.data = ' / 100';
  const fillBar = box.querySelector('span[style*="width:510px"] span'); if (fillBar) fillBar.style.width = pts + '%';
  const rows = [...P.querySelectorAll(':scope>div')].filter(e => e.style.left === '212px' && e.style.height === '62px'), tpl = rows[0].cloneNode(true);
  rows.forEach(r => r.remove());
  const cloneRow = (d, i) => {
    const r = tpl.cloneNode(true), cur = Math.min(m[d.k], d.n), has = m.claimed[d.id], ok = m[d.k] >= d.n;
    r.style.top = 226 + 70 * i + 'px'; setText(r, '경기 3회 플레이하기', d.t); setText(r, '3/3', cur + '/' + d.n); setText(r, '+100', '+' + d.r);
    const bar = r.querySelector('span[style*="width:150px"] span'); if (bar) bar.style.width = cur / d.n * 100 + '%';
    const b = r.querySelector('button'); b.textContent = has ? '완료' : ok ? '받기' : '진행 중';
    if (has || !ok) { b.style.background = has ? '#bde8cf' : '#e6e0ee'; b.style.boxShadow = '0 3px 0 #2b1830'; b.style.cursor = 'default'; }
    b.onclick = () => { if (has || !ok) return; SAVE.coins += d.r; m.claimed[d.id] = true; api.persist(); toast(`코인 +${d.r}`); open('events'); };
    P.appendChild(r);
  };
  list.forEach(cloneRow);
  btnByText(box, '모두 받기').onclick = () => { const c = claimable(list); if (!c.length) return toast('받을 보상이 없어요'); let sum = 0; c.forEach(d => { sum += d.r; m.claimed[d.id] = true; }); SAVE.coins += sum; api.persist(); toast(`코인 +${sum}`); open('events'); };
  // 아래 이벤트 카드 2개 → 업적형 이벤트
  setText(art, '진행 중인 이벤트', '업적 이벤트');
  const ev = [{ id: 'tc', t: '10승 달성', d: '누적 10승을 달성하세요.', cur: SAVE.totalWins, n: 10, r: 1000 }, { id: 'cc', t: '캐릭터 수집가', d: '캐릭터 3종을 해금하세요.', cur: SAVE.unlocked.length, n: 3, r: 500 }];
  SAVE.evc = SAVE.evc || {};
  const old = [['별빛 축제', '별 조각을 모아 한정 보상을 받으세요.', '36 / 50', '참여하기'], ['보스 레이드', '4명이 힘을 합쳐 이번 주 보스를 처치하세요.', '1 / 3 처치', '도전하기']];
  old.forEach((o, i) => {
    const e = ev[i]; setText(art, o[0], e.t); setText(art, o[1], e.d); setText(art, o[2], `${Math.min(e.cur, e.n)} / ${e.n}`);
    const b = btnByText(art, o[3]); const ok = e.cur >= e.n, has = SAVE.evc[e.id]; b.textContent = has ? '수령 완료' : ok ? '보상 받기' : '진행 중';
    b.onclick = () => { if (has || !ok) return; SAVE.coins += e.r; SAVE.evc[e.id] = true; api.persist(); toast(`코인 +${e.r}`); open('events'); };
  });
  setText(art, 'D-3', '상시'); setText(art, 'D-5', '상시');
};

/* ---------- 뽑기 ---------- */
const RATES = [['전설 2.5%', '캐릭터 3%'], ['영웅 9.5%', '에픽 코인 1,000 5%'], ['희귀 28%', '레어 코인 500 12%'], ['일반 60%', '커먼 코인 100~200 80%']];
function draw(n, useTicket) {
  const SAVE = S(), cost = n === 10 ? 2700 : 300;
  if (useTicket) { if (SAVE.tickets < 1) return toast('뽑기권이 없어요'); SAVE.tickets--; n = 1; } else { if (SAVE.coins < cost) return toast('코인이 부족해요'); SAVE.coins -= cost; }
  const m = ensureSave(SAVE), out = [];
  for (let i = 0; i < n; i++) {
    m.gachas++; m.wgachas++; hub.hubStat('pulls'); SAVE.pity++; const r = Math.random() * 100, locked = api.ORDER.filter(id => !SAVE.unlocked.includes(id));
    if ((r < 3 || SAVE.pity >= 30) && locked.length) { const id = locked[Math.floor(Math.random() * locked.length)]; SAVE.unlocked.push(id); SAVE.pity = 0; out.push({ k: 'n', s: api.CHARS[id].name, sub: meta(id).rar + ' · 신규' }); continue; }
    if (r < 3) SAVE.pity = 0;
    const coin = r < 8 ? 1000 : r < 20 ? 500 : r < 50 ? 200 : 100; SAVE.coins += coin; out.push({ k: 'c', s: fmt(coin), sub: '코인' });
  }
  api.persist(); pop = out; open('gacha');
}
build.gacha = art => {
  const SAVE = S(); byLabel(art, '닫기').onclick = back; setText(art, '12', fmt(SAVE.tickets)); setText(art, '1,250', fmt(SAVE.coins));
  for (const sv of art.querySelectorAll('svg')) if (sv.querySelector('polygon[fill="#3ddbb0"]')) sv.innerHTML = '<circle cx="22" cy="22" r="17" fill="#ffd45c" stroke="#2b1830" stroke-width="3"></circle><circle cx="22" cy="22" r="10" fill="none" stroke="#c47d00" stroke-width="3"></circle>';
  const ph = [...art.querySelectorAll('svg[aria-label="3D 캐릭터 모델 자리"]')]; ph.forEach(x => x.remove());
  setText(art, '별빛 소환', partName()); setText(art, 'D-12', 'PART ' + SEASON.part); setText(art, 'PICK UP', 'PICK UP');
  const p1 = SEASON.main[0], others = api.ORDER.filter(id => id !== p1), p2 = others.find(id => !SAVE.unlocked.includes(id)) || others[0];
  pickupId = p1; setText(art, 'CHARACTER 07', api.CHARS[p1].name); setText(art, 'CHARACTER 07', api.CHARS[p1].name); setText(art, 'CHARACTER 12', api.CHARS[p2].name); setText(art, '전설 · 딜러', meta(p1).rar + ' · ' + meta(p1).group); setText(art, '영웅 · 서포터', meta(p2).rar + ' · ' + meta(p2).group);
  setText(art, '1.2%', '1.5%'); setText(art, '3.0%', '1.5%');
  setText(art, '38 / 90', `${SAVE.pity} / 30`); const pt = textNodes(art).find(t => t.data.includes('회 안에')); if (pt) pt.data = `${Math.max(0, 30 - SAVE.pity)}회 안에 새 캐릭터가 확정으로 나와요.`;
  RATES.forEach(([a, b]) => setText(art, a, b)); setText(art, '300', '3,000'); setText(art, '270', '2,700'); setText(art, '30', '300');
  const ft = textNodes(art).find(t => t.data.includes('10회 뽑기에는')); if (ft) ft.data = '코인으로 뽑거나 뽑기권을 사용할 수 있어요. 뽑기 전 확률 정보를 꼭 확인해 주세요.';
  setText(art, 'x1', 'x' + SAVE.tickets);
  btnByText(art, '1회 뽑기') ? 0 : 0;
  const b1 = [...art.querySelectorAll('button')].find(b => b.textContent.includes('1회 뽑기') && !b.textContent.includes('10회')), b10 = [...art.querySelectorAll('button')].find(b => b.textContent.includes('10회 뽑기')), bt = [...art.querySelectorAll('button')].find(b => b.textContent.includes('티켓 사용'));
  b1.onclick = () => draw(1, false); b10.onclick = () => draw(10, false); bt.onclick = () => draw(1, true);
  for (const t of ['픽업 뽑기', '일반 뽑기', '코인 뽑기', '확률 정보 상세', '뽑기 기록']) { const b = btnByText(art, t); if (b) b.onclick = soon; }
  if (pop) { const items = pop; pop = null; busy++; playGacha(art, items.map(gradeOf), () => showResults(art, items)); }
};
const gradeOf = it => it.k === 'n' ? rarGrade(it.sub.split(' ')[0]) : (it.g || (parseInt(it.s.replace(/,/g, ''), 10) >= 1000 ? 3 : parseInt(it.s.replace(/,/g, ''), 10) >= 500 ? 2 : 1));
function showResults(art, items) {
  const o = document.createElement('div'); o.style.cssText = 'position:absolute;inset:0;background:rgba(43,24,48,.95);z-index:99;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px';
  const cards = items.map((it, i) => `<div style="width:${items.length > 5 ? 150 : 190}px;height:${items.length > 5 ? 120 : 150}px;box-sizing:border-box;border:4px solid #2b1830;border-radius:20px;background:${it.k === 'n' ? 'repeating-linear-gradient(45deg,#ffd873 0,#ffd873 14px,#fff3df 14px,#fff3df 28px)' : '#fff3df'};box-shadow:0 5px 0 #2b1830;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;animation:rp .45s ${i * .07}s both"><b style="font-family:'Black Han Sans','Jua',sans-serif;font-size:${it.k === 'n' ? 24 : 32}px;font-weight:400;color:#2b1830;line-height:1.1">${it.s}</b><span style="font-family:'Noto Sans KR',sans-serif;font-weight:700;font-size:14px;color:#6b4a63;margin-top:4px">${it.sub}</span></div>`).join('');
  o.innerHTML = `<style>@keyframes rp{0%{transform:scale(.3) rotate(-8deg);opacity:0}100%{transform:none;opacity:1}}</style><div style="font-family:'Black Han Sans','Jua',sans-serif;font-size:52px;color:#fff;-webkit-text-stroke:8px #2b1830;paint-order:stroke fill">획득!</div><div style="display:flex;flex-wrap:wrap;gap:14px;justify-content:center;max-width:1020px">${cards}</div>`;
  const ok = document.createElement('button'); ok.textContent = '확인'; ok.style.cssText = "width:200px;height:64px;border:4px solid #2b1830;border-radius:22px;background:#ffc233;box-shadow:inset 0 -7px 0 rgba(0,0,0,.2),0 6px 0 #2b1830;font-family:'Jua',sans-serif;font-size:30px;color:#2b1830;cursor:pointer";
  ok.onclick = () => { o.remove(); busy = Math.max(0, busy - 1); }; o.appendChild(ok); art.appendChild(o);
}

/* ---------- 상점 (뽑기·이벤트와 함께 확장 예정. 결제 상품은 아직 비활성) ---------- */
build.shop = art => {
  const SAVE = S(), m = ensureSave(SAVE); currencies(art, true, true); byLabel(art, '닫기').onclick = back;
  const gift = btnByText(art, '받기');
  if (gift) { gift.textContent = m.gift ? '받음' : '받기'; if (m.gift) { gift.style.background = '#bde8cf'; gift.style.cursor = 'default'; } gift.onclick = () => { if (m.gift) return toast('오늘은 이미 받았어요'); m.gift = 1; m.wgift = 1; SAVE.coins += 500; SAVE.tickets++; api.persist(); toast('코인 +500, 뽑기권 +1'); open('shop'); }; }
  for (const b of art.querySelectorAll('button')) if (b !== gift && !b.getAttribute('aria-label')) b.onclick = soon;
};

/* ---------- 설정 (목업에 없는 화면: 같은 톤으로 구성) ---------- */
function openSettings() {
  ensureHost(); const w = wraps.settings || (wraps.settings = Object.assign(document.createElement('div'), { className: 'scr' })); host.appendChild(w);
  const bs = "height:56px;padding:0 22px;border:3px solid #2b1830;border-radius:18px;box-shadow:inset 0 -5px 0 rgba(0,0,0,.18),0 4px 0 #2b1830;font-family:'Jua',sans-serif;font-size:21px;color:#2b1830;cursor:pointer";
  w.innerHTML = `<div style="position:relative;width:1280px;height:720px;background:#3a2048;font-family:'Jua','Noto Sans KR',sans-serif;color:#2b1830"><div style="position:absolute;left:120px;top:36px;width:1040px;height:650px;box-sizing:border-box;overflow:hidden;background:#fff3df;border:4px solid #2b1830;border-radius:30px;box-shadow:0 8px 0 rgba(0,0,0,.35)">
  <div style="position:absolute;left:0;top:0;width:1032px;height:72px;background:#3a2048"></div><div style="position:absolute;left:28px;top:10px;font-family:'Black Han Sans','Jua',sans-serif;font-size:36px;line-height:52px;color:#fff">설정</div>
  <button id="st-close" aria-label="닫기" style="position:absolute;right:16px;top:11px;width:48px;height:48px;padding:0;border:3px solid #2b1830;border-radius:16px;background:#ff5c8a;box-shadow:inset 0 -5px 0 rgba(0,0,0,.2),0 4px 0 #2b1830;cursor:pointer;font-size:24px;color:#fff">✕</button>
  <div style="position:absolute;left:32px;top:96px;width:960px;font-family:'Noto Sans KR',sans-serif;font-weight:700;font-size:16px;line-height:30px;color:#2b1830">조작 (1P) 이동 WASD · 평타 Space 또는 마우스 클릭 · 스킬 Z X C V · 쉐도우밀크 Q(쉐도우 스텝) R(궁극기) · 조준은 마우스<br>시점 우클릭 드래그 또는 [ ] 회전 · 휠 줌 · T 내 캐릭터 추적 ↔ 둘 다 보기<br>승리 +300 코인 · 패배 +100 코인 · 승리 트로피 +8 / 패배 -4</div>
  <button id="st-cheat" style="${bs};position:absolute;left:32px;top:300px;background:#5cc8ff">테스트: 전체 해금</button>
  <button id="st-reset" style="${bs};position:absolute;left:260px;top:300px;background:#ffe4bd">저장 데이터 초기화</button></div></div>`;
  for (const [k, v] of Object.entries(wraps)) v.style.display = k === 'settings' ? 'block' : 'none';
  fit(); host.style.background = '#3a2048'; const prev = cur; cur = 'settings'; view = null;
  w.querySelector('#st-close').onclick = () => { w.style.display = 'none'; open(prev === 'settings' ? 'lobby' : prev || 'lobby'); };
  w.querySelector('#st-cheat').onclick = () => { api.cheat(); toast('전체 해금 완료'); };
  const rb = w.querySelector('#st-reset'); rb.onclick = () => { if (rb.dataset.sure) { api.reset(); toast('초기화했어요'); open('lobby'); } else { rb.dataset.sure = '1'; rb.textContent = '정말 지울까요? 한 번 더'; } };
}
