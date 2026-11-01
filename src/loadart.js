// 로딩 화면 일러스트(코드로 그린 벡터). A = 쉐도우밀크 쿠키(왼쪽, 오른쪽을 향해 공격 자세), B = 퓨어바닐라 쿠키(오른쪽, 왼쪽을 향해 방어/맞서는 자세).
// 원본 일러스트 PNG 를 src/ui-screens/ 에 넣으면 아래 svg 대신 <image> 로 바꿔 쓸 수 있다.
const OL = '#16204a', GL = '#a8742f';

export const ART_A = `<svg role="img" aria-label="쉐도우밀크 쿠키" width="280" height="445" viewBox="0 0 200 318" style="position:absolute;left:30px;top:190px;overflow:visible">
<defs><radialGradient id="orbA"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#9ee0ff"/><stop offset="1" stop-color="#3d7cff" stop-opacity="0"/></radialGradient></defs>
<g transform="rotate(5 100 310)">
  <!-- 뒤쪽 검은 가시 망토 -->
  <path d="M30 300 L8 232 L40 252 L18 190 L56 226 L50 160 L84 210Z" fill="#0b0f26" stroke="${OL}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M44 305 Q24 230 64 168 L136 168 Q184 230 160 305Z" fill="#17275e" stroke="${OL}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M60 300 Q50 240 76 196 M96 304 Q90 244 100 204 M132 300 Q138 240 124 200" stroke="#3d6cff" stroke-width="3" fill="none" opacity=".6" stroke-linecap="round"/>
  <path d="M46 300 q10 -14 22 0 q10 -14 22 0 q10 -14 22 0 q10 -14 22 0 q10 -14 22 0" fill="#0b0f26" stroke="${OL}" stroke-width="3"/>
  <!-- 머리 땋은 흰 머리 -->
  <g fill="#eaf4ff" stroke="${OL}" stroke-width="2.5"><ellipse cx="62" cy="168" rx="9" ry="12"/><ellipse cx="56" cy="188" rx="9" ry="12"/><ellipse cx="52" cy="208" rx="9" ry="12"/><ellipse cx="52" cy="228" rx="8" ry="11"/></g>
  <!-- 얼굴 -->
  <ellipse cx="100" cy="132" rx="40" ry="38" fill="#e6efff" stroke="${OL}" stroke-width="4"/>
  <path d="M66 126 Q100 96 134 126 Q130 112 100 106 Q70 112 66 126Z" fill="#fff" stroke="${OL}" stroke-width="2"/>
  <path d="M76 134 Q86 126 94 134" stroke="#1f9a94" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M106 134 Q116 126 124 134" stroke="#1f9a94" stroke-width="5" fill="none" stroke-linecap="round"/>
  <circle cx="86" cy="138" r="3.5" fill="#35cfc4"/><circle cx="115" cy="138" r="3.5" fill="#35cfc4"/>
  <path d="M90 152 Q100 160 112 150" stroke="${OL}" stroke-width="3" fill="none" stroke-linecap="round"/>
  <circle cx="72" cy="148" r="6" fill="#9cc4ff" opacity=".7"/><circle cx="128" cy="148" r="6" fill="#9cc4ff" opacity=".7"/>
  <!-- 광대 모자: 왼쪽 큰 뿔(아래로 휘어짐) + 오른쪽 뿔 -->
  <path d="M62 112 Q40 76 14 100 Q2 112 8 136 Q22 108 52 126Z" fill="#2f6fe0" stroke="${OL}" stroke-width="4" stroke-linejoin="round"/>
  <circle cx="8" cy="138" r="9" fill="#cfeaff" stroke="${OL}" stroke-width="3"/>
  <path d="M138 112 Q164 60 184 74 Q196 86 178 104 Q168 88 148 126Z" fill="#2f6fe0" stroke="${OL}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M60 114 Q100 74 140 114 Q100 98 60 114Z" fill="#1b4ec0" stroke="${OL}" stroke-width="3"/>
  <path d="M64 108 L72 98 L82 108 L92 96 L102 108 L112 96 L122 108 L132 98 L138 108" stroke="#fff" stroke-width="3" fill="none" stroke-linejoin="round"/>
  <!-- 가슴 보석 + 마름모 무늬 -->
  <path d="M100 178 L116 196 L100 214 L84 196Z" fill="#3d7cff" stroke="${OL}" stroke-width="4"/><path d="M100 184 L108 196 L100 206 L92 196Z" fill="#9ed2ff"/>
  <!-- 앞으로 뻗은 오른팔 + 지팡이 -->
  <path d="M128 190 Q160 176 186 178" stroke="${OL}" stroke-width="22" fill="none" stroke-linecap="round"/><path d="M128 190 Q160 176 186 178" stroke="#2f6fe0" stroke-width="15" fill="none" stroke-linecap="round"/>
  <circle cx="190" cy="178" r="9" fill="#e6efff" stroke="${OL}" stroke-width="3"/>
  <line x1="176" y1="262" x2="196" y2="116" stroke="${OL}" stroke-width="7" stroke-linecap="round"/><line x1="176" y1="262" x2="196" y2="116" stroke="#3d7cff" stroke-width="3.5" stroke-linecap="round"/>
  <circle cx="198" cy="108" r="34" fill="url(#orbA)"/><circle cx="198" cy="108" r="12" fill="#bfe4ff" stroke="${OL}" stroke-width="3.5"/>
  <path d="M198 84 l4 14 l14 4 l-14 4 l-4 14 l-4 -14 l-14 -4 l14 -4Z" fill="#fff" opacity=".9"/>
  <!-- 물방울 이펙트 -->
  <g fill="#9ed8ff" stroke="${OL}" stroke-width="1.5"><circle cx="150" cy="150" r="5"/><circle cx="170" cy="138" r="3.5"/><circle cx="30" cy="150" r="4"/></g>
</g></svg>`;

