// 레이드 「거짓의 탑」: 컷씬 → 보스전(깰 수 없음) → 요거트강(거짓으로 답하기) → 체스 → 타로 카드 짝맞추기 → 거짓의 동굴(던전) → 쉐도우밀크 보스전 → 결말.
// 원래는 2명 이상의 파티가 필요하다. 서버가 아직 없어서 지금은 "AI 동료"와 함께 진행한다(역할이 나뉘는 미니게임에서 동료가 나머지 역할을 맡음).
import { Chess } from 'chess.js';
import { portraitImg } from './portrait.js';

const FONT = "font-family:'Jua','Noto Sans KR',sans-serif";
const HAN = "font-family:'Black Han Sans','Jua',sans-serif";
const BTN = (bg = '#ffc233') => `border:4px solid #2b1830;border-radius:20px;background:${bg};box-shadow:inset 0 -6px 0 rgba(0,0,0,.18),0 5px 0 #2b1830;${FONT};color:#2b1830;cursor:pointer`;
const wait = ms => new Promise(r => setTimeout(r, ms));
const pickN = (arr, n) => [...arr].sort(() => Math.random() - .5).slice(0, n);
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

let ov, stage, ctx, onResize, errH;
function mount() {
  ov = document.createElement('div'); ov.style.cssText = 'position:fixed;inset:0;z-index:150;background:#05030f;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:manipulation;pointer-events:auto';
  stage = document.createElement('div'); stage.style.cssText = `position:absolute;left:0;top:0;width:1280px;height:720px;transform-origin:0 0;overflow:hidden;${FONT};color:#fff`;
  ov.appendChild(stage); document.body.appendChild(ov);
  onResize = () => { const s = Math.min(innerWidth / 1280, innerHeight / 720); stage.style.transform = `translate(${(innerWidth - 1280 * s) / 2}px,${(innerHeight - 720 * s) / 2}px) scale(${s})`; };
  addEventListener('resize', onResize); onResize();
  // 비상 탈출: 화면이 멈추거나 검게 막혔을 때(특히 모바일) 눌러서 레이드를 나간다. 스크립트 오류가 나도 자동으로 안내한다.
  const esc = document.createElement('button'); esc.textContent = '✕ 나가기'; esc.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:5;padding:6px 12px;border:2px solid #fff6;border-radius:14px;background:#0008;color:#fff9;font:700 14px sans-serif;touch-action:manipulation'; esc.onclick = e => { e.stopPropagation(); if (confirm('레이드를 중단하고 나갈까요?')) location.reload(); }; ov.appendChild(esc);
  errH = ev => { if (ov && !ov.querySelector('#rderr')) { const d = document.createElement('div'); d.id = 'rderr'; d.style.cssText = 'position:absolute;inset:0;z-index:9;background:#05030ff0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;color:#fff;font:700 22px sans-serif;text-align:center'; d.innerHTML = '문제가 생겼어요<br><span style="font-size:14px;opacity:.7">' + String((ev && (ev.message || (ev.reason && ev.reason.message))) || '').slice(0, 120) + '</span>'; const b = document.createElement('button'); b.textContent = '나가기'; b.style.cssText = 'padding:12px 30px;font:900 22px sans-serif;border-radius:16px;border:3px solid #2b1830;background:#ffc233;touch-action:manipulation'; b.onclick = () => location.reload(); d.appendChild(b); ov.appendChild(d); } };
  addEventListener('error', errH); addEventListener('unhandledrejection', errH);
}
const unmount = () => { removeEventListener('resize', onResize); errH && (removeEventListener('error', errH), removeEventListener('unhandledrejection', errH)); ov && ov.remove(); ov = null; };
const hideOv = on => { if (ov) ov.style.display = on ? 'none' : 'block'; };
const CSS = `<style>
@keyframes zoomT{from{transform:scale(1)}to{transform:scale(3.2)}}@keyframes fadeIn{from{opacity:0}to{opacity:1}}@keyframes floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-14px)}}
@keyframes sink{to{transform:translateY(120px);opacity:0}}@keyframes shk{0%,100%{transform:translateX(0)}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}.rb{animation:pulse 1s infinite}
</style>`;

