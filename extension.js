'use strict';

const vscode = require('vscode');
const { parseTex } = require('./parser');
const { PALETTES, DEPTH_LEVELS, SATURATION_LEVELS, adjustColor } = require('./palettes');

const LINE_MARGIN = 60; // decorate a little beyond the viewport to avoid flicker while scrolling
const SYNTAX_TYPES = ['command', 'arg', 'math', 'comment'];

const t = (msg, ...args) => vscode.l10n.t(msg, ...args);

// Labels are English source strings; they are translated at display time via l10n bundles.
const COLOR_CYCLES = {
  paragraph: { label: 'By paragraph', description: 'New colour for each paragraph or section' },
  sentence: { label: 'By sentence', description: 'New colour for each sentence' },
  word: { label: 'By word', description: 'New colour for each word' },
  none: { label: 'Single colour', description: 'Use only the first palette colour' },
};
const REST_OPACITY = {
  0.55: { label: 'Low', description: 'Rest of each word clearly faded; bold part stands out' },
  0.7: { label: 'Medium', description: '' },
  0.85: { label: 'High', description: 'Default' },
  1: { label: 'Full', description: 'Rest of each word keeps full strength' },
};
const WEIGHTS = {
  500: { label: '500 Medium' }, 600: { label: '600 Semibold' }, 700: { label: '700 Bold' },
  800: { label: '800 Extra bold' }, 900: { label: '900 Black' },
};

const cache = new Map(); // document uri -> { key, tokens }
const timers = new Map(); // editor -> timeout
let deco = null;
let settings = null;
let preview = null; // { key, value } applied temporarily while browsing a quick pick
let statusItem = null;

function readSettings() {
  const c = vscode.workspace.getConfiguration('texBionic');
  const s = {
    enabled: c.get('enabled', true),
    palette: c.get('palette', 'morandi'),
    colorCycle: c.get('colorCycle', 'paragraph'),
    depth: c.get('depth', 'standard'),
    saturation: c.get('saturation', 'standard'),
    fixationRatio: c.get('fixationRatio', 0.45),
    minWordLength: c.get('minWordLength', 2),
    fixationWeight: c.get('fixationWeight', '700'),
    restOpacity: c.get('restOpacity', 0.85),
    colorizeRest: c.get('colorizeRest', true),
    colorizeSyntax: c.get('colorizeSyntax', true),
  };
  if (preview) s[preview.key] = preview.value;
  return s;
}

function isTex(doc) {
  return !!doc && (doc.languageId === 'latex' || doc.languageId === 'tex' || /\.tex$/i.test(doc.fileName));
}

function allTypes() {
  return [...deco.fix, deco.rest, ...SYNTAX_TYPES.map((k) => deco[k])];
}

function disposeDecorations() {
  if (!deco) return;
  for (const t of allTypes()) t.dispose();
  deco = null;
}

function buildDecorations() {
  disposeDecorations();
  const p = PALETTES[settings.palette] || PALETTES.morandi;
  const depth = (DEPTH_LEVELS[settings.depth] || DEPTH_LEVELS.standard).value;
  const sat = (SATURATION_LEVELS[settings.saturation] || SATURATION_LEVELS.standard).value;
  const tone = (col, theme) => adjustColor(col[theme], depth, sat, theme);
  const make = (col, extra = {}) => vscode.window.createTextEditorDecorationType({
    ...extra,
    light: col ? { color: tone(col, 'light') } : undefined,
    dark: col ? { color: tone(col, 'dark') } : undefined,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  deco = {
    fix: p.fixation.map((col) => make(col, { fontWeight: String(settings.fixationWeight) })),
    rest: make(settings.colorizeRest ? p.text : null, { opacity: String(settings.restOpacity) }),
    command: make(p.command),
    arg: make(p.arg),
    math: make(p.math),
    comment: make(p.comment, { fontStyle: 'italic' }),
  };
}

function clear(editor) {
  if (!deco) return;
  for (const t of allTypes()) editor.setDecorations(t, []);
}

function getTokens(doc) {
  const key = `${doc.version}|${settings.colorCycle}|${settings.fixationRatio}|${settings.minWordLength}`;
  const id = doc.uri.toString();
  let entry = cache.get(id);
  if (!entry || entry.key !== key) {
    entry = {
      key,
      tokens: parseTex(doc.getText(), {
        fixationRatio: settings.fixationRatio,
        minWordLength: settings.minWordLength,
        colorCycle: settings.colorCycle,
      }),
    };
    cache.set(id, entry);
  }
  return entry.tokens;
}

// Visible line ranges (+ margin) converted to merged offset windows.
function visibleWindows(editor) {
  const doc = editor.document;
  const spans = editor.visibleRanges
    .map((r) => [Math.max(0, r.start.line - LINE_MARGIN), Math.min(doc.lineCount - 1, r.end.line + LINE_MARGIN)])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1] + 1) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  return merged.map(([a, b]) => [doc.offsetAt(new vscode.Position(a, 0)), doc.offsetAt(doc.lineAt(b).range.end)]);
}

