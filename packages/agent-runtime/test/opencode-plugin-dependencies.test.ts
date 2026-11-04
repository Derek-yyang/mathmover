import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { openCodePluginDependencyDirectories, seedOpenCodePluginDependencies } from '../src/opencode-plugin-dependencies.ts';

function fixture(root: string) {
  const modules = path.join(root, 'application', 'node_modules');
  const writePackage = (name: string, version: string, dependencies: Record<string, string>, code: string) => {
    const directory = path.join(modules, name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version, dependencies, main: 'index.cjs' }));
    fs.writeFileSync(path.join(directory, 'index.cjs'), code);
    return directory;
  };
  writePackage('sdk-leaf', '2.0.0', {}, 'module.exports = 42;');
  writePackage('sdk-parent', '1.0.0', { 'sdk-leaf': '2.0.0' }, "module.exports = require('sdk-leaf');");
  return writePackage('@opencode-ai/plugin', '1.19.3', { 'sdk-parent': '1.0.0' }, "module.exports = require('sdk-parent');");
}

describe('bundled OpenCode plugin dependencies', () => {
  it('packages a self-contained SDK tree that works after removing the build installation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-sdk-copy-'));
    try {
      const source = fixture(root);
      const config = path.join(root, 'package', 'opencode-config');
      expect(openCodePluginDependencyDirectories(source)).toHaveLength(3);
      seedOpenCodePluginDependencies(config, source);
      fs.rmSync(path.join(root, 'application'), { recursive: true });
      const require = createRequire(path.join(config, 'probe.cjs'));
      expect(require('@opencode-ai/plugin')).toBe(42);
      expect(fs.lstatSync(path.join(config, 'node_modules', '@opencode-ai', 'plugin')).isSymbolicLink()).toBe(false);
      const lock = JSON.parse(fs.readFileSync(path.join(config, 'package-lock.json'), 'utf8'));
      expect(Object.keys(lock.packages)).toHaveLength(4);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('refreshes the runtime junction when the installation changes without changing the SDK version', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-sdk-link-'));
    try {
      const first = fixture(path.join(root, 'first'));
      const second = fixture(path.join(root, 'second'));
      const config = path.join(root, 'runtime', 'config');
      seedOpenCodePluginDependencies(config, first, true);
      seedOpenCodePluginDependencies(config, second, true);
      expect(fs.realpathSync(path.join(config, 'node_modules', '@opencode-ai', 'plugin'))).toBe(fs.realpathSync(second));
      expect(fs.existsSync(path.join(first, 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(second, 'package.json'))).toBe(true);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
