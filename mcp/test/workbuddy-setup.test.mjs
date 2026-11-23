import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist/cli.cjs');

test('setup-workbuddy preserves other MCP servers and backs up the previous file', async t => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mathmover-workbuddy-config-'));
  const configPath = path.join(configDir, 'mcp.json');
  await fs.writeFile(configPath, JSON.stringify({
    customSetting: true,
    mcpServers: {
      other: { command: 'other-server.exe', args: ['serve'] },
    },
  }, null, 2));
  t.after(() => fs.rm(configDir, { recursive: true, force: true }));

  const dryRun = spawnSync(process.execPath, [
    cli,
    'setup-workbuddy',
    '--config-dir',
    configDir,
    '--dry-run',
  ], { encoding: 'utf8' });
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const preview = JSON.parse(dryRun.stdout);
  assert.equal(preview.config.mcpServers.other.command, 'other-server.exe');
  assert.equal(preview.config.mcpServers.mathmover.command, process.execPath.replaceAll('\\', '/'));
  assert.equal((await fs.readFile(configPath, 'utf8')).includes('mathmover'), false);

  const applied = spawnSync(process.execPath, [
    cli,
    'setup-workbuddy',
    '--config-dir',
    configDir,
  ], { encoding: 'utf8' });
  assert.equal(applied.status, 0, applied.stderr);
  const written = JSON.parse(await fs.readFile(configPath, 'utf8'));
  assert.equal(written.customSetting, true);
  assert.equal(written.mcpServers.other.command, 'other-server.exe');
  assert.equal(written.mcpServers.mathmover.command, process.execPath.replaceAll('\\', '/'));
  assert.deepEqual(written.mcpServers.mathmover.args, [cli.replaceAll('\\', '/')]);

  const files = await fs.readdir(configDir);
  assert.equal(files.filter(file => file.startsWith('mcp.json.backup-')).length, 1);

  const unchanged = spawnSync(process.execPath, [
    cli,
    'setup-workbuddy',
    '--config-dir',
    configDir,
  ], { encoding: 'utf8' });
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.match(unchanged.stdout, /已是当前版本/);
});

test('setup-workbuddy refuses to overwrite invalid JSON', async t => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mathmover-workbuddy-invalid-'));
  const configPath = path.join(configDir, 'mcp.json');
  await fs.writeFile(configPath, '{ invalid json');
  t.after(() => fs.rm(configDir, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [
    cli,
    'setup-workbuddy',
    '--config-dir',
    configDir,
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(await fs.readFile(configPath, 'utf8'), '{ invalid json');
});
