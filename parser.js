'use strict';

// Pure LaTeX scanner: no VS Code dependency, so it can be unit-tested with Node.
// Produces non-overlapping tokens sorted by offset:
//   fix      - bionic fixation prefix of a word (bold + palette colour)
//   rest     - remainder of the word
//   command  - \command or control symbol
//   arg      - arguments of commands whose content is not prose (\cite{...}, \label{...}, ...)
//   math     - $...$, $$...$$, \(...\), \[...\], math environments
//   comment  - % ... end of line

const MATH_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'gather', 'gather*',
  'multline', 'multline*', 'flalign', 'flalign*', 'eqnarray', 'eqnarray*', 'displaymath', 'math',
]);
const VERBATIM_ENVS = new Set(['verbatim', 'verbatim*', 'Verbatim', 'lstlisting', 'minted', 'comment']);

// Number of {...} arguments to treat as non-prose. [...] optional args are skipped too.
const ARG_SKIP = {
  begin: Infinity, end: 1,
  cite: Infinity, citep: Infinity, citet: Infinity, citealp: Infinity, citeauthor: Infinity,
  autocite: Infinity, parencite: Infinity, textcite: Infinity, nocite: 1,
  ref: 1, eqref: 1, pageref: 1, autoref: 1, cref: 1, Cref: 1, label: 1,
  documentclass: Infinity, usepackage: Infinity, RequirePackage: Infinity,
  input: 1, include: 1, includegraphics: Infinity, graphicspath: 1,
  bibliography: 1, bibliographystyle: 1, addbibresource: Infinity,
  url: 1, href: 1, hypersetup: 1, color: 1, textcolor: 1, definecolor: Infinity,
  newcommand: Infinity, renewcommand: Infinity, providecommand: Infinity,
  newenvironment: Infinity, renewenvironment: Infinity, DeclareMathOperator: Infinity,
  setlength: Infinity, addtolength: Infinity, setcounter: Infinity,
  SI: Infinity, si: 1, num: 1, ang: 1, qty: Infinity, unit: 1,
};

// Commands that start a new paragraph-like block (for paragraph colour cycling).
const BREAK_COMMANDS = new Set([
  'par', 'item', 'part', 'chapter', 'section', 'subsection', 'subsubsection',
  'paragraph', 'subparagraph', 'caption', 'title', 'author', 'begin', 'end',
]);

const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}';
// Alphabetic word, excluding CJK (bionic emphasis is meaningless for ideographs).
const WORD_RE = new RegExp(`(?:(?![${CJK}])[\\p{L}\\p{M}])+`, 'uy');
const CMD_RE = /[A-Za-z@]+\*?/y;

function isEscaped(text, pos) {
  let n = 0;
  for (let j = pos - 1; j >= 0 && text[j] === '\\'; j--) n++;
  return n % 2 === 1;
}

function findUnescaped(text, needle, from) {
  let idx = text.indexOf(needle, from);
  while (idx !== -1 && isEscaped(text, idx)) idx = text.indexOf(needle, idx + 1);
  return idx;
}

// text[i] === open. Returns the index after the matching close, or -1 if unbalanced.
function skipGroup(text, i, open, close) {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const c = text[j];
    if (c === '\\') { j++; continue; }
    if (c === '%') {
      const nl = text.indexOf('\n', j);
      if (nl === -1) return -1;
      j = nl;
      continue;
    }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return j + 1;
  }
  return -1;
}

// Skip up to `max` brace arguments (and any optional [..] arguments) on the same line.
function skipArgs(text, i, max) {
  let count = 0;
  let end = i;
  while (count < max) {
    let k = end;
    while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++;
    const c = text[k];
    let e = -1;
    if (c === '{') { e = skipGroup(text, k, '{', '}'); if (e >= 0) count++; }
    else if (c === '[') e = skipGroup(text, k, '[', ']');
    if (e < 0) break;
    end = e;
  }
  return end;
}

function readEnvName(text, i) {
  let k = i;
  while (k < text.length && (text[k] === ' ' || text[k] === '\t')) k++;
  if (text[k] !== '{') return null;
  const close = text.indexOf('}', k);
  if (close === -1) return null;
  return { name: text.slice(k + 1, close).trim(), end: close + 1 };
}