/* ---------- 컷씬 ---------- */
const BG = {
  tower: 'radial-gradient(circle at 50% 70%,#3a2a8a 0,#120a3a 55%,#04010f 100%)',
  inside: 'radial-gradient(circle at 50% 40%,#4a1f7a 0,#1a0a3a 60%,#05010f 100%)',
  river: 'linear-gradient(#3a1f5a,#8a6aa8 55%,#f4e6f0 56%,#e8d4e6)',
  tarot: 'radial-gradient(circle at 50% 40%,#5a1f6a 0,#220a3a 60%,#05010f 100%)',
  cave: 'linear-gradient(#10152a,#2a1f3a 60%,#0a0818)',
  end: 'radial-gradient(circle at 50% 40%,#8a3aa8 0,#2a0a4a 60%,#05010f 100%)',
};
const portrait = (x, y, w, h, flip) => portraitImg('shadow', flip ? -.4 : .4, `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;object-fit:contain;filter:drop-shadow(0 12px 18px #0008)`);
const TOWER = `<svg viewBox="0 0 200 400" width="260" height="520" style="position:absolute;left:510px;top:60px"><defs><linearGradient id="tw" x1="0" x2="1"><stop offset="0" stop-color="#2a1a6a"/><stop offset=".5" stop-color="#4a3aa8"/><stop offset="1" stop-color="#1a0f4a"/></linearGradient></defs>
<path d="M70 400 L78 120 L100 20 L122 120 L130 400Z" fill="url(#tw)" stroke="#0a0624" stroke-width="4"/><path d="M60 250 h80 M64 200 h72 M70 150 h60 M72 300 h56 M66 350 h68" stroke="#7a6af0" stroke-width="3" opacity=".5"/>
<ellipse cx="100" cy="46" rx="10" ry="16" fill="#9ee0ff"/><rect x="90" y="330" width="20" height="70" rx="10" fill="#ffe08a"/><g fill="#9ee0ff"><circle cx="100" cy="190" r="7"/><circle cx="100" cy="240" r="7"/></g></svg>`;
function cutscene({ bg = 'inside', who = '쉐도우밀크 쿠키', lines, intro }) {
  return new Promise(async res => {
    let done = false; const fin = () => { if (!done) { done = true; res(); } };
    if (intro) {   // 거짓의 탑 안으로 들어가는 연출
      stage.innerHTML = CSS + `<div style="position:absolute;inset:0;background:${BG.tower}"></div><div style="position:absolute;inset:0;transform-origin:50% 62%;animation:zoomT 3.4s ease-in forwards">${TOWER}</div>
        <div style="position:absolute;left:0;right:0;top:46px;text-align:center;${HAN};font-size:64px;color:#fff;-webkit-text-stroke:10px #1a0f4a;paint-order:stroke fill;animation:fadeIn 1.2s both">거짓의 탑</div>
        <button id="sk" style="position:absolute;right:20px;top:18px;width:150px;height:44px;${BTN('#fff3df')};font-size:19px">건너뛰기 ▶▶</button>`;
      stage.querySelector('#sk').onclick = fin; await wait(3400); if (done) return;
      stage.innerHTML = '<div style="position:absolute;inset:0;background:#fff;animation:fadeIn .25s reverse both"></div>'; await wait(350);
    }
    if (done) return;
    stage.innerHTML = CSS + `<div style="position:absolute;inset:0;background:${BG[bg] || BG.inside};animation:fadeIn .5s both"></div>
      ${['👁', '👁', '👁', '🌙', '✦'].map((e, i) => `<div style="position:absolute;left:${80 + i * 240}px;top:${70 + (i % 2) * 90}px;font-size:${34 + (i % 3) * 14}px;opacity:.35;animation:floaty ${3 + i * .5}s ease-in-out infinite">${e}</div>`).join('')}
      <div style="position:absolute;left:0;top:0;width:1280px;height:720px">${portrait(430, 90, 420, 560)}</div>
      <div id="box" style="position:absolute;left:90px;right:90px;bottom:36px;height:170px;box-sizing:border-box;padding:18px 28px;border:4px solid #fff3df;border-radius:26px;background:#150a2ae8;box-shadow:0 8px 0 rgba(0,0,0,.4)">
        <div style="position:absolute;left:26px;top:-22px;padding:2px 22px;border:4px solid #fff3df;border-radius:16px;background:#6a3ad8;${HAN};font-size:24px">${who}</div>
        <div id="tx" style="margin-top:14px;font-size:27px;line-height:38px;color:#fff"></div><div class="rb" style="position:absolute;right:24px;bottom:12px;font-size:24px">▶</div></div>
      <button id="sk" style="position:absolute;right:20px;top:18px;width:150px;height:44px;${BTN('#fff3df')};font-size:19px">건너뛰기 ▶▶</button>`;
    stage.querySelector('#sk').onclick = e => { e.stopPropagation(); fin(); };
    const tx = stage.querySelector('#tx'); let i = 0, typing = false, tm;
    const type = () => { const t = lines[i]; let k = 0; typing = true; clearInterval(tm); tm = setInterval(() => { tx.textContent = t.slice(0, ++k); if (k >= t.length) { clearInterval(tm); typing = false; } }, 34); };
    stage.querySelector('#box').parentElement.onclick = () => { if (done) return; if (typing) { clearInterval(tm); tx.textContent = lines[i]; typing = false; return; } if (++i >= lines.length) return fin(); type(); };
    type();
  });
}