// First token whose end is beyond `offset` (tokens are sorted and non-overlapping).
function firstTokenAfter(tokens, offset) {
  let lo = 0, hi = tokens.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (tokens[mid].end <= offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function update(editor) {
  if (!editor || !deco) return;
  const doc = editor.document;
  if (!settings.enabled || !isTex(doc)) {
    clear(editor);
    return;
  }

  const tokens = getTokens(doc);
  const nColors = deco.fix.length;
  const buckets = { fix: deco.fix.map(() => []), rest: [], command: [], arg: [], math: [], comment: [] };

  for (const [ws, we] of visibleWindows(editor)) {
    for (let k = firstTokenAfter(tokens, ws); k < tokens.length && tokens[k].start < we; k++) {
      const tk = tokens[k];
      const range = new vscode.Range(doc.positionAt(tk.start), doc.positionAt(tk.end));
      if (tk.type === 'fix') buckets.fix[tk.color % nColors].push(range);
      else if (tk.type === 'rest') buckets.rest.push(range);
      else if (settings.colorizeSyntax && buckets[tk.type]) buckets[tk.type].push(range);
    }
  }

  deco.fix.forEach((t, idx) => editor.setDecorations(t, buckets.fix[idx]));
  editor.setDecorations(deco.rest, buckets.rest);
  for (const k of SYNTAX_TYPES) editor.setDecorations(deco[k], buckets[k]);
}

function schedule(editor, delay) {
  clearTimeout(timers.get(editor));
  timers.set(editor, setTimeout(() => {
    timers.delete(editor);
    update(editor);
  }, delay));
}

function refreshAll() {
  for (const e of vscode.window.visibleTextEditors) update(e);
}

function applySettings() {
  settings = readSettings();
  cache.clear();
  buildDecorations();
  refreshAll();
  updateStatus();
}

const labelOf = (table, key) => t((table[key] || {}).label || String(key));

function updateStatus() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTex(editor.document)) {
    statusItem.hide();
    return;
  }
  const p = PALETTES[settings.palette] || PALETTES.morandi;
  statusItem.text = settings.enabled ? '$(eye) Bionic' : '$(eye-closed) Bionic';
  statusItem.tooltip = [
    t('TeX Bionic: {0}', settings.enabled ? t('On') : t('Off')),
    t('Palette: {0}', t(p.label)),
    t('Depth: {0} · Saturation: {1}', labelOf(DEPTH_LEVELS, settings.depth), labelOf(SATURATION_LEVELS, settings.saturation)),
    t('Contrast: {0}', labelOf(REST_OPACITY, settings.restOpacity)),
    t('Click to open the settings menu'),
  ].join('\n');
  statusItem.show();
}

async function updateSetting(key, value) {
  const c = vscode.workspace.getConfiguration('texBionic');
  const info = c.inspect(key);
  const target = info && info.workspaceFolderValue !== undefined ? vscode.ConfigurationTarget.WorkspaceFolder
    : info && info.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await c.update(key, value, target);
}

/**
 * Quick pick that live-previews each option as the user moves through it.
 * Enter saves the choice; Esc restores the previous setting.
 */
function pickWithPreview(key, title, options) {
  return new Promise((resolve) => {
    const qp = vscode.window.createQuickPick();
    qp.title = title;
    qp.placeholder = t('Move up/down to preview live · Enter to save · Esc to cancel');
    qp.items = options.map((o) => ({
      label: (o.value === settings[key] ? '$(check) ' : '$(blank) ') + t(o.label),
      description: o.description ? t(o.description) : undefined,
      value: o.value,
    }));
    const current = qp.items.find((it) => it.value === settings[key]);
    if (current) qp.activeItems = [current];

    let accepted = false;
    qp.onDidChangeActive((items) => {
      if (!items[0]) return;
      preview = { key, value: items[0].value };
      applySettings();
    });
    qp.onDidAccept(async () => {
      accepted = true;
      const item = qp.selectedItems[0] || qp.activeItems[0];
      qp.hide();
      if (item) await updateSetting(key, item.value);
      preview = null;
      applySettings();
      resolve(true);
    });
    qp.onDidHide(() => {
      qp.dispose();
      if (!accepted) {
        preview = null;
        applySettings();
        resolve(false);
      }
    });
    qp.show();
  });
}

const entries = (table) => Object.entries(table).map(([value, o]) => ({ value, ...o }));

