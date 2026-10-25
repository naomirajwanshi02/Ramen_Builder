// Ramen_Builder data: every ingredient and every regional bowl.
// A bowl is built in layers, the way a ramen cook builds it:
//   1. broth  (the soup — its flavour base is the tare: miso, shoyu, shio, or pork bone)
//   2. noodles (each region has its own thickness and curl)
//   3. toppings (any order)

export const LAYERS = ['broth', 'noodles', 'topping'];
export const LAYER_NAME = { broth: 'Broth', noodles: 'Noodles', topping: 'Toppings' };

export const INGREDIENTS = {
  // ---- broths ----------------------------------------------------------
  miso:          { layer: 'broth', name: 'Miso broth',      jp: '味噌',     color: '#c08a4e', say: 'Fermented soybean paste stirred into the soup.' },
  shoyu:         { layer: 'broth', name: 'Shoyu broth',     jp: '醤油',     color: '#8f5226', say: 'Clear brown soup flavoured with soy sauce.' },
  shio:          { layer: 'broth', name: 'Shio broth',      jp: '塩',       color: '#e2c27f', say: 'Light, golden soup flavoured with salt.' },
  tonkotsu:      { layer: 'broth', name: 'Tonkotsu broth',  jp: '豚骨',     color: '#efe0bf', say: 'Creamy white soup from pork bones boiled for hours.' },
  tonkotsuShoyu: { layer: 'broth', name: 'Tonkotsu-shoyu',  jp: '豚骨醤油', color: '#b07a45', say: 'Pork-bone soup mixed with soy sauce.' },
  blackShoyu:    { layer: 'broth', name: 'Black shoyu',     jp: '黒醤油',   color: '#3a2112', say: 'Extra-dark, boiled-down soy sauce soup.' },

  // ---- noodles ---------------------------------------------------------
  thickCurly:    { layer: 'noodles', name: 'Thick curly noodles',   jp: '太縮れ麺', style: 'curly',   weight: 5.2, say: 'Chewy and springy, they hold rich miso soup.' },
  thinStraight:  { layer: 'noodles', name: 'Thin straight noodles', jp: '極細麺',   style: 'straight', weight: 1.8, say: 'Very thin — they cook in about 15 seconds!' },
  flatWavy:      { layer: 'noodles', name: 'Flat wavy noodles',     jp: '平打ち麺', style: 'flat',    weight: 6.5, say: 'Wide, flat ribbons that wave like a flag.' },
  mediumCurly:   { layer: 'noodles', name: 'Medium curly noodles',  jp: '中細縮れ麺', style: 'curly', weight: 3.2, say: 'The classic Tokyo noodle: wavy and bouncy.' },
  thickStraight: { layer: 'noodles', name: 'Thick straight noodles', jp: '太麺',    style: 'straight', weight: 4.6, say: 'Fat, chewy, straight noodles.' },

  // ---- toppings --------------------------------------------------------
  chashu:      { layer: 'topping', name: 'Chashu pork',      jp: 'チャーシュー', say: 'Slow-braised pork, sliced into rounds.' },
  ajitama:     { layer: 'topping', name: 'Ajitama egg',      jp: '味玉',       say: 'Soft-boiled egg soaked in soy sauce.' },
  rawEgg:      { layer: 'topping', name: 'Raw egg',          jp: '生卵',       say: 'Cracked on top — it cooks gently in the hot soup.' },
  corn:        { layer: 'topping', name: 'Sweet corn',       jp: 'コーン',     say: 'Hokkaido grows lots of sweet corn.' },
  butter:      { layer: 'topping', name: 'Butter',           jp: 'バター',     say: 'Melts into the soup. Hokkaido is dairy country!' },
  moyashi:     { layer: 'topping', name: 'Bean sprouts',     jp: 'もやし',     say: 'Crunchy sprouts, often stir-fried first.' },
  menma:       { layer: 'topping', name: 'Menma',            jp: 'メンマ',     say: 'Bamboo shoots, fermented and simmered.' },
  nori:        { layer: 'topping', name: 'Nori',             jp: '海苔',       say: 'A crisp sheet of dried seaweed.' },
  naruto:      { layer: 'topping', name: 'Naruto',           jp: 'なると',     say: 'Fish cake with a pink swirl, named after the Naruto whirlpools.' },
  kamaboko:    { layer: 'topping', name: 'Kamaboko',         jp: 'かまぼこ',   say: 'Steamed fish cake with a pink edge.' },
  negi:        { layer: 'topping', name: 'Green onion',      jp: 'ねぎ',       say: 'Chopped green onion for freshness.' },
  beniShoga:   { layer: 'topping', name: 'Pickled ginger',   jp: '紅しょうが', say: 'Bright red, sour ginger strips.' },
  kikurage:    { layer: 'topping', name: 'Kikurage',         jp: 'きくらげ',   say: 'Wood-ear mushroom — it crunches!' },
  sesame:      { layer: 'topping', name: 'Sesame seeds',     jp: 'ごま',       say: 'Toasted seeds sprinkled on top.' },
  garlicChips: { layer: 'topping', name: 'Garlic chips',     jp: 'フライドガーリック', say: 'Thin slices of fried garlic.' },
  mayu:        { layer: 'topping', name: 'Black garlic oil', jp: 'マー油',     say: 'Garlic cooked until black, mixed with oil.' },
  spinach:     { layer: 'topping', name: 'Spinach',          jp: 'ほうれん草', say: 'Boiled spinach — a must in Yokohama Iekei.' },
  seabura:     { layer: 'topping', name: 'Back fat',         jp: '背脂',       say: 'Little drops of pork fat that float on top.' },
  pepper:      { layer: 'topping', name: 'Black pepper',     jp: '黒胡椒',     say: 'Lots of coarse pepper — Toyama Black is spicy!' },
  porkBelly:   { layer: 'topping', name: 'Sweet pork belly', jp: '豚バラ',     say: 'Pork belly simmered sweet, instead of chashu.' },
  wakame:      { layer: 'topping', name: 'Wakame',           jp: 'わかめ',     say: 'Soft green seaweed from the sea.' },
};