function fixationLength(nChars, ratio) {
  if (nChars <= 3) return 1;
  return Math.min(nChars - 1, Math.ceil(nChars * ratio));
}

/**
 * @param {string} text
 * @param {{fixationRatio?:number, minWordLength?:number, colorCycle?:'paragraph'|'sentence'|'word'|'none'}} opts
 * @returns {{type:string,start:number,end:number,color?:number}[]}
 */
function parseTex(text, opts = {}) {
  const ratio = opts.fixationRatio ?? 0.45;
  const minLen = opts.minWordLength ?? 2;
  const mode = opts.colorCycle ?? 'paragraph';
  const n = text.length;
  const tokens = [];
  const push = (type, start, end, color) => {
    if (end > start) tokens.push({ type, start, end, color });
  };

  let para = 0, sentence = 0, words = 0;
  let paraPending = false, sentPending = false;
  let i = 0;

  while (i < n) {
    const c = text[i];

    if (c === '%') {
      let e = text.indexOf('\n', i);
      if (e === -1) e = n;
      push('comment', i, e);
      i = e;
      continue;
    }

    if (c === '\n') {
      let j = i + 1;
      while (j < n && (text[j] === ' ' || text[j] === '\t' || text[j] === '\r')) j++;
      if (j < n && text[j] === '\n') paraPending = true;
      i++;
      continue;
    }

    if (c === '\\') {
      const start = i;
      CMD_RE.lastIndex = i + 1;
      const m = CMD_RE.exec(text);
      if (!m) {
        const nx = text[i + 1];
        if (nx === '(' || nx === '[') {
          const close = nx === '(' ? '\\)' : '\\]';
          const e = text.indexOf(close, i + 2);
          if (e !== -1) {
            push('math', start, e + 2);
            i = e + 2;
            continue;
          }
        }
        // Control symbol such as \%, \$, \\, \{
        const e = Math.min(n, i + 2);
        push('command', start, e);
        i = e;
        continue;
      }

      const name = m[0].replace(/\*$/, '');
      let end = i + 1 + m[0].length;

      if (name === 'begin') {
        const env = readEnvName(text, end);
        if (env && (MATH_ENVS.has(env.name) || VERBATIM_ENVS.has(env.name))) {
          const endTag = `\\end{${env.name}}`;
          const e = text.indexOf(endTag, env.end);
          const stop = e === -1 ? n : e + endTag.length;
          if (MATH_ENVS.has(env.name)) push('math', start, stop);
          // verbatim-like blocks are left undecorated
          i = stop;
          continue;
        }
      }

      push('command', start, end);
      if (BREAK_COMMANDS.has(name)) paraPending = true;
      const skip = ARG_SKIP[name];
      if (skip) {
        const e = skipArgs(text, end, skip);
        push('arg', end, e);
        end = e;
      }
      i = end;
      continue;
    }

    if (c === '$') {
      const delim = text[i + 1] === '$' ? '$$' : '$';
      const e = findUnescaped(text, delim, i + delim.length);
      if (e !== -1) {
        push('math', i, e + delim.length);
        i = e + delim.length;
      } else {
        i += delim.length;
      }
      continue;
    }

    if (c === '.' || c === '!' || c === '?') {
      sentPending = true;
      i++;
      continue;
    }

    WORD_RE.lastIndex = i;
    const wm = WORD_RE.exec(text);
    if (wm) {
      if (paraPending) { para++; sentence++; paraPending = false; sentPending = false; }
      else if (sentPending) { sentence++; sentPending = false; }

      const color = mode === 'paragraph' ? para
        : mode === 'sentence' ? sentence
          : mode === 'word' ? words
            : 0;
      words++;

      const w = wm[0];
      const s = i;
      const e = i + w.length;
      const chars = Array.from(w);
      if (chars.length >= minLen) {
        const k = fixationLength(chars.length, ratio);
        let off = 0;
        for (let t = 0; t < k; t++) off += chars[t].length;
        push('fix', s, s + off, color);
        push('rest', s + off, e);
      } else {
        push('rest', s, e);
      }
      i = e;
      continue;
    }

    const cp = text.codePointAt(i);
    i += cp > 0xffff ? 2 : 1;
  }

  return tokens;
}

module.exports = { parseTex, fixationLength };
