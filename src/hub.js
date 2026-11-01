// 출석 체크 · 시즌 패스 · 이벤트(「거짓은 심연을 삼키고」: 픽업 뽑기 / 이벤트 퀘스트 / 쉐도우밀크 레이드)
// 목업이 없는 화면이라 로비와 같은 톤(크림 패널 + 진한 테두리)으로 직접 구성한다.
import { playGacha } from './gachafx.js';
import { runRaid, rewardLeft } from './raid.js';

export const SHARD = '심연의 조각';
const PASS_MAX = 30, PASS_XP = 100, PITY = 40, RAID_TRIES = 3;
const today = () => new Date().toISOString().slice(0, 10);
const weekKey = () => Math.floor((Date.now() + 4 * 864e5) / (7 * 864e5));
const fmt = n => Math.round(n).toLocaleString();

/* ---------- 데이터 (확장 지점) ---------- */
// 보상 객체: c 코인, t 뽑기권, s 심연의 조각, g 보석, x 시즌 패스 XP
const rtxt = r => [r.c && `코인 ${fmt(r.c)}`, r.t && `뽑기권 ${r.t}`, r.s && `조각 ${r.s}`, r.g && `보석 ${r.g}`, r.x && `패스 XP ${r.x}`].filter(Boolean).join(' · ');
const rshort = r => r.g ? '💎' + r.g : r.t ? '🎟' + r.t : r.s ? '🔷' + r.s : r.c ? '🪙' + fmt(r.c) : '';
const ATT = d => d % 7 === 0 ? (d === 28 ? { t: 5, g: 200, s: 100 } : { t: 2, s: 50, c: 500 }) : d % 7 === 3 ? { s: 20, c: 200 } : { c: 300 + (d % 7) * 50 };
const PASS_FREE = l => l % 10 === 0 ? { t: 2, c: 1000 } : l % 5 === 0 ? { s: 30 } : { c: 200 + l * 10 };
const PASS_PREM = l => l % 10 === 0 ? { t: 3, g: 100 } : l % 5 === 0 ? { s: 60, c: 800 } : { c: 400, s: 10 };
const EV_DAILY = [
  { id: 'ed1', t: '경기 1회 플레이하기', k: 'plays', n: 1, r: { s: 10 } }, { id: 'ed2', t: '승리 2번 달성하기', k: 'wins', n: 2, r: { s: 15 } },
  { id: 'ed3', t: '쉐도우밀크 레이드 1회 도전', k: 'raids', n: 1, r: { s: 20 } }, { id: 'ed4', t: '이벤트 뽑기 1회 돌리기', k: 'pulls', n: 1, r: { s: 10 } },
];
const EV_WEEKLY = [
  { id: 'ew1', t: '경기 15회 플레이하기', k: 'wplays', n: 15, r: { s: 60 } }, { id: 'ew2', t: '승리 8번 달성하기', k: 'wwins', n: 8, r: { s: 70 } },
  { id: 'ew3', t: '쉐도우밀크 레이드 5회 도전', k: 'wraids', n: 5, r: { s: 100 } }, { id: 'ew4', t: '이벤트 뽑기 10회 돌리기', k: 'wpulls', n: 10, r: { s: 60 } },
];
const RAID_TIERS = [   // 최고 피해 기록 달성 보상
  { id: 'r1', n: 30000, r: { s: 30 } }, { id: 'r2', n: 80000, r: { c: 1500 } }, { id: 'r3', n: 150000, r: { s: 60, t: 1 } },
  { id: 'r4', n: 250000, r: { c: 3000, g: 50 } }, { id: 'r5', n: 400000, r: { s: 120, t: 2 } }, { id: 'r6', n: 600000, r: { g: 200, c: 5000, t: 3 } },
];
export const RAID_BOSS_HP = 2000000, RAID_TIME = 60;