// Regional bowls. `x,y` place the region on the little Japan map (0..100).
export const RECIPES = [
  { id: 'sapporo',   name: 'Sapporo Miso Ramen',      place: 'Sapporo · Hokkaido',     x: 82, y: 12,
    broth: 'miso', noodles: 'thickCurly', toppings: ['corn', 'butter', 'moyashi', 'chashu'],
    fact: 'Sapporo is where miso ramen was born, in the 1950s. Corn and butter keep you warm in the snow!' },
  { id: 'hakodate',  name: 'Hakodate Shio Ramen',     place: 'Hakodate · Hokkaido',    x: 74, y: 22,
    broth: 'shio', noodles: 'thinStraight', toppings: ['chashu', 'menma', 'negi', 'wakame'],
    fact: 'Hakodate is a port city, so its ramen is light and salty, like the sea breeze.' },
  { id: 'kitakata',  name: 'Kitakata Shoyu Ramen',    place: 'Kitakata · Fukushima',   x: 66, y: 44,
    broth: 'shoyu', noodles: 'flatWavy', toppings: ['chashu', 'menma', 'negi', 'naruto'],
    fact: 'Kitakata has so many ramen shops that people eat ramen for breakfast — it is called "asa-ra".' },
  { id: 'tokyo',     name: 'Tokyo Shoyu Ramen',       place: 'Tokyo',                  x: 64, y: 56,
    broth: 'shoyu', noodles: 'mediumCurly', toppings: ['chashu', 'menma', 'nori', 'naruto', 'negi'],
    fact: 'The first ramen shops in Tokyo opened over 100 years ago, serving this classic soy-sauce bowl.' },
  { id: 'iekei',     name: 'Yokohama Iekei Ramen',    place: 'Yokohama · Kanagawa',    x: 61, y: 60,
    broth: 'tonkotsuShoyu', noodles: 'thickStraight', toppings: ['chashu', 'spinach', 'nori'],
    fact: 'Iekei means "house style". You choose how firm your noodles and how strong your soup should be.' },
  { id: 'toyama',    name: 'Toyama Black Ramen',      place: 'Toyama',                 x: 49, y: 50,
    broth: 'blackShoyu', noodles: 'thickStraight', toppings: ['chashu', 'menma', 'negi', 'pepper'],
    fact: 'Toyama Black was made salty and peppery for hungry workers, who ate it with a bowl of rice.' },
  { id: 'kyoto',     name: 'Kyoto Shoyu Ramen',       place: 'Kyoto',                  x: 42, y: 62,
    broth: 'shoyu', noodles: 'thinStraight', toppings: ['seabura', 'chashu', 'negi'],
    fact: 'Kyoto bowls are topped with heaps of Kujo negi, a green onion grown in Kyoto for over 1,000 years.' },
  { id: 'wakayama',  name: 'Wakayama Ramen',          place: 'Wakayama',               x: 38, y: 70,
    broth: 'tonkotsuShoyu', noodles: 'thinStraight', toppings: ['chashu', 'kamaboko', 'menma', 'negi'],
    fact: 'In Wakayama shops you grab a hayazushi (mackerel sushi) from the counter while you wait.' },
  { id: 'tokushima', name: 'Tokushima Ramen',         place: 'Tokushima · Shikoku',    x: 33, y: 74,
    broth: 'tonkotsuShoyu', noodles: 'thinStraight', toppings: ['porkBelly', 'rawEgg', 'moyashi', 'negi'],
    fact: 'Tokushima ramen uses sweet pork belly instead of chashu, and a raw egg on top!' },
  { id: 'onomichi',  name: 'Onomichi Ramen',          place: 'Onomichi · Hiroshima',   x: 27, y: 66,
    broth: 'shoyu', noodles: 'flatWavy', toppings: ['seabura', 'chashu', 'menma', 'negi'],
    fact: 'Onomichi soup is made with small fish from the Seto Inland Sea, under a layer of pork back fat.' },
  { id: 'hakata',    name: 'Hakata Tonkotsu Ramen',   place: 'Hakata · Fukuoka',       x: 12, y: 74,
    broth: 'tonkotsu', noodles: 'thinStraight', toppings: ['chashu', 'kikurage', 'beniShoga', 'sesame', 'negi'],
    fact: 'Hakata noodles are so thin you order a refill called "kaedama" when you finish them.' },
  { id: 'kumamoto',  name: 'Kumamoto Ramen',          place: 'Kumamoto',               x: 13, y: 84,
    broth: 'tonkotsu', noodles: 'thickStraight', toppings: ['mayu', 'garlicChips', 'kikurage', 'chashu', 'ajitama'],
    fact: 'Kumamoto ramen gets its smoky taste from mayu, garlic fried until it turns black.' },
];

export const DIFFICULTY = {
  easy:   { label: 'Easy',   ages: '8+',  perStep: 4.4, floor: 1.9, shrink: 0.965, decoys: [2, 5], lives: 3 },
  normal: { label: 'Normal', ages: '10+', perStep: 3.4, floor: 1.4, shrink: 0.955, decoys: [3, 7], lives: 3 },
  hard:   { label: 'Hard',   ages: '13+', perStep: 2.6, floor: 1.0, shrink: 0.945, decoys: [4, 8], lives: 3 },
};