const pickers = {
  palette: () => pickWithPreview('palette', t('Colour palette'), Object.entries(PALETTES).map(([value, p]) => ({
    value, label: p.label, description: p.description,
  }))),
  depth: () => pickWithPreview('depth', t('Colour depth (darker on light themes, lighter on dark themes)'), entries(DEPTH_LEVELS)),
  saturation: () => pickWithPreview('saturation', t('Saturation'), entries(SATURATION_LEVELS)),
  restOpacity: () => pickWithPreview('restOpacity', t('Contrast (strength of the non-bold part)'),
    entries(REST_OPACITY).map((o) => ({ ...o, value: Number(o.value) }))),
  fixationWeight: () => pickWithPreview('fixationWeight', t('Bold weight'), entries(WEIGHTS)),
  colorCycle: () => pickWithPreview('colorCycle', t('Colour cycle'), entries(COLOR_CYCLES)),
};

async function showMenu() {
  const p = PALETTES[settings.palette] || PALETTES.morandi;
  const onOff = (b) => (b ? t('On') : t('Off'));
  const items = [
    { id: 'toggle', label: settings.enabled ? '$(eye-closed) ' + t('Turn off Bionic Reading') : '$(eye) ' + t('Turn on Bionic Reading') },
    { kind: vscode.QuickPickItemKind.Separator, label: t('Colour') },
    { id: 'palette', label: '$(symbol-color) ' + t('Colour palette'), description: t(p.label) },
    { id: 'depth', label: '$(color-mode) ' + t('Colour depth'), description: labelOf(DEPTH_LEVELS, settings.depth) },
    { id: 'saturation', label: '$(paintcan) ' + t('Saturation'), description: labelOf(SATURATION_LEVELS, settings.saturation) },
    { id: 'restOpacity', label: '$(lightbulb) ' + t('Contrast (strength of the non-bold part)'), description: labelOf(REST_OPACITY, settings.restOpacity) },
    { id: 'colorCycle', label: '$(sync) ' + t('Colour cycle'), description: labelOf(COLOR_CYCLES, settings.colorCycle) },
    { kind: vscode.QuickPickItemKind.Separator, label: t('Font and scope') },
    { id: 'fixationWeight', label: '$(bold) ' + t('Bold weight'), description: String(settings.fixationWeight) },
    { id: 'colorizeSyntax', label: '$(symbol-namespace) ' + t('Colour commands, math and comments'), description: onOff(settings.colorizeSyntax) },
    { id: 'colorizeRest', label: '$(text-size) ' + t('Colour the non-bold part'), description: onOff(settings.colorizeRest) },
    { kind: vscode.QuickPickItemKind.Separator, label: '' },
    { id: 'reset', label: '$(discard) ' + t('Reset colour settings to defaults') },
    { id: 'settings', label: '$(gear) ' + t('Open all settings') },
  ];
  const pick = await vscode.window.showQuickPick(items, { title: 'TeX Bionic Morandi', placeHolder: t('Choose what to adjust') });
  if (!pick) return;

  switch (pick.id) {
    case 'toggle': await updateSetting('enabled', !settings.enabled); return;
    case 'colorizeSyntax':
    case 'colorizeRest': await updateSetting(pick.id, !settings[pick.id]); break;
    case 'reset':
      for (const k of ['palette', 'depth', 'saturation', 'restOpacity', 'colorCycle', 'fixationWeight', 'colorizeSyntax', 'colorizeRest']) {
        await updateSetting(k, undefined);
      }
      break;
    case 'settings':
      await vscode.commands.executeCommand('workbench.action.openSettings', 'texBionic');
      return;
    default:
      await pickers[pick.id]();
  }
  // Return to the menu so several options can be adjusted in a row.
  return showMenu();
}

function activate(context) {
  settings = readSettings();
  buildDecorations();

  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'texBionic.menu';

  context.subscriptions.push(
    statusItem,
    { dispose: disposeDecorations },
    { dispose: () => timers.forEach((t) => clearTimeout(t)) },

    vscode.commands.registerCommand('texBionic.menu', showMenu),
    vscode.commands.registerCommand('texBionic.toggle', () => updateSetting('enabled', !settings.enabled)),
    vscode.commands.registerCommand('texBionic.selectPalette', pickers.palette),
    vscode.commands.registerCommand('texBionic.selectDepth', pickers.depth),
    vscode.commands.registerCommand('texBionic.selectSaturation', pickers.saturation),
    vscode.commands.registerCommand('texBionic.selectContrast', pickers.restOpacity),
    vscode.commands.registerCommand('texBionic.selectColorCycle', pickers.colorCycle),

    vscode.window.onDidChangeActiveTextEditor((e) => { updateStatus(); if (e) update(e); }),
    vscode.window.onDidChangeVisibleTextEditors(refreshAll),
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => schedule(e.textEditor, 50)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      for (const ed of vscode.window.visibleTextEditors) {
        if (ed.document === e.document) schedule(ed, 150);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => cache.delete(doc.uri.toString())),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('texBionic')) applySettings();
    }),
  );

  updateStatus();
  refreshAll();
}

function deactivate() {
  disposeDecorations();
}

module.exports = { activate, deactivate };
