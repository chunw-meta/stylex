/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { unplugin } = require('../src');

describe('@stylexjs/unplugin', () => {
  test('ignores files without StyleX imports', async () => {
    const plugin = unplugin.raw({});
    if (typeof plugin.buildStart === 'function') {
      plugin.buildStart();
    }
    const result = await plugin.transform('const noop = 1;', '/virtual/foo.js');
    expect(result).toBeNull();
  });

  test('writes fallback CSS asset when no CSS bundle entry exists', async () => {
    const plugin = unplugin.rollup({
      runtimeInjection: false,
      devPersistToDisk: false,
      dev: false,
    });
    if (typeof plugin.buildStart === 'function') {
      plugin.buildStart();
    }
    const source = `
      import * as stylex from '@stylexjs/stylex';
      const styles = stylex.create({ foo: { color: 'red' } });
      export default styles;
    `;
    const result = await plugin.transform(source, '/virtual/example.js');
    expect(result).not.toBeNull();

    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stylex-unplugin-test-'),
    );
    try {
      await plugin.writeBundle({ dir: tempDir }, {});
      const cssPath = path.join(tempDir, 'assets', 'stylex.css');
      expect(fs.existsSync(cssPath)).toBe(true);
      const cssContent = fs.readFileSync(cssPath, 'utf8');
      expect(cssContent).toContain('color: red;');
      expect(cssContent.trim()).toMatch(
        /^\.[a-z0-9]+ \{\n {2}color: red;\n\}$/i,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('marks StyleX deps as non-optimized in Vite', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stylex-unplugin-vite-'),
    );
    const originalCwd = process.cwd();
    try {
      const pkgJson = {
        dependencies: {
          'lib-using-stylex': '1.0.0',
          'lib-no-stylex': '1.0.0',
        },
      };
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(pkgJson),
        'utf8',
      );
      fs.mkdirSync(path.join(tempDir, 'node_modules', 'lib-using-stylex'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(tempDir, 'node_modules', 'lib-using-stylex', 'package.json'),
        JSON.stringify({
          name: 'lib-using-stylex',
          version: '1.0.0',
          dependencies: { '@stylexjs/stylex': '^0.0.0' },
        }),
        'utf8',
      );
      fs.mkdirSync(path.join(tempDir, 'node_modules', 'lib-no-stylex'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(tempDir, 'node_modules', 'lib-no-stylex', 'package.json'),
        JSON.stringify({
          name: 'lib-no-stylex',
          version: '1.0.0',
        }),
        'utf8',
      );
      process.chdir(tempDir);

      const nestedDir = path.join(tempDir, 'nested', 'deeper');
      fs.mkdirSync(nestedDir, { recursive: true });
      process.chdir(nestedDir);

      const plugin = unplugin.vite({});
      const viteConfigHook = plugin.config;
      const result =
        typeof viteConfigHook === 'function'
          ? await viteConfigHook.call(
              plugin,
              {},
              { command: 'serve', mode: 'development' },
            )
          : null;
      expect(result?.optimizeDeps?.exclude).toEqual(
        expect.arrayContaining(['lib-using-stylex']),
      );
      expect(result?.optimizeDeps?.exclude || []).not.toEqual(
        expect.arrayContaining(['lib-no-stylex']),
      );
      expect(result?.ssr?.optimizeDeps?.exclude).toEqual(
        expect.arrayContaining(['lib-using-stylex']),
      );

      const pluginWithManual = unplugin.vite({
        externalPackages: ['manual-stylex-lib'],
      });
      const manualResult =
        typeof pluginWithManual.config === 'function'
          ? await pluginWithManual.config(
              {},
              { command: 'serve', mode: 'development' },
            )
          : null;
      expect(manualResult?.optimizeDeps?.exclude).toEqual(
        expect.arrayContaining(['manual-stylex-lib', 'lib-using-stylex']),
      );
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
  test('respects project browserslist config and preserves light-dark() for modern targets', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stylex-browserslist-'),
    );
    const originalCwd = process.cwd();
    try {
      // Create a browserslist config targeting modern Chrome (supports light-dark)
      fs.writeFileSync(
        path.join(tempDir, '.browserslistrc'),
        'last 1 Chrome version\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test' }),
        'utf8',
      );
      process.chdir(tempDir);

      const plugin = unplugin.rollup({
        runtimeInjection: false,
        devPersistToDisk: false,
        dev: false,
      });
      if (typeof plugin.buildStart === 'function') {
        plugin.buildStart();
      }
      const source = `
        import * as stylex from '@stylexjs/stylex';
        const styles = stylex.create({ foo: { color: 'light-dark(#000, #fff)' } });
        export default styles;
      `;
      const result = await plugin.transform(source, '/virtual/example.js');
      expect(result).not.toBeNull();

      await plugin.writeBundle({ dir: tempDir }, {});
      const cssPath = path.join(tempDir, 'assets', 'stylex.css');
      expect(fs.existsSync(cssPath)).toBe(true);
      const cssContent = fs.readFileSync(cssPath, 'utf8');
      // With modern Chrome targets from .browserslistrc, light-dark() should be preserved
      expect(cssContent).toContain('light-dark(');
      expect(cssContent).not.toContain('--lightningcss-light');
      expect(cssContent).not.toContain('--lightningcss-dark');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('polyfills light-dark() when lightningcssOptions targets old browsers', async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stylex-old-targets-'),
    );
    const originalCwd = process.cwd();
    try {
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'test' }),
        'utf8',
      );
      process.chdir(tempDir);

      const plugin = unplugin.rollup({
        runtimeInjection: false,
        devPersistToDisk: false,
        dev: false,
        lightningcssOptions: {
          // Chrome 112 does NOT support light-dark()
          targets: { chrome: 112 << 16 },
        },
      });
      if (typeof plugin.buildStart === 'function') {
        plugin.buildStart();
      }
      const source = `
        import * as stylex from '@stylexjs/stylex';
        const styles = stylex.create({ foo: { color: 'light-dark(#000, #fff)' } });
        export default styles;
      `;
      const result = await plugin.transform(source, '/virtual/example.js');
      expect(result).not.toBeNull();

      await plugin.writeBundle({ dir: tempDir }, {});
      const cssPath = path.join(tempDir, 'assets', 'stylex.css');
      expect(fs.existsSync(cssPath)).toBe(true);
      const cssContent = fs.readFileSync(cssPath, 'utf8');
      // With old Chrome targets, light-dark() should be polyfilled by lightningcss
      expect(cssContent).toContain('--lightningcss-light');
      expect(cssContent).not.toContain('light-dark(');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