/* ---------- 저장 데이터 ---------- */
let ctx;
export function initHub(c) { ctx = c; }
const SV = () => ctx.S();
export const nickOf = () => SV().nick || '플레이어';
export function askNick(done, parent) {
  const o = document.createElement('div'); o.style.cssText = 'position:absolute;inset:0;background:#000a;display:flex;align-items:center;justify-content:center;z-index:50';
  o.innerHTML = '<div style="width:460px;padding:26px;border:4px solid #2b1830;border-radius:22px;background:#fff3df;text-align:center;font-family:Jua,sans-serif;color:#2b1830"><div style="font-size:30px;margin-bottom:6px">닉네임 설정</div><div style="font-size:16px;color:#6b4a63;margin-bottom:14px">2~10글자 (한글·영문·숫자)</div><input id="nin" maxlength="10" style="width:300px;height:46px;border:3px solid #2b1830;border-radius:14px;padding:0 14px;font-size:22px;font-family:inherit;text-align:center"><div id="nerr" style="height:22px;font-size:15px;color:#c0392b;margin-top:6px"></div><div style="display:flex;gap:12px;justify-content:center;margin-top:6px"><button id="nok" style="width:130px;height:46px;border:3px solid #2b1830;border-radius:16px;background:#3ddbb0;font-size:22px;font-family:inherit;cursor:pointer;box-shadow:0 4px 0 #2b1830">확인</button><button id="nno" style="width:130px;height:46px;border:3px solid #2b1830;border-radius:16px;background:#ffe4bd;font-size:22px;font-family:inherit;cursor:pointer;box-shadow:0 4px 0 #2b1830">취소</button></div></div>';
  (parent || root || document.body).appendChild(o);
  const inp = o.querySelector('#nin'); inp.value = SV().nick || ''; inp.focus();
  o.querySelector('#nno').onclick = () => o.remove();
  o.querySelector('#nok').onclick = () => {
    const v = inp.value.trim();
    if (v.length < 2 || v.length > 10 || !/^[가-힣A-Za-z0-9_ ]+$/.test(v)) { o.querySelector('#nerr').textContent = '2~10글자, 한글·영문·숫자만 쓸 수 있어요'; return; }
    SV().nick = v; ctx.api.persist(); o.remove(); ctx.toast('닉네임: ' + v); if (done) done();
  };
}
export function H() {
  const S = SV(), h = S.hub = S.hub || {};
  h.shards ??= 0; h.pity ??= 0; h.pv ??= 0;
  h.att ??= { n: 0, last: '' }; h.pass ??= { xp: 0, f: {}, p: {}, prem: false };
  h.rd ??= { last: 0, clears: 0 }; h.stat ??= { plays: 0, raids: 0, pulls: 0 }; h.ac ??= {}; h.tc ??= {};
  h.q ??= { day: '', wk: 0, c: {} }; h.raid ??= { best: 0, total: 0, day: '', tries: 0, c: {} };
  const q = h.q;
  if (q.day !== today()) { q.day = today(); q.plays = q.wins = q.raids = q.pulls = 0; EV_DAILY.forEach(d => delete q.c[d.id]); h.raid.day = today(); h.raid.tries = 0; }
  if (q.wk !== weekKey()) { q.wk = weekKey(); q.wplays = q.wwins = q.wraids = q.wpulls = 0; EV_WEEKLY.forEach(d => delete q.c[d.id]); }
  return h;
}
const grant = r => {
  const S = SV(), h = H(); S.coins += r.c || 0; S.tickets += r.t || 0; S.gems += r.g || 0; h.shards += r.s || 0; h.pass.xp = Math.min(PASS_MAX * PASS_XP, h.pass.xp + (r.x || 0));
};
export const passLevel = () => Math.min(PASS_MAX, 1 + Math.floor(H().pass.xp / PASS_XP));
export function addPassXp(n) { const p = H().pass; p.xp = Math.min((PASS_MAX - 1) * PASS_XP, p.xp + n); }
// game.js 결과 처리 → screens.recordMatch 가 호출
export function hubMatch(win) { H().stat.plays++; const q = H().q; q.plays++; q.wplays++; if (win) { q.wins++; q.wwins++; } addPassXp(win ? 40 : 20); }
export function hubRaid(dmg) {
  const h = H(), r = h.raid; r.tries++; r.total += dmg; r.best = Math.max(r.best, dmg); h.q.raids++; h.q.wraids++; h.stat.raids++; addPassXp(30);
  ctx.api.persist(); return { best: r.best, isBest: dmg >= r.best, total: r.total };
}
export const raidTriesLeft = () => Math.max(0, RAID_TRIES - H().raid.tries);
const mi = () => { const S = SV(); S.mi = S.mi || {}; return S.mi; };
const evClaimable = () => [...EV_DAILY, ...EV_WEEKLY].filter(d => H().q[d.k] >= d.n && !H().q.c[d.id]).length + (rewardLeft(SV(), H) === 0 ? 1 : 0);
export const eventBadge = evClaimable;
export const attendReady = () => H().att.last !== today();
export const passClaimable = () => { const h = H(), lv = passLevel(); let n = 0; for (let l = 1; l <= lv; l++) { if (!h.pass.f[l]) n++; if (h.pass.prem && !h.pass.p[l]) n++; } return n; };

/* ---------- 공통 스타일 ---------- */
const FONT = "font-family:'Jua','Noto Sans KR',sans-serif";
const HAN = "font-family:'Black Han Sans','Jua',sans-serif";
const BTN = (bg = '#ffc233', extra = '') => `border:3px solid #2b1830;border-radius:16px;background:${bg};box-shadow:inset 0 -5px 0 rgba(0,0,0,.18),0 4px 0 #2b1830;${FONT};color:#2b1830;cursor:pointer;${extra}`;
const stroke = (px = 6) => `color:#fff;-webkit-text-stroke:${px}px #2b1830;paint-order:stroke fill`;
const chip = (icon, v) => `<div style="height:44px;padding:0 16px;display:flex;align-items:center;gap:8px;border:3px solid #2b1830;border-radius:16px;background:#fff3df;box-shadow:0 3px 0 #2b1830;${FONT};font-size:20px;color:#2b1830">${icon}<b style="font-weight:400">${v}</b></div>`;
function head(title, sub, bg, withShard = true) {
  const S = SV();
  return `<div style="position:absolute;left:0;top:0;width:1280px;height:720px;background:${bg}"></div>
  <div style="position:absolute;left:40px;top:14px;${HAN};font-size:40px;line-height:50px;${stroke(8)}">${title}</div>
  <div style="position:absolute;left:42px;top:64px;${FONT};font-size:17px;color:#ffe9b8">${sub}</div>
  <div style="position:absolute;right:104px;top:20px;display:flex;gap:10px">${withShard ? chip('🔷', fmt(H().shards)) : ''}${chip('🪙', fmt(S.coins))}${chip('🎟', fmt(S.tickets))}</div>
  <button id="hx" aria-label="닫기" style="position:absolute;right:36px;top:20px;width:52px;height:44px;padding:0;${BTN('#ff5c8a')};font-size:22px;color:#fff">✕</button>`;
}
const panel = (l, t, w, h, inner, bg = '#fff3df') => `<div style="position:absolute;left:${l}px;top:${t}px;width:${w}px;height:${h}px;box-sizing:border-box;border:4px solid #2b1830;border-radius:26px;background:${bg};box-shadow:0 6px 0 rgba(0,0,0,.35);overflow:hidden">${inner}</div>`;
const bar = (p, w, col = '#3ddbb0') => `<div style="width:${w}px;height:18px;box-sizing:border-box;border:3px solid #2b1830;border-radius:9px;background:#fff;overflow:hidden"><div style="height:100%;width:${Math.min(100, p * 100)}%;background:${col}"></div></div>`;

let tab = 'pick', root = null;
const mount = (name, html, bg) => { root = ctx.openCustom(name, html, bg); root.querySelector('#hx').onclick = ctx.back; return root; };
const on = (id, fn) => { const e = root.querySelector('#' + id); if (e) e.onclick = fn; };
const onAll = (sel, fn) => root.querySelectorAll(sel).forEach(e => e.onclick = () => fn(e.dataset));