export const ART_B = `<svg role="img" aria-label="퓨어바닐라 쿠키" width="290" height="445" viewBox="0 0 220 340" style="position:absolute;left:915px;top:40px;overflow:visible">
<defs><radialGradient id="sunB"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff6c8"/><stop offset="1" stop-color="#ffd86a" stop-opacity="0"/></radialGradient></defs>
<g transform="rotate(-4 110 330)">
  <!-- 뒤쪽 긴 원뿔 모자 끝 -->
  <path d="M64 120 L48 14 L118 74Z" fill="#fff6dc" stroke="${GL}" stroke-width="3.5" stroke-linejoin="round"/>
  <path d="M56 70 l8 -2 M58 40 l10 6" stroke="${GL}" stroke-width="2" opacity=".7"/><path d="M62 52 l5 -10 l5 10 l-5 3z" fill="#f2c84b" opacity=".9"/>
  <!-- 로브 -->
  <path d="M46 330 Q40 270 62 232 L158 232 Q180 270 174 330Z" fill="#fff8e6" stroke="${GL}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M60 326 Q60 290 74 260 M160 326 Q160 290 146 260" stroke="#16264f" stroke-width="5" fill="none" opacity=".7" stroke-linecap="round"/>
  <g fill="#fff" stroke="${GL}" stroke-width="2"><circle cx="86" cy="300" r="5"/><circle cx="110" cy="314" r="5"/><circle cx="134" cy="300" r="5"/></g>
  <!-- 금빛 후드 -->
  <path d="M44 232 Q36 150 70 104 L110 36 L150 104 Q184 150 176 232 Q110 214 44 232Z" fill="#f4dc92" stroke="${GL}" stroke-width="4.5" stroke-linejoin="round"/>
  <path d="M70 104 L110 52 L150 104" stroke="#fff4c8" stroke-width="5" fill="none" opacity=".8"/>
  <path d="M96 30 Q110 14 124 30 L110 44Z" fill="#f8e7a8" stroke="${GL}" stroke-width="3.5" stroke-linejoin="round"/><path d="M110 32 l6 6 l-6 6 l-6 -6Z" fill="#16264f"/>
  <!-- 머리카락 + 얼굴 -->
  <path d="M74 232 Q70 150 110 84 Q150 150 146 232 Q110 220 74 232Z" fill="#fff4c0" stroke="${GL}" stroke-width="3"/>
  <ellipse cx="110" cy="170" rx="22" ry="27" fill="#c98c52" stroke="${GL}" stroke-width="3"/>
  <path d="M96 118 Q110 106 124 118 Q124 156 110 164 Q96 156 96 118Z" fill="#fff4c0"/>
  <path d="M110 128 l3 8 l9 1 l-7 5 l3 9 l-8 -5 l-8 5 l3 -9 l-7 -5 l9 -1Z" fill="#c8322f" transform="translate(0 -14) scale(1)"/>
  <path d="M94 168 Q101 175 108 168 M114 168 Q121 175 128 168" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M104 184 Q110 190 118 184" stroke="#8a4a2a" stroke-width="3" fill="none" stroke-linecap="round"/>
  <circle cx="92" cy="180" r="5" fill="#e88a7a" opacity=".6"/><circle cx="128" cy="180" r="5" fill="#e88a7a" opacity=".6"/>
  <!-- 두루마리 소매 -->
  <path d="M44 226 Q26 270 50 306 Q62 318 78 312 L84 268 Q70 252 70 232Z" fill="#f2cf72" stroke="${GL}" stroke-width="4" stroke-linejoin="round"/>
  <path d="M176 226 Q196 270 172 306 Q160 318 144 312 L138 268 Q150 252 150 232Z" fill="#f2cf72" stroke="${GL}" stroke-width="4" stroke-linejoin="round"/>
  <g stroke="${GL}" stroke-width="2" opacity=".7" fill="none"><path d="M44 248 l20 12 M42 268 l22 6 M46 288 l20 0"/><path d="M176 248 l-20 12 M178 268 l-22 6 M174 288 l-20 0"/></g>
  <!-- 가슴 푸른 보석 -->
  <path d="M110 204 Q120 196 128 206 Q136 214 124 224 L110 240 L96 224 Q84 214 92 206 Q100 196 110 204Z" fill="#4f86ee" stroke="${GL}" stroke-width="4" stroke-linejoin="round"/><ellipse cx="104" cy="212" rx="5" ry="3.5" fill="#cfe4ff" transform="rotate(-30 104 212)"/>
  <path d="M84 232 L110 252 L136 232" fill="none" stroke="${GL}" stroke-width="3"/>
  <!-- 태양 지팡이 (왼쪽 A 쪽으로 기울여 겨눔) -->
  <path d="M176 326 L134 62" stroke="${GL}" stroke-width="12" stroke-linecap="round"/><path d="M176 326 L134 62" stroke="#f0cf6a" stroke-width="7" stroke-linecap="round"/>
  <path d="M170 280 q8 -12 18 -4 q-4 14 -16 14Z M162 236 q8 -12 18 -4 q-4 14 -16 14Z" fill="#f6dc8c" stroke="${GL}" stroke-width="2.5"/>
  <circle cx="128" cy="44" r="46" fill="url(#sunB)"/>
  <g fill="#f8e7a8" stroke="${GL}" stroke-width="3.5" stroke-linejoin="round">${Array.from({ length: 8 }, (_, i) => `<path transform="rotate(${i * 45} 128 44)" d="M128 4 Q142 8 136 24 Q128 28 120 24 Q114 8 128 4Z"/>`).join('')}</g>
  <circle cx="128" cy="44" r="20" fill="#fffdf0" stroke="${GL}" stroke-width="3.5"/>
  <g fill="#fff6a8" stroke="#fff" stroke-width="1"><path d="M96 20 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 l8 -3Z"/><path d="M168 80 l2.5 6 l6 2.5 l-6 2.5 l-2.5 6 l-2.5 -6 l-6 -2.5 l6 -2.5Z"/></g>
</g></svg>`;
