# Token spine — Porcelain

Established 2026-08-19. Source of truth for agents: this file. Runtime for RN: `src/theme/tokens.ts` (sRGB hex; RN StyleSheet cannot consume OKLCH).

Preset: **Porcelain** (warm paper neutrals, terracotta accent). Chosen so the dictionary entry is the chrome — not template blue (`#3B6AD8` forbidden by brief §6).

Icon set: **Lucide** (`lucide-react-native`). One family. No emoji as functional icons. Do not ship icon-less chrome.

## Primitive (OKLCH origin)

Neutrals hue ~80 (warm). Accent hue 40 (terracotta).

| Token | OKLCH | Hex (RN) |
|---|---|---|
| gray-50 | 98.5% 0.004 80 | `#FBFAF7` |
| gray-100 | 96.5% 0.006 80 | `#F6F3EF` |
| gray-900 | 22% 0.015 60 | `#201914` |
| gray-950 | 17% 0.012 70 | `#130F0A` |
| accent-500 | 60% 0.13 40 | `#C06240` |
| accent-600 | 55% 0.13 40 | `#AF5331` |

## Semantic

Light canvas `#FBFAF7`, raised `#F6F3EF`, accent 3–5 placements per viewport (search focus, primary CTA, saved/active).

Dark canvas `#130F0A` (not `#000`), raised `#1C1712`, accent `#DC855D` (chroma reduced). Shadows replaced by hairline `--border-default`. Text `#EBE7E2` not `#fff`.

## Component (on demand)

Button / input / card / search radii from Porcelain: input 10, card 14, modal 20.

## Do not

- Inline hex in screens.
- Mix a second icon library.
- Use Graphite indigo or Expo template blue.
