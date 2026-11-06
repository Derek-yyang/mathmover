import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assertOpenCodeWorkspaceIsolated, createOpenCodeEnvironment, openCodePaths } from '../src/opencode-environment.ts';

// Dependency staging has its own copy/junction tests. Environment assertions must
// also run from this workspace, which does not install the frontend's plugin SDK.
vi.mock('../src/opencode-plugin-dependencies.ts', () => ({ seedOpenCodePluginDependencies: vi.fn() }));

describe('embedded OpenCode environment', () => {
  it('stops before launch if the internal plugin loader could discover project configuration', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-workspace-'));
    const workspace = path.join(root, 'workspaces', 'courseware');
    fs.mkdirSync(workspace, { recursive: true });
    try {
      expect(() => assertOpenCodeWorkspaceIsolated(workspace)).not.toThrow();
      for (const name of ['opencode.json', 'opencode.jsonc', '.opencode']) {
        const file = path.join(root, name);
        fs.writeFileSync(file, 'foreign configuration');
        expect(() => assertOpenCodeWorkspaceIsolated(workspace)).toThrow(file);
        expect(fs.readFileSync(file, 'utf8')).toBe('foreign configuration');
        fs.unlinkSync(file);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('owns persistent paths, removes inherited overrides, and keeps the MathMover MCP library rooted correctly', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-env-'));
    const inherited = { PATH: '/system/bin', HTTPS_PROXY: 'http://proxy.test', NODE_EXTRA_CA_CERTS: '/corporate-ca.pem',
      OPENCODE_CONFIG: '/foreign.json', opencode_config_content: 'foreign-inline', OPENCODE_AUTH_CONTENT: 'foreign-auth',
      OPENCODE_DB: '/foreign.sqlite', OPENCODE_PURE: '1', OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: '123',
      MATHMOVER_BYOK_API_KEY: 'foreign-key', HOME: '/foreign-home', XDG_DATA_HOME: '/foreign-data' };
    try {
      const env = createOpenCodeEnvironment(root, inherited);
      const paths = openCodePaths(root);
      expect(env.PATH).toBe(inherited.PATH);
      expect(env.HTTPS_PROXY).toBe(inherited.HTTPS_PROXY);
      expect(env.NODE_EXTRA_CA_CERTS).toBe(inherited.NODE_EXTRA_CA_CERTS);
      for (const key of ['OPENCODE_CONFIG', 'opencode_config_content', 'OPENCODE_AUTH_CONTENT', 'OPENCODE_DB', 'OPENCODE_PURE',
        'OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX', 'MATHMOVER_BYOK_API_KEY']) expect(env[key]).toBeUndefined();
      expect(env.HOME).toBe(paths.home);
      expect(env.USERPROFILE).toBe(paths.home);
      expect(env.MATHMOVER_DATA_DIR).toBe(root);
      expect(env.OPENCODE_CONFIG_DIR).toBeUndefined();
      expect(path.join(env.XDG_CONFIG_HOME!, 'opencode')).toBe(paths.config);
      expect(path.join(env.XDG_DATA_HOME!, 'opencode')).toBe(paths.data);
      expect(env.OPENCODE_DISABLE_PROJECT_CONFIG).toBe('1');
      expect(env.OPENCODE_DISABLE_EXTERNAL_SKILLS).toBe('1');
      for (const value of Object.values(paths)) expect(fs.statSync(value).isDirectory()).toBe(true);
      expect(createOpenCodeEnvironment(root).XDG_DATA_HOME).toBe(env.XDG_DATA_HOME);
      expect(inherited.OPENCODE_CONFIG).toBe('/foreign.json');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
