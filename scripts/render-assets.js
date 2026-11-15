'use strict';
// Generates the icon and the README demo images.
// Requires @resvg/resvg-js (not a runtime dependency):
//   npm i --no-save @resvg/resvg-js && node scripts/render-assets.js

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const { parseTex } = require('../parser');
const { PALETTES, adjustColor } = require('../palettes');

const out = path.join(__dirname, '..', 'images');
fs.mkdirSync(out, { recursive: true });

function png(svg, file, width) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: 'Consolas' },
  });
  fs.writeFileSync(path.join(out, file), r.render().asPng());
}

// ---------------------------------------------------------------- icon
// Four "lines of text": a thick Morandi-coloured fixation bar followed by a thin neutral bar.
const rows = [
  { y: 76, bold: 64, rest: 92, color: '#6F849B' },
  { y: 112, bold: 42, rest: 78, color: '#84987A' },
  { y: 148, bold: 80, rest: 76, color: '#B5857F' },
  { y: 184, bold: 34, rest: 58, color: '#94809F' },
];
const x0 = 46;
const bars = rows.map((r) => [
  `<rect x="${x0}" y="${r.y - 12}" width="${r.bold}" height="24" rx="12" fill="${r.color}"/>`,
  `<rect x="${x0 + r.bold + 8}" y="${r.y - 5}" width="${r.rest}" height="10" rx="5" fill="#CBC1B5"/>`,
].join('')).join('\n  ');
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F4EFE8"/>
      <stop offset="1" stop-color="#E7DFD4"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="56" fill="url(#bg)"/>
  <rect x="8.5" y="8.5" width="239" height="239" rx="55.5" fill="none" stroke="#D8CEC2"/>
  ${bars}
</svg>
`;
fs.writeFileSync(path.join(out, 'icon.svg'), icon);
png(icon, 'icon.png', 256);

// ---------------------------------------------------------------- demo
const sample = String.raw`\section{Introduction}\label{sec:intro}
% Bionic Reading guides the eye with bold word prefixes.
Reading long technical documents can be tiring. This extension
highlights the first letters of each word so the eye can glide
along the line \cite{doe2024}, while math such as $e^{i\pi}+1=0$
and commands stay calm and readable.

Colours rotate per paragraph, and depth, saturation and contrast
can be tuned from the status bar, see Section~\ref{sec:usage}.
\begin{equation}
  f(x) = \int_{-\infty}^{\infty} \hat{f}(\xi)\, e^{2\pi i \xi x}\, d\xi
\end{equation}`;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function demo(theme, paletteId, file) {
  const p = PALETTES[paletteId];
  const tone = (c) => adjustColor(c[theme], 0, 1, theme);
  const bg = theme === 'light' ? '#FFFFFF' : '#1E1E1E';
  const chrome = theme === 'light' ? '#F3F1EE' : '#2A2A2A';
  const fg = theme === 'light' ? '#3B3B3B' : '#CCCCCC';
  const gutter = theme === 'light' ? '#B4AFA9' : '#5E5E5E';

  // per-character style
  const style = new Array(sample.length).fill(null);
  for (const tk of parseTex(sample, { colorCycle: 'paragraph' })) {
    let s;
    if (tk.type === 'fix') s = { fill: tone(p.fixation[tk.color % p.fixation.length]), bold: true };
    else if (tk.type === 'rest') s = { fill: tone(p.text), opacity: 0.85 };
    else if (tk.type === 'comment') s = { fill: tone(p.comment), italic: true };
    else s = { fill: tone(p[tk.type]) };
    for (let i = tk.start; i < tk.end; i++) style[i] = s;
  }

  const fontSize = 15, lineH = 24, charW = 8.25, padX = 64, top = 62;
  const lines = sample.split('\n');
  const width = Math.ceil(padX + Math.max(...lines.map((l) => l.length)) * charW + 32);
  const height = top + lines.length * lineH + 18;

  let offset = 0;
  const textRows = lines.map((line, li) => {
    const y = top + li * lineH;
    let spans = '';
    let i = 0;
    while (i < line.length) {
      const s = style[offset + i];
      let j = i + 1;
      while (j < line.length && style[offset + j] === s) j++;
      const chunk = esc(line.slice(i, j));
      const attrs = s
        ? `fill="${s.fill}"${s.bold ? ' font-weight="700"' : ''}${s.italic ? ' font-style="italic"' : ''}${s.opacity ? ` fill-opacity="${s.opacity}"` : ''}`
        : `fill="${fg}"`;
      spans += `<tspan ${attrs}>${chunk}</tspan>`;
      i = j;
    }
    offset += line.length + 1;
    return `<text x="${padX - 40}" y="${y}" fill="${gutter}" text-anchor="end" font-size="13">${li + 1}</text>`
      .replace(`x="${padX - 40}"`, `x="${padX - 20}"`)
      + `<text x="${padX}" y="${y}" xml:space="preserve">${spans}</text>`;
  }).join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
  font-family="Consolas, 'Cascadia Mono', monospace" font-size="${fontSize}">
  <rect width="${width}" height="${height}" rx="10" fill="${bg}"/>
  <path d="M10 0 H${width - 10} A10 10 0 0 1 ${width} 10 V34 H0 V10 A10 10 0 0 1 10 0 Z" fill="${chrome}"/>
  <circle cx="20" cy="17" r="5" fill="#C9A9A6"/><circle cx="38" cy="17" r="5" fill="#D2C09C"/><circle cx="56" cy="17" r="5" fill="#A8BBA2"/>
  <text x="${width / 2}" y="22" text-anchor="middle" font-size="12" fill="${gutter}">paper.tex</text>
  ${textRows}
</svg>`;
  png(svg, file, width * 2);
}

demo('light', 'morandi', 'demo-light.png');
demo('dark', 'morandi', 'demo-dark.png');
console.log('written to', out);