/* ---------- 공통 화면 ---------- */
function banner(title, sub, ms = 1800) {
  stage.innerHTML = CSS + `<div style="position:absolute;inset:0;background:${BG.inside}"></div><div style="position:absolute;left:0;right:0;top:250px;text-align:center;animation:fadeIn .6s both"><div style="${HAN};font-size:30px;color:#bda4ff">${sub}</div><div style="${HAN};font-size:72px;color:#fff;-webkit-text-stroke:10px #1a0f4a;paint-order:stroke fill;margin-top:8px">${title}</div></div>`;
  return wait(ms);
}
function panelScreen(title, sub, lines, btnText, bg = BG.inside) {
  return new Promise(res => {
    stage.innerHTML = CSS + `<div style="position:absolute;inset:0;background:${bg}"></div><div style="position:absolute;left:240px;top:110px;width:800px;box-sizing:border-box;padding:34px 40px;border:5px solid #2b1830;border-radius:32px;background:#fff3df;color:#2b1830;box-shadow:0 8px 0 rgba(0,0,0,.4);text-align:center">
      <div style="${HAN};font-size:52px;-webkit-text-stroke:0">${title}</div><div style="font-size:24px;color:#6b4a63;margin-top:6px">${sub}</div>
      <div style="margin:22px 0;font-size:23px;line-height:36px;text-align:left">${lines.join('<br>')}</div><button id="ok" style="width:260px;height:68px;${BTN()};font-size:30px">${btnText}</button></div>`;
    stage.querySelector('#ok').onclick = () => res();
  });
}

