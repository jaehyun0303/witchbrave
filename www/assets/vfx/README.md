# VFX 텍스처 교체 가이드

기본 텍스처는 코드(`src/tex.js`)가 임시로 그려줍니다. 마음에 드는 이미지를 만들었다면:

1. 아래 이름으로 PNG 를 이 폴더에 넣는다. (예: `rune.png`)
2. `manifest.json` 배열에 이름을 적는다. (예: `["rune","slash"]`)
3. `npm run dev` 로 서버를 켜고 새로고침. (file:// 로 열면 교체가 적용되지 않음)

게임 코드가 색을 입히므로(틴트) **파티클/이펙트용은 흰색~회색 + 투명 배경(알파)** 으로 만들어야 합니다.

| 이름 | 용도 | 크기 | 비고 |
|---|---|---|---|
| glow | 기본 입자, 빛무리 | 128~256 정사각 | 가운데 밝고 가장자리로 부드럽게 사라지는 원형 |
| spark | 불꽃/반짝임, 베기 선 | 128~256 정사각 | 4갈래 별빛, 가운데 코어 |
| ring | 충격파 링 | 256~512 정사각 | 가운데 비고 바깥쪽 가는 링, 가장자리 부드럽게 |
| slash | 검기/베기 초승달 | 256 정사각 | 가로로 긴 초승달, 위로 볼록, 양끝 뾰족하게 사라짐 |
| heart | 하트 입자 | 128 정사각 | 흰색 하트 + 약한 글로우 |
| rune | 마법진(바닥 데칼) | 512~1024 정사각 | 중심 대칭, 동심원+별+글리프, 선 위주, 가운데 투명 |
| beam | 광기둥(세로) | 128x256 | 아래가 진하고 위로 옅어짐, 좌우 가장자리 부드럽게 |
| smoke | 연기/먼지 | 128 정사각 | 부드러운 구름 덩어리 |
| crack | 바닥 균열 데칼 | 512 정사각 | 중심에서 방사형으로 갈라진 빛나는 금 |
| moon | 달 표면 (컷신) | 1024x512 | **풀컬러**, 구체 UV 용 (가로 2:1 등장방형) |
| floor | 아레나 바닥 | 1024 정사각 | **풀컬러**, 타일 가능한 어두운 석재+발광 선 |

## 이미지 생성 프롬프트 예시 (그대로 써도 됩니다)

- **glow**: `soft round glow particle, pure white radial gradient, transparent background, no hard edge, game vfx texture, 256x256`
- **spark**: `four-point star flare sparkle, bright white core with thin long rays, transparent background, game vfx sprite, symmetrical`
- **ring**: `thin glowing shockwave ring, white, empty center, soft falloff on both sides, transparent background, top-down, game vfx texture`
- **slash**: `crescent sword slash energy arc, white with bright core and soft glow edges, tapered pointed ends, horizontal, transparent background, anime fighting game vfx`
- **heart**: `glowing heart shape, white, soft bloom, transparent background, cute magical particle`
- **rune**: `magic circle seen from directly above, intricate concentric rings, hexagram, runic glyphs, thin glowing white lines, perfectly symmetrical, transparent background, fantasy game ground decal`
- **beam**: `vertical pillar of light, bright core fading upward, soft edges, white, transparent background, 128x256, game vfx`
- **smoke**: `soft puffy smoke cloud, white to transparent, no hard edges, game vfx texture`
- **crack**: `radial ground cracks emanating from center, glowing white fissures, transparent background, top-down, game vfx decal`
- **moon**: `full moon surface texture, equirectangular 2:1 map, cream colored, craters, maria, seamless, no lighting`
- **floor**: `seamless tileable dark fantasy stone tile floor with faint glowing violet grid lines, top-down texture`

Silent Salt 컷신의 "달" 은 `moon`, 침묵의 검기는 `slash`, 침묵의 영역은 `rune`+`ring` 을 주로 씁니다.