/* ---------- 출석 체크 ---------- */
export function openAttend() {
  const h = H(), a = h.att, todayDone = !attendReady(), nextDay = (a.n % 28) + 1;
  const cell = d => {
    const done = d <= (a.n % 28 || (a.n && todayDone && a.n % 28 === 0 ? 28 : 0)) && (todayDone ? d <= ((a.n - 1) % 28) + 1 : d <= a.n % 28), isNext = !todayDone && d === nextDay, r = ATT(d);
    const big = d % 7 === 0;
    return `<div style="position:relative;width:132px;height:96px;box-sizing:border-box;border:3px solid #2b1830;border-radius:18px;background:${done ? '#bde8cf' : isNext ? '#fff0b0' : big ? '#ffe4bd' : '#fff'};box-shadow:0 3px 0 #2b1830;${isNext ? 'outline:4px solid #ffb02e;outline-offset:2px;' : ''}${FONT};color:#2b1830;text-align:center">
      <div style="position:absolute;left:8px;top:4px;font-size:15px;opacity:.7">${d}일</div><div style="position:absolute;left:0;right:0;top:26px;font-size:${big ? 30 : 26}px">${big ? '🎁' : r.s ? '🔷' : '🪙'}</div>
      <div style="position:absolute;left:0;right:0;bottom:4px;font-size:12px;line-height:13px">${rtxt(r).split(' · ').join('<br>')}</div>${done ? '<div style="position:absolute;inset:0;border-radius:15px;background:#2b183099;display:flex;align-items:center;justify-content:center;font-size:44px;color:#7dffb0">✔</div>' : ''}</div>`;
  };
  let cells = ''; for (let d = 1; d <= 28; d++) cells += cell(d);
  const html = head('출석 체크', `누적 ${a.n}일 출석 · 28일 주기 · 오늘 보상은 한 번만 받을 수 있어요`, 'linear-gradient(#3a2048,#6a3a78)', true) +
    panel(40, 100, 1200, 590, `<div style="position:absolute;left:30px;top:26px;display:grid;grid-template-columns:repeat(7,132px);gap:10px 18px">${cells}</div>
    <button id="att" ${todayDone ? 'disabled' : ''} style="position:absolute;left:490px;top:462px;width:220px;height:70px;${BTN(todayDone ? '#cfc6d8' : '#ffc233')};font-size:30px">${todayDone ? '오늘 출석 완료' : '출석하기!'}</button>`);
  mount('attend', html, '#3a2048');
  on('att', () => {
    if (!attendReady()) return; const d = (a.n % 28) + 1, r = ATT(d); a.n++; a.last = today(); mi().att = (mi().att || 0) + 1; mi().watt = (mi().watt || 0) + 1; grant({ ...r, x: 20 });
    ctx.api.persist(); ctx.toast(`${d}일차 출석! ${rtxt(r)}`); openAttend();
  });
}

/* ---------- 시즌 패스 ---------- */
export function openPass() {
  const h = H(), p = h.pass, lv = passLevel(), into = lv >= PASS_MAX ? 1 : (p.xp % PASS_XP) / PASS_XP;
  const col = (kind, l) => {
    const r = kind === 'f' ? PASS_FREE(l) : PASS_PREM(l), got = p[kind][l], open = l <= lv && (kind === 'f' || p.prem);
    const bg = got ? '#bde8cf' : open ? '#fff0b0' : kind === 'p' ? '#e9defa' : '#fff';
    return `<button data-k="${kind}" data-l="${l}" style="position:relative;width:132px;height:112px;box-sizing:border-box;padding:6px 4px;border:3px solid #2b1830;border-radius:18px;background:${bg};box-shadow:0 3px 0 #2b1830;${FONT};color:#2b1830;cursor:${open && !got ? 'pointer' : 'default'};${open && !got ? 'outline:3px solid #ffb02e;' : ''}">
      <div style="font-size:26px;line-height:30px">${kind === 'p' ? '👑' : '🎁'}</div><div style="font-size:14px;line-height:17px">${rtxt(r).split(' · ').join('<br>')}</div>
      ${got ? '<div style="position:absolute;inset:0;border-radius:15px;background:#2b183099;color:#7dffb0;font-size:40px;display:flex;align-items:center;justify-content:center">✔</div>' : !open ? `<div style="position:absolute;right:6px;top:4px;font-size:16px">🔒</div>` : ''}</button>`;
  };
  let top = '', bot = '', nums = '';
  for (let l = 1; l <= PASS_MAX; l++) { top += col('p', l); bot += col('f', l); nums += `<div style="width:132px;height:30px;text-align:center;${HAN};font-size:22px;${stroke(5)};opacity:${l <= lv ? 1 : .55}">Lv ${l}</div>`; }
  const html = head(`시즌 ${1} 패스`, `「${'찬란한 지식의 봄'}」 · 경기·미션·출석으로 XP를 모아요 (승리 +40, 패배 +20, 레이드 +30, 출석 +20)`, 'linear-gradient(#2b3a8a,#6f5ad8)', true) +
    panel(40, 100, 1200, 590, `
    <div style="position:absolute;left:24px;top:14px;${HAN};font-size:34px;${stroke(7)}">Lv ${lv}${lv >= PASS_MAX ? ' MAX' : ''}</div>
    <div style="position:absolute;left:150px;top:26px">${bar(into, 420, '#ffb02e')}</div><div style="position:absolute;left:580px;top:22px;${FONT};font-size:18px;color:#2b1830">${lv >= PASS_MAX ? '최대 레벨' : `다음 레벨까지 ${PASS_XP - (p.xp % PASS_XP)} XP`}</div>
    <button id="pall" style="position:absolute;right:226px;top:12px;width:130px;height:46px;${BTN('#5cc8ff')};font-size:20px">모두 받기</button>
    <button id="pprem" style="position:absolute;right:24px;top:12px;width:190px;height:46px;${BTN(p.prem ? '#bde8cf' : '#ffb02e')};font-size:20px">${p.prem ? '프리미엄 활성' : '프리미엄 (준비 중)'}</button>
    <div style="position:absolute;left:0;top:76px;width:1192px;height:500px;overflow-x:auto;overflow-y:hidden"><div style="position:relative;width:${PASS_MAX * 142 + 20}px;padding:6px 12px">
      <div style="${FONT};font-size:18px;margin:2px 0 4px">👑 프리미엄 트랙</div><div style="display:flex;gap:10px">${top}</div>
      <div style="display:flex;gap:10px;margin:10px 0">${nums}</div>
      <div style="${FONT};font-size:18px;margin:2px 0 4px">🎁 무료 트랙</div><div style="display:flex;gap:10px">${bot}</div>
      <div style="${FONT};font-size:15px;margin-top:14px;color:#6b4a63">시즌 1 패스 · 프리미엄은 결제 연동 후 열립니다. (테스트: 설정 → 전체 해금에서 켜져요)</div></div></div>`);
  mount('pass', html, '#2b3a8a');
  const claim = (k, l) => { const r = k === 'f' ? PASS_FREE(l) : PASS_PREM(l); p[k][l] = 1; grant(r); return r; };
  onAll('button[data-k]', d => { const k = d.k, l = +d.l; if (p[k][l] || l > lv || (k === 'p' && !p.prem)) return; ctx.toast('받았어요! ' + rtxt(claim(k, l))); ctx.api.persist(); const sc = root.querySelector('div[style*="overflow-x:auto"]').scrollLeft; openPass(); root.querySelector('div[style*="overflow-x:auto"]').scrollLeft = sc; });
  on('pall', () => { let n = 0; for (let l = 1; l <= lv; l++) { if (!p.f[l]) { claim('f', l); n++; } if (p.prem && !p.p[l]) { claim('p', l); n++; } } if (!n) return ctx.toast('받을 보상이 없어요'); ctx.api.persist(); ctx.toast(`보상 ${n}개를 받았어요`); openPass(); });
  on('pprem', () => ctx.toast(p.prem ? '이미 활성화됐어요' : '프리미엄 결제는 준비 중이에요'));
}