/* ---------- 1. 요거트강: 거짓으로 답해야 뜬다 ---------- */
const FACTS = [
  ['대한민국의 수도는?', '서울', ['부산', '도쿄', '평양']], ['물이 어는 온도(섭씨)는?', '0도', ['10도', '-10도', '100도']], ['지구에서 가장 큰 바다는?', '태평양', ['대서양', '인도양', '북극해']],
  ['무지개는 몇 가지 색?', '7가지', ['5가지', '6가지', '9가지']], ['1년은 몇 개월?', '12개월', ['10개월', '11개월', '13개월']], ['거미의 다리는 몇 개?', '8개', ['6개', '4개', '10개']],
  ['태양계에서 가장 큰 행성은?', '목성', ['토성', '지구', '화성']], ['달은 지구의 무엇?', '위성', ['행성', '항성', '혜성']], ['1시간은 몇 분?', '60분', ['30분', '100분', '90분']],
  ['삼각형의 변은 몇 개?', '3개', ['4개', '5개', '6개']], ['고래는 어떤 동물?', '포유류', ['어류', '파충류', '조류']], ['한글을 만든 왕은?', '세종대왕', ['태조', '정조', '광개토대왕']],
  ['피자는 어느 나라 음식?', '이탈리아', ['일본', '프랑스', '멕시코']], ['물의 화학식은?', 'H2O', ['CO2', 'O2', 'NaCl']], ['일주일은 며칠?', '7일', ['5일', '6일', '8일']],
  ['가장 빠른 육상 동물은?', '치타', ['사자', '말', '코끼리']], ['낮 하늘에서 가장 밝은 천체는?', '태양', ['달', '별', '혜성']], ['체스에서 가장 중요한 말은?', '킹', ['폰', '룩', '나이트']],
  ['축구 한 팀의 경기장 선수는?', '11명', ['9명', '12명', '15명']], ['지구가 태양을 한 바퀴 도는 데 걸리는 시간은?', '1년', ['1주일', '1달', '10년']],
  ['사람의 손가락은 한 손에 몇 개?', '5개', ['4개', '6개', '10개']], ['빨강과 파랑을 섞으면?', '보라', ['초록', '노랑', '검정']], ['달걀은 어떤 동물이 낳을까?', '닭', ['개', '고양이', '소']],
  ['쿠키의 주된 재료는?', '밀가루', ['소금', '돌', '모래']], ['겨울 다음 계절은?', '봄', ['여름', '가을', '겨울']],
];
function makeQuestions() {
  const qs = pickN(FACTS, 6).map(([q, c, w]) => ({ q, c, o: [c, ...pickN(w, 2)].sort(() => Math.random() - .5) }));
  while (qs.length < 10) {
    const a = rint(3, 19), b = rint(3, 19), mul = Math.random() < .5, c = mul ? a * b : a + b, wr = new Set();
    while (wr.size < 2) { const d = rint(1, 9) * (Math.random() < .5 ? -1 : 1); if (c + d !== c) wr.add(c + d); }
    qs.push({ q: `${a} ${mul ? '×' : '+'} ${b} = ?`, c: String(c), o: [String(c), ...[...wr].map(String)].sort(() => Math.random() - .5) });
  }
  return qs.sort(() => Math.random() - .5);
}
function yogurt() {
  return new Promise(res => {
    const qs = makeQuestions(); let i = 0, tick;
    const draw = () => {
      const q = qs[i], pct = i / 10 * 100;
      stage.innerHTML = CSS + `<div style="position:absolute;inset:0;background:${BG.river}"></div>
        <div style="position:absolute;left:0;top:250px;width:1280px;height:34px;background:#8a5a3a;border-top:6px solid #2b1830;border-bottom:6px solid #2b1830"></div>
        <div style="position:absolute;left:${60 + pct * 10.4}px;top:176px;font-size:70px;transition:left .8s">🍪</div><div style="position:absolute;left:${60 + pct * 10.4}px;top:150px;font-size:18px;color:#fff;-webkit-text-stroke:4px #2b1830;paint-order:stroke fill">AI 동료 (다리)</div>
        <div id="me" style="position:absolute;left:${60 + pct * 10.4}px;top:330px;font-size:70px;transition:left .8s;animation:floaty 1.6s ease-in-out infinite">🍪</div><div style="position:absolute;left:${60 + pct * 10.4}px;top:430px;font-size:18px;color:#2b1830">나 (요거트강)</div>
        <div style="position:absolute;left:0;top:40px;width:1280px;text-align:center;${HAN};font-size:46px;-webkit-text-stroke:8px #2b1830;paint-order:stroke fill">부활의 요거트강  ${i + 1} / 10</div>
        <div style="position:absolute;left:0;top:104px;width:1280px;text-align:center;font-size:23px;color:#ffe0ff">진리를 외치면 가라앉아요! <b style="color:#ff8aa8">틀린 답(거짓)</b>을 골라야 떠서 건널 수 있어요.</div>
        <div style="position:absolute;left:240px;top:470px;width:800px;box-sizing:border-box;padding:16px 26px;border:5px solid #2b1830;border-radius:28px;background:#fff3df;color:#2b1830;text-align:center">
          <div style="font-size:30px">${q.q}</div><div style="display:flex;gap:16px;justify-content:center;margin-top:14px">${q.o.map((o, k) => `<button data-k="${k}" style="min-width:210px;height:62px;padding:0 14px;${BTN('#fff')};font-size:28px">${o}</button>`).join('')}</div>
          <div style="margin:12px auto 0;width:600px;height:14px;border:3px solid #2b1830;border-radius:8px;background:#eee;overflow:hidden"><div id="tm" style="height:100%;width:100%;background:#ff7a8a;transition:width 15s linear"></div></div></div>`;
      requestAnimationFrame(() => requestAnimationFrame(() => { const t = stage.querySelector('#tm'); if (t) t.style.width = '0'; }));
      let over = false; clearTimeout(tick);
      const lose = why => { if (over) return; over = true; clearTimeout(tick); const me = stage.querySelector('#me'); if (me) me.style.animation = 'sink 1.1s ease-in forwards'; stage.insertAdjacentHTML('beforeend', `<div style="position:absolute;left:0;right:0;top:320px;text-align:center;${HAN};font-size:60px;color:#fff;-webkit-text-stroke:10px #2b1830;paint-order:stroke fill;animation:fadeIn .5s both">${why}</div>`); setTimeout(() => res(false), 2200); };
      tick = setTimeout(() => lose('시간 초과… 가라앉았다!'), 15000);
      stage.querySelectorAll('button[data-k]').forEach(b => b.onclick = () => {
        if (over) return; const picked = q.o[+b.dataset.k];
        if (picked === q.c) return lose('진리를 외쳤다… 가라앉는다!');
        over = true; clearTimeout(tick); b.style.background = '#bde8cf'; i++;
        setTimeout(() => { if (i >= 10) { stage.querySelector('#me').style.left = '1100px'; setTimeout(() => res(true), 1000); } else draw(); }, 700);
      });
    };
    draw();
  });
}

