# ðŸœ Ramen Builder â€” scan-to-play WebAR ramen game

Point your phone at the printed **Ramen Builder card** â†’ the card is recognised â†’
the shop opens and the orders start coming. Build regional ramen bowls from all
over Japan, layer by layer, against the clock. Made for ages 8â€“15.

**Play:** https://naomirajwanshi02.github.io/Ramen_Builder/
**Without the card:** https://naomirajwanshi02.github.io/Ramen_Builder/?demo=1
**The card to scan:** [`target.png`](target.png)

## How to play

1. Open the link on your phone. It goes straight to the camera viewfinder. Allow the camera and point it at the card
   (on paper, or on another screen). The game starts the moment the card is recognised.
2. When the card is recognised, the ramen shop opens over the live camera. **From then on the
   card isn't needed**: you can move the phone freely. Tilt the phone or drag to look around the 3D shop.
3. An **order** comes in, such as *Sapporo Miso Ramen*, with a big ingredient ticket at the top.
   A 3D bowl stands on its counter, and 3D ingredients wait on little plates below it. Tap them to build
   the bowl the way a ramen cook does: **broth â†’ noodles â†’ toppings** (toppings in any order).
4. When every ingredient is in, the bowl is **served automatically** and you
   learn a fact about that region. Then the next order arrives.

| Thing | How it works |
|---|---|
| **Timer** | Each order has its own clock, scaled to its number of ingredients. It **gets shorter with every bowl you serve**. The bar turns red and ticks in the last 30%. |
| **Lives** | 3 bowls. An order that runs out of time costs one. The game is endless: it ends when all 3 are gone. |
| **Mistakes** | A wrong ingredient or the wrong layer (noodles before broth) takes 1.5â€“2 s off the clock and breaks your combo. It doesn't cost a life. |
| **Combo / multiplier** | Every correct tap adds 1 to the combo. Every 4 in a row raise the multiplier: Ã—2, Ã—3, Ã—4, up to Ã—5. A mistake resets it to Ã—1. |
| **Score** | 10 Ã— multiplier per ingredient. Serving a bowl adds (100 + up to 150 speed bonus + 50 for a perfect bowl) Ã— multiplier. Points fly into the counter, and the counter rolls and **locks** with a click. |
| **Game over** | The final score's digits spin and lock one at a time, then a å®Œ (finished) hanko seal stamps it. Your best score is saved on your phone. |
| **One ramp, ages 8â€“15** | There are no difficulty levels. The game starts gentle and speeds up with every bowl. Orders grow from a few toppings to the full regional recipe, and decoys go from 2 up to 7. Decoys come from the same layer, so you have to know *which* broth and *which* noodle. After 6 s with no progress, the wanted ingredients hop to help. |

## The 12 regional bowls

Researched from regional-ramen guides (Michelin Guide, Japan Travel, and others). Each
bowl uses its region's broth, noodle and signature toppings:

| Region | Broth | Noodles | Toppings |
|---|---|---|---|
| Sapporo Â· Hokkaido | Miso | thick curly | corn, butter, bean sprouts, chashu |
| Hakodate Â· Hokkaido | Shio (salt) | thin straight | chashu, menma, green onion, wakame |
| Kitakata Â· Fukushima | Shoyu | flat wavy | chashu, menma, green onion, naruto |
| Tokyo | Shoyu | medium curly | chashu, menma, nori, naruto, green onion |
| Yokohama Iekei Â· Kanagawa | Tonkotsu-shoyu | thick straight | chashu, spinach, nori |
| Toyama Black | Black shoyu | thick straight | chashu, menma, green onion, black pepper |
| Kyoto | Shoyu | thin straight | back fat, chashu, green onion |
| Wakayama | Tonkotsu-shoyu | thin straight | chashu, kamaboko, menma, green onion |
| Tokushima Â· Shikoku | Tonkotsu-shoyu | thin straight | sweet pork belly, raw egg, bean sprouts, green onion |
| Onomichi Â· Hiroshima | Shoyu | flat wavy | back fat, chashu, menma, green onion |
| Hakata Â· Fukuoka | Tonkotsu | thin straight | chashu, kikurage, pickled ginger, sesame, green onion |
| Kumamoto | Tonkotsu | thick straight | black garlic oil, garlic chips, kikurage, chashu, ajitama |

There are 32 ingredients in all (6 broths, 5 noodles, 21 toppings), each drawn in code.
The data lives in [`js/data.js`](js/data.js).

## Printing the card

- Print `target.png` about **18 cm wide** (it's 3:2, so about 18 Ã— 12 cm), on **matte** paper.
- Don't crop it. Lay it flat in even light, and hold the phone 20â€“40 cm away.
- Showing it on a laptop or tablet screen also works.

The compiled target scores **3,847 detection points over 11 scales and 58 tracking
points** (the sushi-ar card scores 1,877 / 52). MindAR's own detector was checked
against a rotated, skewed and darkened copy of the card (match found) and against the
sushi card (correctly no match).

## Design: the Anatomy kit in a sepia theme

The look comes from the [Anatomy](https://github.com/wheresryan22/anatomy) skill (MIT):

- The **3D shop is drawn the Anatomy way**, in [`js/stage.js`](js/stage.js). It uses an orthographic camera at Anatomy's
  azimuth 45Â° / elevation 30Â° (2.5D, never top-down) and four-tone flat shading, where the lit top is the exact colour and
  sides step toward walnut. Every solid has an ink outline. Colours are written raw in sRGB, so each 3D ingredient
  matches its icon on the order ticket.
- The **ramen bowl is an Anatomy turned solid**. One meridian profile goes through
  `lathe.mjs` â†’ `solidOf`, then `iso-kit.mjs` â†’ `solidSvg`, which gives four-tone
  shading, a halo, crease lines and a raimon border on the front half only. The kit
  is in [`vendor/anatomy/`](vendor/anatomy) and runs in the browser as plain ES modules.
- **Plates** use Anatomy's card style: a mono `Fig. 01` label top-left, a title
  top-right, a hint bottom-left, a live readout bottom-right, and a lifted shadow.
- **Sepia theme:** Anatomy ships only dark and light themes. [`css/anatomy-sepia.css`](css/anatomy-sepia.css)
  adds a third set of the same `--anatomy-*` tokens in warm paper and walnut ink.
  Every kit class then renders in sepia without any changes to the kit.

## Files

| File | What it is |
|---|---|
| `index.html` | The page: start, scan, game, pause and game-over screens. |
| `js/game.js` | Game loop, orders, timer, combos, multiplier, scoring, score lock, sound (WebAudio, no files). |
| `js/data.js` | Ingredients, regional recipes, difficulty settings. |
| `js/art.js` | Ingredient drawings, the Anatomy bowl, the Japan map. |
| `js/stage.js` | The 3D shop: card recognition (MindAR, recognition only), then the 2.5D Anatomy-style stage over the camera. |
| `css/` | The sepia theme and game layout. |
| `target.png` / `targets.mind` | The card and its compiled MindAR data. |
| `tools/make-target.html` | Redraws `target.png` and compiles `targets.mind` in the browser (`?build=1`). |
| `tools/art-sheet.html` | Every ingredient and every regional bowl on one page. |
| `tools/serve.ps1` | Local HTTPS-free dev server (localhost counts as secure for the camera). |

## Run locally

```bash
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```

Then open http://localhost:8123/?demo=1. `?target=./other.mind` swaps the target.

Version pins: `mind-ar@1.2.5` needs `three@0.160.0`, because three r162 removed `sRGBEncoding`.
These are the same pins as sushi-ar.