/* ---------- 이벤트: 거짓은 심연을 삼키고 ---------- */
const EVBG = 'radial-gradient(circle at 18% 8%,#2c52e0 0,#10267a 38%,#050a2a 100%)';
export function openEvent(t) {
  if (t) tab = t; const h = H();
  const tabs = [['pick', '픽업 뽑기'], ['quest', '이벤트 퀘스트'], ['raid', '쉐도우밀크 레이드']];
  const dots = { quest: [...EV_DAILY, ...EV_WEEKLY].filter(d => h.q[d.k] >= d.n && !h.q.c[d.id]).length, raid: rewardLeft(SV(), H) === 0 ? 1 : 0 };
  const tb = tabs.map(([k, n], i) => `<button data-t="${k}" style="position:absolute;left:${40 + i * 214}px;top:98px;width:204px;height:48px;${BTN(tab === k ? '#ffc233' : '#ffe4bd')};font-size:21px">${n}${dots[k] ? `<span style="position:absolute;right:-6px;top:-8px;min-width:24px;height:24px;border-radius:12px;background:#ff3b5c;border:3px solid #2b1830;color:#fff;font-size:14px;line-height:18px">${dots[k]}</span>` : ''}</button>`).join('');
  const body = tab === 'pick' ? evPick() : tab === 'quest' ? evQuest() : evRaid();
  mount('event', head('거짓은 심연을 삼키고', '시즌 1 · PART 1 이벤트 — 쉐도우밀크 쿠키 · 퓨어바닐라 쿠키 픽업', EVBG) + tb + panel(40, 160, 1200, 530, body), '#10267a');
  onAll('button[data-t]', d => { tab = d.t; openEvent(); });
  if (tab === 'pick') bindPick(); else if (tab === 'quest') bindQuest(); else bindRaid();
}