/* ---------- 2. 체스: 조종자 + 체스말 ---------- */
const PIECE = { p: ['♙', '♟'], n: ['♘', '♞'], b: ['♗', '♝'], r: ['♖', '♜'], q: ['♕', '♛'], k: ['♔', '♚'] };
const VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
function evalBoard(ch) { let s = 0; for (const row of ch.board()) for (const p of row) if (p) s += (p.color === 'b' ? 1 : -1) * VAL[p.type]; return s; }
function aiMove(ch) {   // 깊이 2 탐색 (약간 랜덤) — 이길 수 있는 난이도
  let best = null, bv = -1e9;
  for (const m of ch.moves({ verbose: true })) {
    ch.move(m); let v;
    if (ch.isCheckmate()) v = 1e6; else { let worst = 1e9; for (const r of ch.moves({ verbose: true })) { ch.move(r); worst = Math.min(worst, ch.isCheckmate() ? -1e6 : evalBoard(ch)); ch.undo(); } v = worst === 1e9 ? 0 : worst; }
    ch.undo(); v += Math.random() * 60; if (v > bv) { bv = v; best = m; }
  }
  return best;
}
function chess(fen) {
  return new Promise(res => {
    const ch = fen ? new Chess(fen) : new Chess(); let sel = null, lie = false, over = false, kingClicks = [], lost = false;
    const sq = (r, c) => 'abcdefgh'[c] + (8 - r);
    const draw = (msg, extra = '') => {
      const legal = sel ? ch.moves({ square: sel, verbose: true }).map(m => m.to) : [];
      let cells = '';
      ch.board().forEach((row, r) => row.forEach((p, c) => {
        const s = sq(r, c), dark = (r + c) % 2, on = sel === s, hint = legal.includes(s);
        cells += `<div data-s="${s}" style="width:72px;height:72px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:52px;line-height:1;cursor:pointer;background:${on ? '#ffe066' : hint ? '#a6f0b8' : dark ? '#8a5a8a' : '#f0dcf0'};${lie && p && p.color === 'w' ? 'box-shadow:inset 0 0 0 4px #ff3b8a;' : ''}color:${p && p.color === 'w' ? '#fff' : '#1a0a2a'};text-shadow:${p && p.color === 'w' ? '0 0 3px #1a0a2a,0 0 3px #1a0a2a,0 0 3px #1a0a2a' : '0 0 2px #fff'}">${p ? PIECE[p.type][p.color === 'w' ? 0 : 1] : ''}</div>`;
      }));
      stage.innerHTML = CSS + `<div style="position:absolute;inset:0;background:${BG.tarot}"></div>
        <div style="position:absolute;left:30px;top:20px;${HAN};font-size:44px;-webkit-text-stroke:8px #1a0f4a;paint-order:stroke fill">거짓의 체스</div>
        <div style="position:absolute;left:30px;top:84px;width:420px;font-size:21px;line-height:32px;color:#e6d8ff">나는 <b>조종자</b>(흰 말), AI 동료는 <b>체스말</b>이 되었어요.<br>쉐도우밀크 쿠키(검은 말)에게 지면 체스말이 된 동료만 쓰러져요.</div>
        <div style="position:absolute;left:30px;top:220px;width:420px;height:300px">${portrait(110, -10, 190, 250)}</div>
        <div style="position:absolute;left:480px;top:70px;display:grid;grid-template-columns:repeat(8,72px);border:6px solid #2b1830;border-radius:10px;box-shadow:0 8px 0 rgba(0,0,0,.4);${over ? 'filter:brightness(.9)' : ''}">${cells}</div>
        <div id="msg" style="position:absolute;left:480px;top:660px;width:588px;text-align:center;font-size:26px;color:#ffd873">${msg || (ch.isCheck() ? '체크!' : '내 차례예요 (흰 말)')}</div>${extra}`;
      stage.querySelectorAll('div[data-s]').forEach(d => d.onclick = () => click(d.dataset.s));
      const sk = stage.querySelector('#cont'); if (sk) sk.onclick = () => finish(false);
    };
    const finish = win => { if (lost && !win) { res({ win: false }); return; } res({ win }); };
    const endLose = () => { over = true; lost = true; draw('체크메이트… 쉐도우밀크 쿠키의 승리!', `<button id="cont" style="position:absolute;left:1100px;top:600px;width:150px;height:60px;${BTN('#cfc6d8')};font-size:22px">계속 ▶</button>`); };
    const click = s => {
      if (over && !lost) return;
      const p = ch.get(s);
      if (lost) {   // 숨겨진 기능: 체크메이트 당한 뒤 검은 킹을 연속 3번 누르면 "거짓의 힘"이 깨어난다
        const bk = ch.board().flat().find(x => x && x.type === 'k' && x.color === 'b');
        if (!lie) { if (bk && s === bk.square) { const now = Date.now(); kingClicks = kingClicks.filter(t => now - t < 1800); kingClicks.push(now); if (kingClicks.length >= 3) { lie = true; draw('✦ 거짓의 힘이 깨어났다! 아무 흰 말이나 골라 킹을 덮쳐라 ✦', ''); return; } } return; }
        if (sel && bk && s === bk.square) { draw('거짓은 어디든 닿는다… 역체크메이트!!', ''); over = true; lost = false; setTimeout(() => finish(true), 1800); return; }
        if (p && p.color === 'w') { sel = s; draw('✦ 거짓의 힘이 깨어났다! 아무 흰 말이나 골라 킹을 덮쳐라 ✦', ''); } return;
      }
      if (sel && ch.moves({ square: sel, verbose: true }).some(m => m.to === s)) {
        ch.move({ from: sel, to: s, promotion: 'q' }); sel = null;
        if (ch.isCheckmate()) { over = true; draw('체크메이트! 쉐도우밀크 쿠키를 이겼다!'); setTimeout(() => finish(true), 1800); return; }
        if (ch.isGameOver()) { over = true; draw('무승부… 거짓과 진리는 겨룰 수 없다'); setTimeout(() => finish(true), 1800); return; }
        draw('쉐도우밀크 쿠키가 생각 중…'); over = true;
        setTimeout(() => {
          const m = aiMove(ch); if (m) ch.move(m); over = false;
          if (ch.isCheckmate()) return endLose(); if (ch.isGameOver()) { over = true; draw('무승부'); setTimeout(() => finish(true), 1500); return; } draw();
        }, 700); return;
      }
      sel = p && p.color === 'w' ? s : null; draw();
    };
    draw();
  });
}

