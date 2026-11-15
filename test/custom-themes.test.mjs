import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const customThemes = require('../custom-themes.js');

test('PALETTE_IDS and AURORA_IDS cover all Studio, 6 Aurora dual-mode themes, and Host', () => {
  assert.deepEqual(customThemes.PALETTE_IDS, [
    'obsidian',
    'claude',
    'gemini',
    'sky',
    'cyan',
    'orange',
    'red',
    'purple',
    'host',
  ]);
  assert.deepEqual(customThemes.AURORA_IDS, ['gemini', 'sky', 'cyan', 'orange', 'red', 'purple']);
  assert.equal(customThemes.normalizePalette('gemini'), 'gemini');
  assert.equal(customThemes.normalizePalette('purple'), 'purple');
  assert.equal(customThemes.normalizePalette('stock'), 'host');
  assert.equal(customThemes.normalizePalette('unknown-palette'), 'obsidian');
  assert.equal(customThemes.isAuroraPalette('gemini'), true);
  assert.equal(customThemes.isAuroraPalette('obsidian'), false);
  assert.equal(customThemes.isAuroraPalette('host'), false);
});

test('getPaletteLabel returns dual-mode Light/Dark localized names across all 5 languages', () => {
  assert.equal(customThemes.getPaletteLabel('gemini', 'zh-CN', false), '四色极光');
  assert.equal(customThemes.getPaletteLabel('gemini', 'zh-CN', true), '暗夜极光');
  assert.equal(customThemes.getPaletteLabel('gemini', 'zh-TW', false), '四色極光');
  assert.equal(customThemes.getPaletteLabel('gemini', 'en', false), 'Aurora Prism');
  assert.equal(customThemes.getPaletteLabel('gemini', 'en', true), 'Midnight Aurora');
  assert.equal(customThemes.getPaletteLabel('gemini', 'ja', true), '暗夜オーロラ');

  assert.equal(customThemes.getPaletteLabel('sky', 'zh-CN', false), '蔚蓝晴空');
  assert.equal(customThemes.getPaletteLabel('sky', 'zh-CN', true), '深海晴空');
  assert.equal(customThemes.getPaletteLabel('cyan', 'zh-CN', false), '碧水青波');
  assert.equal(customThemes.getPaletteLabel('cyan', 'zh-CN', true), '幽谷碧波');
  assert.equal(customThemes.getPaletteLabel('orange', 'zh-CN', false), '落霞暖橙');
  assert.equal(customThemes.getPaletteLabel('orange', 'zh-CN', true), '熔岩暮色');
  assert.equal(customThemes.getPaletteLabel('red', 'zh-CN', false), '丹霞绯红');
  assert.equal(customThemes.getPaletteLabel('red', 'zh-CN', true), '丝绒酒红');
  assert.equal(customThemes.getPaletteLabel('purple', 'zh-CN', false), '紫罗幽兰');
  assert.equal(customThemes.getPaletteLabel('purple', 'zh-CN', true), '幻夜幽紫');
});

test('renderPaletteIcon scopes SVG gradient IDs cleanly without collisions', () => {
  for (const id of customThemes.PALETTE_IDS) {
    const svgBtn = customThemes.renderPaletteIcon(id, 'btn');
    const svgDd = customThemes.renderPaletteIcon(id, 'dd-' + id);
    assert.ok(svgBtn.startsWith('<svg'), `Expected SVG for ${id}`);
    assert.ok(svgBtn.includes('-btn"'), `Expected -btn scoped gradient id for ${id}`);
    assert.ok(svgDd.includes(`-dd-${id}"`), `Expected -dd-${id} scoped gradient id for ${id}`);
  }
});

test('buildAuroraCss compiles Light and Dark Aurora CSS with harmonized --ag-cs-* tokens', () => {
  assert.equal(customThemes.buildAuroraCss('obsidian', true), '');
  assert.equal(customThemes.buildAuroraCss('claude', false), '');
  assert.equal(customThemes.buildAuroraCss('host', true), '');

  for (const id of customThemes.AURORA_IDS) {
    const lightCss = customThemes.buildAuroraCss(id, false);
    const darkCss = customThemes.buildAuroraCss(id, true);
    assert.ok(lightCss.length > 20000, `Light CSS too short for ${id}`);
    assert.ok(darkCss.length > lightCss.length, `Dark CSS should include DARK_DELTA_CSS for ${id}`);
    for (const css of [lightCss, darkCss]) {
      assert.ok(css.includes('--ag-mesh:'), `Missing --ag-mesh in ${id}`);
      assert.ok(css.includes('--ag-cs-popover-bg:'), `Missing --ag-cs-popover-bg in ${id}`);
      assert.ok(css.includes('--ag-cs-composer-bg:'), `Missing --ag-cs-composer-bg in ${id}`);
      assert.ok(css.includes('--ag-cs-ripple-ink:#'), `Missing hex --ag-cs-ripple-ink in ${id}`);
      assert.ok(css.includes('--ag-cs-ripple-wave:#'), `Missing hex --ag-cs-ripple-wave in ${id}`);
      assert.ok(css.includes('#ag-cs-theme-btn'), `Missing #ag-cs-theme-btn glass rule in ${id}`);
    }
    const tbLight = customThemes.getTitlebarColors(id, false);
    const tbDark = customThemes.getTitlebarColors(id, true);
    assert.match(tbLight.color, /^#[0-9A-Fa-f]{6}$/);
    assert.match(tbDark.color, /^#[0-9A-Fa-f]{6}$/);
  }
});