function evPick() {
  const S = SV(), h = H(), have = S.unlocked.includes('shadow');
  const card = (name, sub, col, note, tag) => `<div style="position:relative;width:326px;height:290px;box-sizing:border-box;border:4px solid #2b1830;border-radius:22px;overflow:hidden;background:#fff;box-shadow:0 4px 0 #2b1830">
    <div style="height:150px;background:repeating-linear-gradient(45deg,${col[0]} 0,${col[0]} 16px,${col[1]} 16px,${col[1]} 32px);display:flex;align-items:center;justify-content:center;font-size:84px">${tag}</div>
    <div style="padding:10px 14px;${FONT};color:#2b1830"><div style="font-size:26px">${name}</div><div style="font-size:16px;opacity:.75;margin-top:2px">${sub}</div><div style="font-size:15px;margin-top:8px;color:#6b4a63">${note}</div></div>
    <div style="position:absolute;left:10px;top:10px;padding:2px 12px;border:3px solid #2b1830;border-radius:12px;background:#ffb02e;${FONT};font-size:16px">PICK UP</div></div>`;
  return `<div style="position:absolute;left:24px;top:22px;display:flex;gap:18px">${card('쉐도우밀크 쿠키', '비스트 · 암살자', ['#ff5a4d', '#ff9a8c'], have ? '보유 중 (중복 시 코인 3,000 + 조각 30)' : '아직 없어요! 유체이탈 · 쉐도우 스텝', '🌑')}${card('퓨어바닐라 쿠키', '에인션트 · 서포터', ['#ffd873', '#fff3c0'], S.unlocked.includes('pv') ? '보유 중 (중복 시 코인 3,000 + 조각 30)' : '아직 없어요! 보호의 장막 · 다크문', '☀️')}</div>
    <div style="position:absolute;left:24px;top:330px;width:670px;${FONT};font-size:17px;line-height:25px;color:#2b1830">확정: ${PITY}회 안에 반드시 픽업 쿠키가 나와요. (현재 ${h.pity} / ${PITY})<div style="margin-top:6px">${bar(h.pity / PITY, 420, '#ff7a8a')}</div>
      <div style="margin-top:8px;font-size:15px;color:#6b4a63">${SHARD}은 이벤트 퀘스트와 쉐도우밀크 레이드로 모아요.</div></div>
    <div style="position:absolute;left:724px;top:22px;width:448px;height:230px;box-sizing:border-box;border:3px solid #2b1830;border-radius:18px;background:#fff;padding:12px 16px;${FONT};font-size:16px;line-height:24px;color:#2b1830"><b style="font-weight:400;font-size:19px">획득 확률</b><br>픽업 쿠키(쉐도우밀크 · 퓨어바닐라) 2% (각 1%)<br>코인 1,000 · 에픽 8% / 코인 500 · 레어 20%<br>뽑기권 1장 10% / 패스 XP 50 20% / 코인 200 · 커먼 40%<br><span style="font-size:14px;color:#6b4a63">10회 뽑기는 레어 이상 1개 이상이 보장돼요.</span></div>
    <button id="p1" style="position:absolute;left:724px;top:276px;width:216px;height:96px;${BTN('#5cc8ff')};font-size:26px">1회 뽑기<br><span style="font-size:19px">🔷 10</span></button>
    <button id="p10" style="position:absolute;left:956px;top:276px;width:216px;height:96px;${BTN('#ffc233')};font-size:26px">10회 뽑기<br><span style="font-size:19px">🔷 100</span></button>
    <div style="position:absolute;left:724px;top:396px;width:448px;${FONT};font-size:16px;color:#6b4a63">보유 ${SHARD} <b style="color:#2b1830;font-weight:400">${fmt(h.shards)}</b> · 이벤트 뽑기권 대신 조각을 사용해요.</div>`;
}
function bindPick() { on('p1', () => pull(1)); on('p10', () => pull(10)); }
function pull(n) {
  const S = SV(), h = H(), cost = n === 10 ? 100 : 10; if (h.shards < cost) return ctx.toast(`${SHARD}이 부족해요`);
  h.shards -= cost; h.stat.pulls += n; const out = [];
  for (let i = 0; i < n; i++) {
    h.pity++; const r = Math.random() * 100; h.q.pulls++; h.q.wpulls++;
    if (h.pity >= PITY || r < 2) {
      h.pity = 0;
      if (Math.random() < .5) {
        if (S.unlocked.includes('shadow')) { S.coins += 3000; h.shards += 30; out.push({ k: 'c', s: '코인 3,000', sub: '쉐도우밀크 중복 · 조각 +30', g: 7 }); }
        else { S.unlocked.push('shadow'); out.push({ k: 'n', s: '쉐도우밀크 쿠키', sub: '비스트 · 신규', g: 7 }); }
      } else if (S.unlocked.includes('pv')) { S.coins += 3000; h.shards += 30; out.push({ k: 'c', s: '코인 3,000', sub: '퓨어바닐라 중복 · 조각 +30', g: 7 }); }
      else { S.unlocked.push('pv'); out.push({ k: 'n', s: '퓨어바닐라 쿠키', sub: '에인션트 · 신규', g: 7 }); }
    } else if (r < 10) { S.coins += 1000; out.push({ k: 'c', s: '1,000', sub: '코인', g: 3 }); }
    else if (r < 30) { S.coins += 500; out.push({ k: 'c', s: '500', sub: '코인', g: 2 }); }
    else if (r < 40) { S.tickets++; out.push({ k: 'c', s: '뽑기권 x1', sub: '', g: 2 }); }
    else if (r < 60) { addPassXp(50); out.push({ k: 'c', s: '패스 XP', sub: '+50', g: 2 }); }
    else { S.coins += 200; out.push({ k: 'c', s: '200', sub: '코인', g: 1 }); }
  }
  if (n === 10 && !out.some(o => o.g >= 2)) { S.coins += 500; out[9] = { k: 'c', s: '500', sub: '코인', g: 2 }; }
  ctx.api.persist();
  const g = Math.max(...out.map(o => o.g)), cards = out.map((it, i) => `<div style="width:${n > 5 ? 150 : 200}px;height:${n > 5 ? 120 : 150}px;box-sizing:border-box;border:4px solid #2b1830;border-radius:20px;background:${it.k === 'n' ? 'repeating-linear-gradient(45deg,#ffd873 0,#ffd873 14px,#fff3df 14px,#fff3df 28px)' : '#fff3df'};box-shadow:0 5px 0 #2b1830;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;animation:rp .45s ${i * .07}s both;${FONT};color:#2b1830"><b style="font-weight:400;font-size:${it.k === 'n' ? 22 : 28}px;line-height:1.15">${it.s}</b><span style="font-size:14px;margin-top:4px;color:#6b4a63">${it.sub}</span></div>`).join('');
  playGacha(root.firstElementChild.parentElement, out.map(o => o.g), () => {
    const o = document.createElement('div'); o.style.cssText = 'position:absolute;inset:0;z-index:99;background:rgba(5,10,42,.95);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px';
    o.innerHTML = `<style>@keyframes rp{0%{transform:scale(.3) rotate(-8deg);opacity:0}100%{transform:none;opacity:1}}</style><div style="${HAN};font-size:52px;${stroke(8)}">획득!</div><div style="display:flex;flex-wrap:wrap;gap:14px;justify-content:center;max-width:1020px">${cards}</div><button id="ok" style="width:200px;height:64px;${BTN()};font-size:30px">확인</button>`;
    root.appendChild(o); o.querySelector('#ok').onclick = () => { o.remove(); openEvent(); };
  });
}

function evQuest() {
  const h = H(), row = (d, i) => {
    const cur = Math.min(h.q[d.k], d.n), has = h.q.c[d.id], ok = h.q[d.k] >= d.n;
    return `<div style="position:absolute;left:0;top:${i * 82}px;width:560px;height:72px;box-sizing:border-box;border:3px solid #2b1830;border-radius:18px;background:#fff;box-shadow:0 3px 0 #2b1830;${FONT};color:#2b1830">
      <div style="position:absolute;left:16px;top:8px;font-size:20px">${d.t}</div><div style="position:absolute;left:16px;top:38px">${bar(cur / d.n, 230)}</div><div style="position:absolute;left:256px;top:36px;font-size:16px">${cur}/${d.n}</div>
      <div style="position:absolute;left:330px;top:10px;font-size:15px;color:#6b4a63">🔷 ${d.r.s}</div>
      <button data-q="${d.id}" style="position:absolute;right:12px;top:12px;width:112px;height:44px;${BTN(has ? '#bde8cf' : ok ? '#ffc233' : '#e6e0ee')};font-size:19px;${ok && !has ? '' : 'cursor:default'}">${has ? '완료' : ok ? '받기' : '진행 중'}</button></div>`;
  };
  return `<div style="position:absolute;left:24px;top:18px;${HAN};font-size:28px;${stroke(6)}">일일 퀘스트</div><div style="position:absolute;left:24px;top:62px;width:560px;height:360px">${EV_DAILY.map(row).join('')}</div>
    <div style="position:absolute;left:612px;top:18px;${HAN};font-size:28px;${stroke(6)}">주간 퀘스트</div><div style="position:absolute;left:612px;top:62px;width:560px;height:360px">${EV_WEEKLY.map(row).join('')}</div>
    <div style="position:absolute;left:24px;top:446px;${FONT};font-size:16px;color:#6b4a63">${SHARD}은 이벤트 픽업 뽑기에 쓰여요. 일일 퀘스트는 매일, 주간 퀘스트는 매주 초기화돼요.</div>`;
}
function bindQuest() {
  onAll('button[data-q]', d => { const q = [...EV_DAILY, ...EV_WEEKLY].find(x => x.id === d.q), h = H(); if (h.q.c[q.id] || h.q[q.k] < q.n) return; h.q.c[q.id] = 1; grant(q.r); ctx.api.persist(); ctx.toast(`${SHARD} +${q.r.s}`); openEvent(); });
}