/* ---------- 3. 타로 카드 짝 맞추기 ---------- */
function cards() {
  return new Promise(res => {
    const sym = pickN(['🃏', '🌙', '☀️', '⭐', '🗡️', '👑', '🔮', '🌹', '⚖️', '🕯️'], 8), deck = [...sym, ...sym].sort(() => Math.random() - .5);
    let open = [], matched = new Set(), moves = 0, lock = true, t0 = 0, left = 4;
    const draw = (reveal) => {
      stage.innerHTML = CSS + `<div style="position:absolute;inset:0;background:${BG.tarot}"></div>
        <div style="position:absolute;left:0;top:22px;width:1280px;text-align:center;${HAN};font-size:48px;-webkit-text-stroke:8px #1a0f4a;paint-order:stroke fill">거짓의 타로</div>
        <div style="position:absolute;left:0;top:92px;width:1280px;text-align:center;font-size:23px;color:#ffe0ff">${reveal ? `카드를 외우세요! ${left}초 뒤에 모두 뒤집혀요` : `짝을 모두 맞추세요 · 시도 ${moves}번 · 맞춘 짝 ${matched.size / 2}/8`}</div>
        <div style="position:absolute;left:340px;top:140px;display:grid;grid-template-columns:repeat(4,140px);gap:14px">${deck.map((s, i) => { const up = reveal || open.includes(i) || matched.has(i); return `<button data-i="${i}" style="width:140px;height:128px;font-size:62px;border:4px solid #2b1830;border-radius:18px;background:${matched.has(i) ? '#bde8cf' : up ? '#fff3df' : 'repeating-linear-gradient(45deg,#6a3ad8 0,#6a3ad8 10px,#8a5af0 10px,#8a5af0 20px)'};box-shadow:0 4px 0 #2b1830;cursor:pointer">${up ? s : ''}</button>`; }).join('')}</div>`;
      stage.querySelectorAll('button[data-i]').forEach(b => b.onclick = () => flip(+b.dataset.i));
    };
    const flip = i => {
      if (lock || open.includes(i) || matched.has(i)) return; open.push(i); draw(false);
      if (open.length === 2) {
        lock = true; moves++; const [a, b] = open;
        setTimeout(() => { if (deck[a] === deck[b]) { matched.add(a); matched.add(b); } open = []; lock = false; draw(false); if (matched.size === 16) setTimeout(res, 900); }, 750);
      }
    };
    draw(true);
    const iv = setInterval(() => { left--; if (left <= 0) { clearInterval(iv); lock = false; draw(false); } else draw(true); }, 1000);
  });
}

/* ---------- 요거트강 (실제 맵) ---------- */
function gateCard(q, idx) {
  return new Promise(res => {
    const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:50%;bottom:3%;transform:translateX(-50%);width:min(840px,95vw);box-sizing:border-box;padding:14px 22px;border:5px solid #2b1830;border-radius:26px;background:#fff3df;color:#2b1830;text-align:center;z-index:99990;font-family:Jua,sans-serif';
    d.innerHTML = `<div style="font-size:15px;color:#6b4a63">요거트강 ${idx + 1} / 10 · <b style="color:#d6405f">틀린 답(거짓)</b>을 골라야 떠요!</div><div style="font-size:clamp(18px,3.4vw,28px);margin:6px 0 10px">${q.q}</div><div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">${q.o.map((o, k) => `<button data-k="${k}" style="min-width:150px;height:54px;padding:0 14px;${BTN('#fff')};font-size:clamp(17px,3vw,26px)">${o}</button>`).join('')}</div><div style="margin:10px auto 0;width:70%;height:12px;border:3px solid #2b1830;border-radius:8px;background:#eee;overflow:hidden"><div id="gtm" style="height:100%;width:100%;background:#ff7a8a;transition:width 15s linear"></div></div>`;
    document.body.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => { const t = d.querySelector('#gtm'); if (t) t.style.width = '0'; }));
    let done = false; const end = ok => { if (done) return; done = true; clearTimeout(tk); d.remove(); res(ok); };
    const tk = setTimeout(() => end(false), 15000);
    d.querySelectorAll('button[data-k]').forEach(b => b.onclick = () => { if (done) return; const wrong = q.o[+b.dataset.k] !== q.c; b.style.background = wrong ? '#bde8cf' : '#ffb0b8'; setTimeout(() => end(wrong), 450); });
  });
}
async function yogurtMap(api) {
  const qs = makeQuestions(); hideOv(true);
  const r = await api.fight(null, { map: 'plain', timeout: 300, explore: { title: '부활의 요거트강 — 헤엄쳐서 건너세요 (질문에는 거짓으로!)', start: [.08, .55], goalX: .92, river: { x0: .3, x1: .7 }, bridgeY: .12, partner: { id: 'lich', x: .08, y: .12 }, gates: Array.from({ length: 10 }, (_, i) => .32 + i * .04), onGate: i => gateCard(qs[i], i) } });
  hideOv(false); return r.win;
}

