// Button glyphs: one sticker style a 3–4-year-old reads without words — a real object,
// flat colours from one palette, a 2.5 warm-black outline on a 48 grid. Drawing tools
// lean the same way; parts with class "ink" take the chosen colour (CSS var --ink).
// Designed on the "Drawing Kid Icons" canvas (Icon.dc.html).

const OUTLINE = '#2E2A26';

const GLYPHS = {
  pen: `<g transform="rotate(45 24 24)">
    <rect x="19" y="13" width="10" height="19" rx="1.5" fill="#FFFFFF"/>
    <rect class="ink" x="18.5" y="4" width="11" height="10" rx="3"/>
    <path d="M19 32 L29 32 L26 38.5 L22 38.5 Z" fill="#D9DEE3"/>
    <path class="ink" d="M22 38.5 L26 38.5 L24 44 Z"/>
  </g>`,

  pencil: `<g transform="rotate(45 24 24)">
    <rect x="19" y="3" width="10" height="7" rx="2.5" fill="#F59AB5"/>
    <rect x="19" y="9" width="10" height="4" fill="#AAB7C4"/>
    <rect x="19" y="13" width="10" height="19" fill="#FFC93C"/>
    <path d="M24 14 L24 31" stroke-width="1.5"/>
    <path d="M19 32 L29 32 L24 43 Z" fill="#F2C48D"/>
    <path class="ink" d="M21.6 37.6 L26.4 37.6 L24 43 Z"/>
  </g>`,

  marker: `<g transform="rotate(45 24 24)">
    <rect x="16" y="12" width="16" height="20" rx="3" fill="#FFFFFF"/>
    <rect class="ink" x="16" y="19" width="16" height="7"/>
    <rect class="ink" x="16" y="3" width="16" height="11" rx="4"/>
    <rect x="19" y="32" width="10" height="4" fill="#D9DEE3"/>
    <path class="ink" d="M20 36 L28 36 L28 39.5 L20 44 Z"/>
  </g>`,

  fill: `<g transform="rotate(30 22 26)">
    <path d="M11 14 Q22 -2 33 14"/>
    <path d="M11 14 L14.5 35 Q22 39 29.5 35 L33 14 Z" fill="#AAB7C4"/>
    <ellipse class="ink" cx="22" cy="14" rx="11" ry="4"/>
  </g>
  <path class="ink" d="M38.5 25 C42 31 42 35 38.5 36 C35 35 35 31 38.5 25 Z"/>
  <ellipse class="ink" cx="36" cy="42.5" rx="8" ry="2.8"/>`,

  eraser: `<g transform="rotate(-30 24 22)">
    <rect x="8" y="15" width="32" height="14" rx="3" fill="#4A9BE8"/>
    <path d="M23 15 L11 15 Q8 15 8 18 L8 26 Q8 29 11 29 L23 29 Z" fill="#EE5A45"/>
    <rect x="8" y="15" width="32" height="14" rx="3"/>
  </g>
  <circle cx="8" cy="40" r="1.8" fill="#F59AB5" stroke-width="1.5"/>
  <circle cx="14" cy="43" r="1.6" fill="#F59AB5" stroke-width="1.5"/>
  <circle cx="20" cy="41" r="1.4" fill="#F59AB5" stroke-width="1.5"/>`,

  undo: `<path d="M37 39 C38 25 31 17 19 17" stroke-width="10"/>
  <path d="M7 17 L20 6.5 L20 27.5 Z" fill="#4A9BE8"/>
  <path d="M37 39 C38 25 31 17 19 17" stroke="#4A9BE8" stroke-width="5"/>`,

  create: `<path d="M9 41 L25 25" stroke-width="8"/>
  <path d="M21.5 28.5 L25 25" stroke="#FFFFFF" stroke-width="3.5"/>
  <path d="M33 5 L35.47 11.6 L42.51 11.91 L36.99 16.3 L38.88 23.09 L33 19.2 L27.12 23.09 L29.01 16.3 L23.49 11.91 L30.53 11.6 Z" fill="#FFC93C"/>
  <path d="M12 8 Q12 13 17 13 Q12 13 12 18 Q12 13 7 13 Q12 13 12 8 Z" fill="#F59AB5" stroke-width="2"/>
  <path d="M41 30 Q41 34 45 34 Q41 34 41 38 Q41 34 37 34 Q41 34 41 30 Z" fill="#4A9BE8" stroke-width="2"/>`,

  picture: `<rect x="5" y="9" width="38" height="30" rx="4" fill="#FFFFFF"/>
  <rect x="10" y="14" width="28" height="20" rx="1.5" fill="#BFE3FF" stroke-width="2"/>
  <path d="M10 34 L10 29 Q16 22 22 28 Q29 23 38 29 L38 34 Z" fill="#4CB872" stroke-width="2"/>
  <circle cx="31" cy="20" r="3.5" fill="#FFC93C" stroke-width="2"/>`,

  save: `<path d="M13 5 L29 5 L37 13 L37 41 Q37 43 35 43 L13 43 Q11 43 11 41 L11 7 Q11 5 13 5 Z" fill="#FFFFFF"/>
  <path d="M29 5 L29 13 L37 13 Z" fill="#E3E8EE"/>
  <rect x="16.5" y="25" width="9" height="8" fill="#FFC93C" stroke-width="2"/>
  <path d="M15 25 L21 19 L27 25 Z" fill="#4A9BE8" stroke-width="2"/>
  <path d="M35 45 C26.5 39 27 31.5 31.5 31.5 C33.5 31.5 35 33.5 35 33.5 C35 33.5 36.5 31.5 38.5 31.5 C43 31.5 43.5 39 35 45 Z" fill="#EE5A45"/>`,

  clear: `<rect x="20" y="6.5" width="8" height="5" rx="1.5" fill="#4CB872"/>
  <path d="M13 16 L35 16 L32.5 41.5 Q32.3 43.5 30.3 43.5 L17.7 43.5 Q15.7 43.5 15.5 41.5 Z" fill="#4CB872"/>
  <rect x="9" y="11" width="30" height="5.5" rx="2.5" fill="#4CB872"/>
  <path d="M20.5 21.5 L21 38.5 M27.5 21.5 L27 38.5" stroke-width="2"/>`,

  settings: `${[0, 45, 90, 135, 180, 225, 270, 315]
    .map((a) => `<rect x="21" y="4.5" width="6" height="9" rx="1.5" fill="#AAB7C4" transform="rotate(${a} 24 24)"/>`)
    .join('')}
  <circle cx="24" cy="24" r="13" fill="#AAB7C4"/>
  <circle cx="24" cy="24" r="5" fill="#FFFFFF"/>`,
};
GLYPHS.redo = `<g transform="translate(48 0) scale(-1 1)">${GLYPHS.undo}</g>`;

export function icon(name) {
  return `<svg class="glyph" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><g fill="none" stroke="${OUTLINE}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${GLYPHS[name]}</g></svg>`;
}

// Paint servers for the special colours, since SVG fill can't take a CSS gradient:
// a smooth rainbow, and hard stripes for the Surprise colour.
export function inkDefs() {
  const stops = (colors, hard) =>
    colors
      .map((c, i) => {
        const from = (i / colors.length) * 100;
        const to = ((i + 1) / colors.length) * 100;
        return hard
          ? `<stop offset="${from}%" stop-color="${c}"/><stop offset="${to}%" stop-color="${c}"/>`
          : `<stop offset="${(i / (colors.length - 1)) * 100}%" stop-color="${c}"/>`;
      })
      .join('');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
    <linearGradient id="dk-ink-rainbow" x1="0" y1="0" x2="1" y2="1">${stops(['#f44336', '#ff9800', '#ffeb3b', '#4caf50', '#2196f3', '#9c27b0'])}</linearGradient>
    <linearGradient id="dk-ink-surprise" x1="0" y1="0" x2="1" y2="1">${stops(['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'], true)}</linearGradient>
  </defs></svg>`;
}
