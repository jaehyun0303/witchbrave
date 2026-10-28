# 위치브레이브 3D (Three.js)

## 실행
```bash
npm install
npm run dev      # http://localhost:8080  (VFX 텍스처 교체 가능)
npm run build    # www/game.js 만 빌드. www/index.html 을 직접 열어도 실행됨(텍스처 교체 제외)
```

## 구조
- `src/game.js`   전투 로직, 캐릭터/스킬 정의(`CHARS`), 스킬 연출, 컷신(`startCut/updateCut`), 카메라, AI
- `src/vfx.js`    GPU 파티클 + 링/기둥/데칼/돔/베기 이펙트 라이브러리
- `src/models.js` 절차적 모델(쿠키, 뼈 용, 달, 크리스탈). 나중에 glTF 로 교체할 때 `rig` 구조(root/body/head/torso/armL/armR/legL/legR/weapon)만 맞추면 됨
- `src/world.js`  렌더러, 블룸, 아레나, 정신세계 맵, 하늘
- `src/tex.js`    임시 VFX 텍스처 생성 + `www/assets/vfx/*.png` 자동 교체
- `src/ui.js`     메뉴/HUD/데미지 숫자/레터박스