/* ---------- 거짓의 동굴 (실제 맵 던전) ---------- */
async function dungeon(api) {
  await cutscene({ bg: 'cave', lines: ['거짓의 동굴이다. 어둠 속에서 거짓 쿠키들이 어슬렁거린다.', '직접 걸어 다니며 모두 물리치자. 보물 상자와 함정을 조심해!', '가장 깊은 곳에서는 쉐도우밀크 쿠키가 기다리고 있다…'], who: '거짓의 동굴' });
  hideOv(true);
  const spots = [[.2, .28], [.22, .72], [.3, .5], [.36, .25], [.38, .78], [.46, .5], [.5, .2], [.54, .8], [.6, .35], [.64, .66], [.7, .22], [.74, .75], [.8, .45]];
  const weak = ['mob_dough', 'mob_jelly', 'mob_soldier', 'mob_mage'], ids = spots.map((_, i) => weak[i % 4]).sort(() => Math.random() - .5);
  ids[Math.floor(spots.length * .55)] = 'lich'; ids[spots.length - 1] = 'dark';   // 고등급 쿠키 몹은 단 2마리 (변신하는 리치드래곤은 중반, 어둠마녀는 보스 앞)
  const mobs = spots.map((p, i) => ({ id: ids[i], x: p[0], y: p[1], hp: ids[i].startsWith('mob_') ? 1 : .35, pm: ids[i].startsWith('mob_') ? 1 : .7, aggro: 460 }));
  const r = await api.fight(null, { map: 'ruins', timeout: 480, explore: {
    title: '거짓의 동굴 — 거짓 쿠키를 모두 물리치세요', start: [.07, .5], goalX: 2, mobs,
    chests: [{ x: .36, y: .5 }, { x: .62, y: .6 }], traps: [{ x: .46, y: .3 }, { x: .6, y: .5 }, { x: .76, y: .55 }],
    boss: { id: 'shadow', x: .9, y: .5, hpAbs: 2000000, pm: 2.2, area: 1.3, big: 4, aggro: 99999, heal: { every: 7, pct: .14 } },
  } });
  hideOv(false); return r.win;
}