function evRaid() {
  const S = SV(), left = rewardLeft(S, H), rd = H().rd, hrs = Math.ceil(left / 36e5);
  const stage = (n, t, d) => `<div style="display:flex;gap:12px;align-items:center;padding:7px 0;border-bottom:2px dashed #d8c8b0"><div style="flex:none;width:34px;height:34px;border:3px solid #2b1830;border-radius:50%;background:#ffc233;text-align:center;line-height:28px;font-size:18px">${n}</div><div><div style="font-size:20px">${t}</div><div style="font-size:14px;color:#6b4a63">${d}</div></div></div>`;
  return `<div style="position:absolute;left:24px;top:22px;width:400px;height:470px;box-sizing:border-box;border:4px solid #2b1830;border-radius:22px;background:radial-gradient(circle at 50% 30%,#4a2fb0,#0a0524);box-shadow:0 4px 0 #2b1830;color:#fff;text-align:center;${FONT}">
      <div style="font-size:110px;margin-top:30px">🗼</div><div style="${HAN};font-size:40px;${stroke(8)};margin-top:4px">거짓의 탑</div><div style="font-size:19px;color:#bcd0ff;margin-top:6px">쉐도우밀크 쿠키 레이드</div>
      <div style="margin:18px 26px 0;font-size:16px;line-height:24px;color:#e6efff">던전 + 미니게임 + 보스전<br>파티 <b style="color:#ffd873">2명 이상</b> 필요<br><span style="color:#9ab4ff">(지금은 AI 동료와 함께 입장)</span></div>
      <div style="margin-top:16px;font-size:18px">누적 클리어 <b style="font-weight:400;color:#ffd873">${rd.clears}</b>회</div></div>
    <div style="position:absolute;left:450px;top:20px;width:720px;${FONT};color:#2b1830"><div style="${HAN};font-size:28px;${stroke(6)};margin-bottom:4px">관문</div>
      ${stage(1, '거짓의 군주', '압도적인 체력과 공격력의 쉐도우밀크 쿠키 — 이길 수 없다')}${stage(2, '부활의 요거트강', '거짓(틀린 답)으로 10문제에 답해 강을 건너기')}${stage(3, '거짓의 체스', '조종자와 체스말 — 지면 체스말만 쓰러진다')}${stage(4, '거짓의 타로', '카드 짝 맞추기')}${stage(5, '거짓의 동굴', '던전 + 쉐도우밀크 보스(HP 2,000,000), 퓨어바닐라가 주기적으로 치유')}</div>
    <div style="position:absolute;left:450px;top:400px;width:720px;${FONT};color:#2b1830;font-size:17px;line-height:25px">보상: 클리어 시 <b style="font-weight:400">${SHARD} 100</b>(이벤트 뽑기 10회분)+코인 2,000 · 던전에서 지면 조각 30 · <b style="font-weight:400">24시간마다</b> 한 번</div>
    <button id="rgo" style="position:absolute;left:450px;top:458px;width:720px;height:54px;${BTN('#ff7a8a')};font-size:26px">${left ? `거짓의 탑 입장 (보상은 ${hrs}시간 뒤에 다시 받을 수 있어요)` : '거짓의 탑 입장하기!'}</button>`;
}
function bindRaid() {
  on('rgo', async () => { await runRaid({ api: ctx.api, H, grant }); openEvent('raid'); });
}

/* ================= 프로필 · 랭크 · 트로피 로드 · 업적 · 친구 ================= */
// 랭크는 보유한 모든 쿠키의 트로피 합계로 정해진다 (승리 +8 / 패배 -4, 쿠키별 기록).
export const RANKS = [
  { n: '브론즈', at: 0, c: '#c98a58', e: '🥉' }, { n: '실버', at: 100, c: '#c6d0dc', e: '🥈' }, { n: '골드', at: 300, c: '#ffc233', e: '🥇' },
  { n: '플래티넘', at: 600, c: '#5fe0d0', e: '💠' }, { n: '다이아', at: 1000, c: '#6fb8ff', e: '💎' }, { n: '마스터', at: 1600, c: '#b57cff', e: '🔮' }, { n: '레전드', at: 2500, c: '#ff5a4d', e: '👑' },
];
const TROPHY_ROAD = [20, 50, 100, 150, 200, 300, 400, 500, 650, 800, 1000, 1250, 1600, 2000, 2500].map((n, i) => ({
  n, r: RANKS.some(k => k.at === n) ? { g: 100, t: 2, s: 50 } : [{ c: 500 }, { s: 20 }, { c: 800 }, { t: 1 }][i % 4],
}));
const ACHS = [
  { id: 'a1', t: '첫 승리', k: 'wins', n: 1, r: { c: 300 } }, { id: 'a2', t: '10승 달성', k: 'wins', n: 10, r: { c: 1000 } }, { id: 'a3', t: '50승 달성', k: 'wins', n: 50, r: { g: 100, t: 2 } },
  { id: 'a4', t: '100승 달성', k: 'wins', n: 100, r: { g: 300, t: 5 } }, { id: 'a5', t: '경기 30회 플레이', k: 'plays', n: 30, r: { c: 1000 } }, { id: 'a6', t: '경기 100회 플레이', k: 'plays', n: 100, r: { g: 100, c: 2000 } },
  { id: 'a7', t: '쿠키 3종 보유', k: 'owned', n: 3, r: { c: 500 } }, { id: 'a8', t: '쿠키 전부 모으기', k: 'owned', n: 5, r: { g: 200, t: 3 } }, { id: 'a9', t: '뽑기 30회', k: 'pulls', n: 30, r: { t: 3 } },
  { id: 'a10', t: '레이드 10회 도전', k: 'raids', n: 10, r: { s: 100 } }, { id: 'a11', t: '레이드 최고 피해 100,000', k: 'raidBest', n: 100000, r: { s: 80, g: 50 } }, { id: 'a12', t: '출석 7일', k: 'att', n: 7, r: { t: 2 } },
  { id: 'a13', t: '출석 28일', k: 'att', n: 28, r: { g: 200 } }, { id: 'a14', t: '패스 Lv 10', k: 'passLv', n: 10, r: { s: 60 } }, { id: 'a15', t: '트로피 500', k: 'trophy', n: 500, r: { g: 100 } }, { id: 'a16', t: '플래티넘 랭크', k: 'trophy', n: 600, r: { g: 150, t: 2 } },
];
export const totalTrophy = () => Object.values(SV().tro || {}).reduce((a, b) => a + b, 0);
export const rankOf = (t = totalTrophy()) => { let r = RANKS[0]; for (const k of RANKS) if (t >= k.at) r = k; return r; };
export function hubStat(k, n = 1) { const h = H(); h.stat[k] = (h.stat[k] || 0) + n; }
const achVal = k => { const S = SV(), h = H(); return k === 'wins' ? S.totalWins : k === 'plays' ? h.stat.plays : k === 'owned' ? S.unlocked.length : k === 'pulls' ? h.stat.pulls : k === 'raids' ? h.stat.raids : k === 'raidBest' ? h.raid.best : k === 'att' ? h.att.n : k === 'passLv' ? passLevel() : totalTrophy(); };
export const profileBadge = () => { const h = H(); return ACHS.filter(a => achVal(a.k) >= a.n && !h.ac[a.id]).length + TROPHY_ROAD.filter(x => totalTrophy() >= x.n && !h.tc[x.n]).length; };

