'use strict';

const assert = require('assert');
const { parseTex } = require('../parser');

const show = (text, toks) => toks.map((t) => `${t.type}${t.color !== undefined ? t.color : ''}:${text.slice(t.start, t.end)}`);

function check(name, text, expected, opts) {
  const got = show(text, parseTex(text, opts));
  try {
    assert.deepStrictEqual(got, expected);
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}\n  expected ${JSON.stringify(expected)}\n  got      ${JSON.stringify(got)}`);
    process.exitCode = 1;
  }
}

check('plain words', 'Reading technical is fun',
  ['fix0:Read', 'rest:ing', 'fix0:techn', 'rest:ical', 'fix0:i', 'rest:s', 'fix0:f', 'rest:un']);

check('short word below min length', 'a cat', ['rest:a', 'fix0:c', 'rest:at']);

check('inline math and command', 'Let $x^2$ be \\emph{small}.',
  ['fix0:L', 'rest:et', 'math:$x^2$', 'fix0:b', 'rest:e', 'command:\\emph', 'fix0:sma', 'rest:ll']);

check('comment and escaped percent', '50\\% done % note here\nok',
  ['command:\\%', 'fix0:do', 'rest:ne', 'comment:% note here', 'fix0:o', 'rest:k']);

check('cite / ref args skipped', 'see \\cite[p.~3]{smith2020} and Fig.~\\ref{fig:a}',
  ['fix0:s', 'rest:ee', 'command:\\cite', 'arg:[p.~3]{smith2020}', 'fix0:a', 'rest:nd',
    'fix0:F', 'rest:ig', 'command:\\ref', 'arg:{fig:a}']);

check('math environment', 'x\n\\begin{align*} a &= b \\end{align*}\ndone',
  ['rest:x', 'math:\\begin{align*} a &= b \\end{align*}', 'fix0:do', 'rest:ne'], { minWordLength: 2 });

check('display math \\[ \\]', 'A \\[ y = mx \\] B', ['rest:A', 'math:\\[ y = mx \\]', 'rest:B']);

check('verbatim untouched', '\\begin{verbatim}raw text\\end{verbatim}', []);

check('CJK skipped, latin kept', '超声 imaging 成像', ['fix0:imag', 'rest:ing']);

check('paragraph colour cycle', 'one\n\ntwo\n\\section{Three} four',
  ['fix0:o', 'rest:ne', 'fix1:t', 'rest:wo', 'command:\\section', 'fix2:Thr', 'rest:ee', 'fix2:fo', 'rest:ur']);

check('sentence colour cycle', 'one. two', ['fix0:o', 'rest:ne', 'fix1:t', 'rest:wo'], { colorCycle: 'sentence' });

check('unclosed brace while typing', '\\cite{abc', ['command:\\cite', 'fix0:a', 'rest:bc']);

// Tokens must be sorted and non-overlapping (extension relies on binary search).
const big = require('fs').readFileSync(__filename, 'utf8').repeat(20);
const toks = parseTex(big);
for (let k = 1; k < toks.length; k++) {
  assert.ok(toks[k].start >= toks[k - 1].end, `overlap at token ${k}`);
}
const t0 = Date.now();
parseTex(big);
console.log(`ok   ordering (${toks.length} tokens, ${big.length} chars, ${Date.now() - t0} ms)`);
