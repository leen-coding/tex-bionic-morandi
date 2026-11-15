'use strict';

// Morandi palettes: low-saturation, grey-tinted tones.
// `light` variants are darkened for legibility on light backgrounds,
// `dark` variants are lifted for dark backgrounds.
const c = (light, dark) => ({ light, dark });

const PALETTES = {
  morandi: {
    label: 'Classic Morandi',
    description: 'Haze blue · sage · dusty rose · mauve · oat · grey teal',
    fixation: [
      c('#5E7189', '#A7B6C6'), // haze blue
      c('#66775A', '#B3C1A5'), // sage
      c('#8C6461', '#D3AFAB'), // dusty rose
      c('#7B6886', '#C2B2CB'), // mauve
      c('#866F45', '#D2C09C'), // oat
      c('#4F726E', '#9EBDB8'), // grey teal
    ],
    text: c('#5F5A55', '#BDB5AC'),
    command: c('#8B7E74', '#A89B90'),
    arg: c('#9C8A7A', '#9E9184'),
    math: c('#62798A', '#9FB4C2'),
    comment: c('#A09A94', '#78726D'),
  },
  mist: {
    label: 'Mist Blue',
    description: 'Cool blue-grey',
    fixation: [c('#55697D', '#A9B9C9'), c('#5F6F80', '#B4C0CC'), c('#4D6474', '#9FB0C0')],
    text: c('#5B6168', '#B3B9BF'),
    command: c('#7D8794', '#929CA8'),
    arg: c('#8A929C', '#8E969F'),
    math: c('#6B7A8A', '#A3B3C1'),
    comment: c('#9AA0A6', '#737A80'),
  },
  sage: {
    label: 'Sage Green',
    description: 'Sage and moss',
    fixation: [c('#5F7358', '#B0C2A6'), c('#6B7A5E', '#BAC6A8'), c('#56705F', '#A3BFAE')],
    text: c('#5C6058', '#B7BBAF'),
    command: c('#7F8774', '#959D8A'),
    arg: c('#8D9282', '#949987'),
    math: c('#667C72', '#A2B8AC'),
    comment: c('#9EA295', '#757A6E'),
  },
  rose: {
    label: 'Dusty Rose',
    description: 'Warm greyish pink',
    fixation: [c('#8A5F5C', '#D6B1AC'), c('#946A63', '#DDBBB0'), c('#80606A', '#CDB0B8')],
    text: c('#655A58', '#C1B4B1'),
    command: c('#957F7B', '#A8928E'),
    arg: c('#9E8B86', '#A3918C'),
    math: c('#7E6A74', '#BBA6B0'),
    comment: c('#A79C99', '#7D7370'),
  },
  oat: {
    label: 'Oat Beige',
    description: 'Latte and camel',
    fixation: [c('#7E6A4E', '#D4C3A3'), c('#8A7259', '#D9C7AE'), c('#776552', '#CBBBA4')],
    text: c('#625B52', '#BFB6AA'),
    command: c('#8F8170', '#A39684'),
    arg: c('#9A8D7D', '#A09382'),
    math: c('#74705F', '#B4AF9C'),
    comment: c('#A49D93', '#7A746B'),
  },
};

// ---- colour adjustment -------------------------------------------------

function hexToHsl(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToHex(h, s, l) {
  const f = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r, g, b;
  if (!s) r = g = b = l;
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = f(p, q, h + 1 / 3); g = f(p, q, h); b = f(p, q, h - 1 / 3);
  }
  return '#' + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

/**
 * depth > 0 increases contrast with the background (darker on light themes,
 * lighter on dark themes); depth < 0 softens. saturation multiplies HSL saturation.
 */
function adjustColor(hex, depth, saturation, theme) {
  let [h, s, l] = hexToHsl(hex);
  s = Math.min(1, s * saturation);
  const towardBlack = (theme === 'light') === (depth >= 0);
  const k = Math.abs(depth);
  l = towardBlack ? l * (1 - k) : l + (1 - l) * k;
  return hslToHex(h, s, l);
}

const DEPTH_LEVELS = {
  soft: { label: 'Soft', value: -0.15 },
  standard: { label: 'Standard', value: 0 },
  deep: { label: 'Deep', value: 0.2 },
  deeper: { label: 'Deeper', value: 0.35 },
  deepest: { label: 'Deepest', value: 0.5 },
};

const SATURATION_LEVELS = {
  muted: { label: 'More muted', value: 0.7 },
  standard: { label: 'Standard', value: 1 },
  vivid: { label: 'Slightly vivid', value: 1.4 },
};

module.exports = { PALETTES, DEPTH_LEVELS, SATURATION_LEVELS, adjustColor };