/* ---------- 레이드 전체 흐름 ---------- */
const DAY = 864e5;
export const rewardLeft = (S, H) => Math.max(0, (H().rd.last || 0) + DAY - Date.now());
export async function runRaid(c) {
  ctx = c; const { api, H, grant } = c, S = api.SAVE; mount();
  const fail = async (title, lines) => { await panelScreen(title, '레이드 실패', lines, '돌아가기', BG.cave); };
  try {
    await panelScreen('거짓의 탑', '레이드 · 2명 이상 필요', ['파티: <b>나</b> + <b>AI 동료</b>', '<span style="color:#6b4a63;font-size:19px">※ 서버가 열리면 실제 플레이어와 함께 입장해요. 지금은 AI 동료가 대신해요.</span>', '', '<b>① 거짓의 군주</b> → <b>② 부활의 요거트강</b> → <b>③ 거짓의 체스</b> → <b>④ 거짓의 타로</b> → <b>⑤ 거짓의 동굴</b>', '중간에 한 명이라도 쓰러지면 실패! (체스는 체스말이 된 한 명만 쓰러져요)'], '입장하기!', BG.tower);
    await cutscene({ intro: true, bg: 'inside', lines: ['사람들은 잘난 입으로 알량한 그 진리만을 찾지.', '하지만? 속으로는 모두가 거짓을 원하고 있어!', '모두들 내 거짓의 탑으로 온 것을 환영한다!!'] });
    await banner('거짓의 군주', '1번째 관문', 1500);
    hideOv(true);
    await api.fight('shadow', { hp: 20000000000000000, pm: 12, area: 2, timeout: 70, big: 5 });   // 깰 수 없는 보스전: 쓰러지거나 시간이 다 되면 다음으로
    hideOv(false);
    await cutscene({ bg: 'inside', lines: ['하하하하하하! 봐봐봐, 그 입으로 떠들기만 하는 그 진리…', '넌 그 진리에 대해 이해하기는 하나????', '너도 이제 거짓의 쿠키야!'] });
    await banner('부활의 요거트강', '2번째 관문', 1500);
    await panelScreen('부활의 요거트강', '역할 분담', ['한 명은 <b>다리</b>를 건너고, 한 명은 <b>요거트강</b>을 헤엄쳐야 해요.', '요거트강에서는 <b>거짓의 쿠키</b>만 뜰 수 있어요. 진리를 외치면 <b>가라앉아 죽어요!</b>', '10개의 질문이 나와요. 반드시 <b>틀린 답(거짓)</b>을 골라요.', '나: 요거트강 · AI 동료: 다리', '한 명이라도 죽으면 레이드 실패!'], '시작', BG.river);
    if (!await yogurtMap(api)) return await fail('요거트강에 가라앉았다…', ['진리를 외친 쿠키는 요거트강에 가라앉고 말았다.', '레이드는 실패했습니다.']);
    await cutscene({ bg: 'river', lines: ['하하하하핳! 너도 거짓의 쿠키가 다 되었도다!'] });
    await banner('거짓의 체스', '3번째 관문', 1500);
    await panelScreen('거짓의 체스', '조종자 + 체스말', ['한 명은 <b>체스말</b>이 되고, 한 명은 그 말을 움직이는 <b>조종자</b>예요.', '나: 조종자(흰 말) · AI 동료: 체스말', '쉐도우밀크 쿠키에게 지면 <b>체스말이 된 쿠키만</b> 쓰러지고, 레이드는 계속돼요.'], '시작', BG.tarot);
    const cr = await chess();
    if (!cr.win) await panelScreen('체스말이 쓰러졌다…', '체스 패배', ['체스말이 된 AI 동료가 쓰러졌다.', '남은 인원으로 레이드를 계속한다.'], '계속', BG.tarot); else await panelScreen('체스 승리!', '거짓을 이겼다', ['거짓의 체스를 클리어했다.'], '계속', BG.tarot);
    await cutscene({ bg: 'tarot', lines: ['하하하! 진리의 구도자가 완전한 거짓을 이해하게 되었도다!', '거짓의 광대는 타로를 알아야 하는 법!'] });
    await banner('거짓의 타로', '4번째 관문', 1500);
    await panelScreen('거짓의 타로', '카드 짝 맞추기', ['처음 몇 초 동안만 카드가 보이고, 이후 모두 뒤집혀요.', '같은 그림의 짝을 모두 맞추면 클리어!'], '시작', BG.tarot);
    await cards();
    await banner('거짓의 동굴', '5번째 관문 · 던전', 1500);
    const cleared = await dungeon(api);
    let reward = null;
    const can = rewardLeft(S, H) === 0, full = { s: 100, c: 2000 }, part = { s: 30, c: 500 };
    if (cleared) {
      await cutscene({ bg: 'end', lines: ['이 이 거짓말쟁이가!!!!!!!!!!!', '감히 나를 속이고 타락한 척 해??', '오늘은 이만 물러나주도록 하지....', '거짓은 영원히 사라지지 않아...!!!!'] });
    }
    if (can) { reward = cleared ? full : part; H().rd.last = Date.now(); H().rd.clears += cleared ? 1 : 0; grant(reward); api.persist(); }
    await panelScreen(cleared ? '레이드 클리어!' : '던전에서 쓰러졌다…', cleared ? '거짓의 탑을 정복했다' : '보상이 줄어요', [
      reward ? `보상: <b>심연의 조각 ${reward.s}</b>(이벤트 뽑기 ${Math.floor(reward.s / 10)}회분) · 코인 ${reward.c.toLocaleString()}` : '이미 24시간 안에 보상을 받았어요. 다음 보상까지 ' + Math.ceil(rewardLeft(S, H) / 36e5) + '시간',
      cleared ? '' : '(던전을 클리어하면 조각 100을 받아요)'], '확인', BG.end);
    return cleared;
  } finally { unmount(); }
}

// 디버그용(?): window.__GF_DEBUG 가 켜져 있으면 미니게임을 따로 실행해 볼 수 있다
if (typeof window !== 'undefined') window.__rd = { mount, unmount, yogurt, yogurtMap, chess, cards, dungeon, FACTS, makeQuestions, cutscene, hideOv };
