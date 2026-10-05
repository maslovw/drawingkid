// Turns a child's spoken idea into a safe image prompt.
//
// Kids say things like "me and Anna at our house in Berlin". App Review guideline 1.3
// forbids passing a child's personal data to third parties, so names, places, numbers
// and contact details are removed before anything reaches the image provider.
// Dictation capitalizes proper nouns, which is what the name filter relies on.

const MAX_IDEA_LENGTH = 200;

// Words that are always capitalized but aren't personal: kept as they are.
const KEEP_CAPITALIZED = new Set(['I', 'Santa', 'Christmas', 'Halloween', 'Easter', 'Moon', 'Earth', 'Mars']);

// Replaced so the picture still makes sense without the personal detail.
const PERSONAL_WORDS = [
  [/\b(me|myself|i)\b/gi, 'a child'],
  [/\b(my|our) (mom|mum|mummy|mommy|mother|mama)\b/gi, 'a mom'],
  [/\b(my|our) (dad|daddy|father|papa)\b/gi, 'a dad'],
  [/\b(my|our) (sister|brother|friend|grandma|granny|grandpa|teacher)\b/gi, 'a $2'],
  [/\b(my|our)\b/gi, 'a'],
];

const REQUEST_OPENING =
  /^(please\s+)?((i\s+(want|would like|wanna)|can you|could you|let's)\s+)?((draw|make|paint)\s+((me|us)\s+)?)?/i;

const DANGLING_END = /[\s,]+(in|at|on|and|with|from|near|to|of|named|called|is|lives|und|mit|bei|im|in|и|с|у|в|на)$/iu;

// Ideas that are never drawn, whatever the moderation service says. Kept short on
// purpose: the provider's moderation does the real work; this catches the obvious in
// the languages the app ships in.
const BLOCKLIST = [
  /\b(kill|killing|blood|bloody|gun|guns|knife|dead|death|naked|nude|sexy|kiss(ing)?|drugs?|beer|wine|cigarettes?|poop|pee|bomb)\b/i,
  /\b(töten|blut|waffe|pistole|messer|nackt|tot|bombe)\b/i,
  /(убить|кровь|пистолет|нож|голый|голая|мертв|бомба)/i,
];

export class PromptRejected extends Error {}

// The idea with personal details taken out; throws PromptRejected if nothing drawable
// is left or the idea is on the blocklist.
export function cleanIdea(raw) {
  let idea = String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, MAX_IDEA_LENGTH);
  if (BLOCKLIST.some((re) => re.test(idea))) throw new PromptRejected('blocked');

  idea = idea
    .replace(/\S+@\S+/g, ' ') // email addresses
    .replace(/(https?:\/\/|www\.)\S+/gi, ' ') // links
    .replace(/[@#]\w+/g, ' ') // handles and tags
    .replace(/\d[\d\s\-/.,]*/g, ' '); // numbers: ages, addresses, phone numbers, dates

  // Capitalized words after the first word are names or places ("Anna", "Berlin").
  const words = idea.split(' ');
  idea = words
    .filter((word, i) => {
      const bare = word.replace(/[^\p{L}'-]/gu, '');
      if (i === 0 || !bare) return true;
      return !(/^\p{Lu}/u.test(bare) && !KEEP_CAPITALIZED.has(bare));
    })
    .join(' ')
    .trim()
    .replace(REQUEST_OPENING, ''); // "I want …", "draw me …": only the thing itself matters

  for (const [re, replacement] of PERSONAL_WORDS) idea = idea.replace(re, replacement);
  idea = idea.replace(/\s+([,.!?])/g, '$1').replace(/\s+/g, ' ').replace(/^[\s,.;:!?-]+|[\s,;:-]+$/g, '').trim();
  // Words left hanging where a name was removed: "a house in", "a child and".
  while (DANGLING_END.test(idea)) idea = idea.replace(DANGLING_END, '').trim();

  if ((idea.match(/\p{L}/gu) ?? []).length < 3) throw new PromptRejected('empty');
  return idea;
}

export function coloringPrompt(idea) {
  return [
    `A page from a children's coloring book for a young child showing: ${idea}.`,
    'Already colored in: every area is filled with one flat, solid color, and thick solid pure black outlines of even width go around every area, including inner parts like bellies, chests and inner ears.',
    'Use only 5 to 7 bright, clearly different colors in the whole picture, plus plain pure white for the background. Two areas that touch always have different colors, even parts of one thing (for example leaves, stems and grass in different greens).',
    // Gray is the one color the page's outlines blur into, so gray areas can't be told
    // from an outline's soft edge. Things that are gray in life get a bright color.
    'Never use gray, silver, beige, cream or off-white anywhere: things that are usually gray get a bright color instead (rails and roads brown or blue, rocks and metal blue or purple, an elephant or a mouse light blue).',
    'Black is only for the outlines and small details like pupils; tires, hair, noses, buttons and other solid shapes get a bright color, never black or a very dark color.',
    'Every outline is closed and joins up with the lines around it, with no gaps.',
    // A shape cut off by the page edge has no outline there.
    'The whole picture fits inside the page with a white margin all around; nothing is cut off by the edge of the page.',
    'Simple, friendly, cartoon style with a few large areas, each big enough to fill with a fingertip; keep things apart rather than piled up.',
    'Crisp, clean edges like vector art. No shading, no gradients, no highlights, no shadows, no glow, no texture, no patterns, no text, no border or frame.',
  ].join(' ');
}

// Key for the prompt cache: the same idea said slightly differently ("A unicorn!",
// "a unicorn") hits the same stored page.
export function cacheKeyText(idea) {
  return idea
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(a|an|the|please|draw|make|picture|of)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