let ptab = 'info';
export function openProfile(t) {
  if (t) ptab = t; const S = SV(), h = H(), tt = totalTrophy(), rk = rankOf(tt), nx = RANKS.find(k => k.at > tt);
  const tabs = [['info', '내 정보'], ['road', '트로피 로드'], ['ach', '업적'], ['friend', '친구']];
  const dot = { road: TROPHY_ROAD.filter(x => tt >= x.n && !h.tc[x.n]).length, ach: ACHS.filter(a => achVal(a.k) >= a.n && !h.ac[a.id]).length };
  const tb = tabs.map(([k, n], i) => `<button data-p="${k}" style="position:absolute;left:${40 + i * 190}px;top:98px;width:180px;height:48px;${BTN(ptab === k ? '#ffc233' : '#ffe4bd')};font-size:21px">${n}${dot[k] ? `<span style="position:absolute;right:-6px;top:-8px;min-width:24px;height:24px;border-radius:12px;background:#ff3b5c;border:3px solid #2b1830;color:#fff;font-size:14px;line-height:18px">${dot[k]}</span>` : ''}</button>`).join('');
  let body = '';
  if (ptab === 'info') {
    const wins = S.totalWins, plays = h.stat.plays, best = Object.entries(S.tro || {}).sort((a, b) => b[1] - a[1])[0];
    const st = (l, v) => `<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:2px dashed #d8c8b0;${FONT};font-size:20px;color:#2b1830"><span>${l}</span><b style="font-weight:400">${v}</b></div>`;
    body = `<div style="position:absolute;left:24px;top:22px;width:420px;height:470px;box-sizing:border-box;border:4px solid #2b1830;border-radius:22px;background:linear-gradient(${rk.c},#fff3df);box-shadow:0 4px 0 #2b1830;text-align:center;${FONT};color:#2b1830">
        <div style="font-size:110px;margin-top:28px">${rk.e}</div><div style="${HAN};font-size:46px;${stroke(8)}">${rk.n}</div><div style="font-size:24px;margin-top:6px">🏆 ${fmt(tt)}</div>
        <div style="margin:18px 40px 0">${bar(nx ? (tt - rk.at) / (nx.at - rk.at) : 1, 340, rk.c)}</div><div style="font-size:16px;margin-top:8px">${nx ? `다음 랭크 ${nx.n}까지 🏆 ${nx.at - tt}` : '최고 랭크예요!'}</div>
        <div style="margin-top:16px;font-size:15px;color:#6b4a63;padding:0 26px">랭크는 모든 쿠키의 트로피 합계로 정해져요.<br>승리 +8 · 패배 -4</div></div>
      <div style="position:absolute;left:470px;top:22px;width:700px"><div style="display:flex;align-items:center;gap:12px;margin-bottom:14px"><div style="${HAN};font-size:34px;${stroke(6)}">${nickOf()}</div><button id="nickb" style="width:110px;height:40px;${BTN('#ffc233')};font-size:18px">이름 변경</button></div><div style="${HAN};font-size:28px;${stroke(6)};margin-bottom:6px">전적</div>
        ${st('총 승리', fmt(wins))}${st('플레이한 경기', fmt(plays))}${st('승률', plays ? Math.round(wins / plays * 100) + '%' : '-')}${st('보유 쿠키', `${S.unlocked.length} / 6`)}${st('가장 높은 쿠키', best ? `${ctx.api.CHARS[best[0]].name} 🏆 ${best[1]}` : '-')}${st('레이드 최고 피해', fmt(h.raid.best))}${st('출석 일수', h.att.n + '일')}${st('시즌 패스', 'Lv ' + passLevel())}</div>`;
  } else if (ptab === 'road') {
    const node = x => {
      const ok = tt >= x.n, got = h.tc[x.n], isRank = RANKS.find(k => k.at === x.n);
      return `<button data-tr="${x.n}" style="position:relative;flex:none;width:150px;height:200px;box-sizing:border-box;padding:8px 6px;border:3px solid #2b1830;border-radius:20px;background:${got ? '#bde8cf' : ok ? '#fff0b0' : isRank ? '#e9defa' : '#fff'};box-shadow:0 4px 0 #2b1830;${FONT};color:#2b1830;cursor:${ok && !got ? 'pointer' : 'default'};${ok && !got ? 'outline:4px solid #ffb02e;' : ''}">
        <div style="font-size:20px">🏆 ${fmt(x.n)}</div><div style="font-size:${isRank ? 44 : 38}px;margin:14px 0 8px">${isRank ? isRank.e : '🎁'}</div>${isRank ? `<div style="font-size:16px">${isRank.n} 랭크</div>` : ''}
        <div style="font-size:14px;line-height:17px;margin-top:4px">${rtxt(x.r).split(' · ').join('<br>')}</div>${got ? '<div style="position:absolute;inset:0;border-radius:17px;background:#2b183099;color:#7dffb0;font-size:46px;display:flex;align-items:center;justify-content:center">✔</div>' : !ok ? '<div style="position:absolute;right:8px;top:6px;font-size:16px">🔒</div>' : ''}</button>`;
    };
    body = `<div style="position:absolute;left:24px;top:14px;${HAN};font-size:30px;${stroke(6)}">트로피 로드  <span style="font-size:22px">🏆 ${fmt(tt)}</span></div>
      <button id="trall" style="position:absolute;right:24px;top:12px;width:150px;height:46px;${BTN('#5cc8ff')};font-size:20px">모두 받기</button>
      <div style="position:absolute;left:0;top:76px;width:1192px;height:430px;overflow-x:auto"><div style="display:flex;gap:14px;padding:30px 24px;width:${TROPHY_ROAD.length * 164 + 40}px">${TROPHY_ROAD.map(node).join('')}</div></div>`;
  } else if (ptab === 'ach') {
    const row = (a, i) => {
      const v = achVal(a.k), cur = Math.min(v, a.n), ok = v >= a.n, got = h.ac[a.id];
      return `<div style="position:absolute;left:${(i % 2) * 590}px;top:${Math.floor(i / 2) * 58}px;width:570px;height:52px;box-sizing:border-box;border:3px solid #2b1830;border-radius:16px;background:#fff;box-shadow:0 3px 0 #2b1830;${FONT};color:#2b1830">
        <div style="position:absolute;left:14px;top:4px;font-size:18px">${a.t}</div><div style="position:absolute;left:14px;top:30px;width:200px;height:12px;border:2px solid #2b1830;border-radius:6px;background:#eee;overflow:hidden"><div style="height:100%;width:${cur / a.n * 100}%;background:#3ddbb0"></div></div>
        <div style="position:absolute;left:224px;top:26px;font-size:13px;color:#6b4a63">${fmt(cur)} / ${fmt(a.n)}</div><div style="position:absolute;left:330px;top:8px;font-size:14px;line-height:16px;color:#6b4a63;width:130px">${rtxt(a.r)}</div>
        <button data-ac="${a.id}" style="position:absolute;right:8px;top:6px;width:96px;height:36px;${BTN(got ? '#bde8cf' : ok ? '#ffc233' : '#e6e0ee')};font-size:16px;${ok && !got ? '' : 'cursor:default'}">${got ? '완료' : ok ? '받기' : '진행 중'}</button></div>`;
    };
    body = `<div style="position:absolute;left:24px;top:18px;width:1160px;height:480px;overflow-y:auto"><div style="position:relative;height:${Math.ceil(ACHS.length / 2) * 58}px">${ACHS.map(row).join('')}</div></div>`;
  } else {
    const code = (S.fcode = S.fcode || 'WB-' + Math.random().toString(36).slice(2, 8).toUpperCase());
    body = `<div style="position:absolute;left:24px;top:30px;width:1150px;${FONT};color:#2b1830"><div style="${HAN};font-size:30px;${stroke(6)}">친구</div>
      <div style="margin-top:16px;font-size:22px">내 친구 코드  <b style="font-weight:400;padding:6px 18px;border:3px solid #2b1830;border-radius:14px;background:#fff">${code}</b></div>
      <div style="margin-top:22px;display:flex;gap:10px"><input disabled placeholder="친구 코드 입력" style="width:300px;height:46px;border:3px solid #2b1830;border-radius:14px;padding:0 14px;font-size:18px;${FONT}"><button disabled style="width:120px;height:46px;${BTN('#cfc6d8')};font-size:20px;cursor:default">친구 추가</button></div>
      <div style="margin-top:30px;padding:26px;border:3px dashed #b8a8c8;border-radius:20px;font-size:19px;line-height:30px;color:#6b4a63">친구 목록 · 친구 대전 · 선물은 <b style="color:#2b1830;font-weight:400">서버가 열려야</b> 사용할 수 있어요.<br>(온라인 대전과 같이 열려요.)</div></div>`;
  }
  mount('profile', head('프로필', `${rk.e} ${rk.n} · 🏆 ${fmt(tt)}`, 'linear-gradient(#3a2048,#7a4a98)', false) + tb + panel(40, 160, 1200, 530, body), '#3a2048');
  onAll('button[data-p]', d => { ptab = d.p; openProfile(); });
  on('nickb', () => askNick(() => openProfile()));
  const rewardRoad = n => { const x = TROPHY_ROAD.find(y => y.n === +n); h.tc[x.n] = 1; grant(x.r); return x.r; };
  onAll('button[data-tr]', d => { const x = TROPHY_ROAD.find(y => y.n === +d.tr); if (h.tc[x.n] || tt < x.n) return; ctx.toast('받았어요! ' + rtxt(rewardRoad(x.n))); ctx.api.persist(); const sc = root.querySelector('div[style*="overflow-x:auto"]'); const l = sc ? sc.scrollLeft : 0; openProfile(); const s2 = root.querySelector('div[style*="overflow-x:auto"]'); if (s2) s2.scrollLeft = l; });
  on('trall', () => { let n = 0; for (const x of TROPHY_ROAD) if (tt >= x.n && !h.tc[x.n]) { rewardRoad(x.n); n++; } if (!n) return ctx.toast('받을 보상이 없어요'); ctx.api.persist(); ctx.toast(`보상 ${n}개를 받았어요`); openProfile(); });
  onAll('button[data-ac]', d => { const a = ACHS.find(y => y.id === d.ac); if (h.ac[a.id] || achVal(a.k) < a.n) return; h.ac[a.id] = 1; grant(a.r); ctx.api.persist(); ctx.toast('업적 달성! ' + rtxt(a.r)); openProfile(); });
}
