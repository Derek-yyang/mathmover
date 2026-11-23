import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'mathmover-mcp-packed-'));
const npmExecPath = process.env.npm_execpath;
const packedName = process.argv[2]
  ? null
  : npmExecPath
    ? execFileSync(process.execPath, [npmExecPath, 'pack', '--pack-destination', temporary], {
        cwd: root,
        encoding: 'utf8',
      }).trim().split(/\r?\n/).at(-1)
    : execFileSync('npm', ['pack', '--pack-destination', temporary], {
        cwd: root,
        encoding: 'utf8',
        shell: true,
      }).trim().split(/\r?\n/).at(-1);
const archive = path.resolve(process.argv[2] ?? path.join(temporary, packedName));
const dataDir = path.join(temporary, 'data');
const client = new Client({ name: 'package-verifier', version: '1' });
async function removeTemporaryDirectory() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fs.rm(temporary, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error?.code) || attempt === 49) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
}
try {
  execFileSync('tar', ['-xzf', archive, '-C', temporary]);
  const installed = path.join(temporary, 'package');
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [path.join(installed, 'dist/cli.cjs'), '--data-dir', dataDir],
    cwd: temporary, env: { NODE_PATH: '' }, stderr: 'pipe' });
  transport.stderr?.on('data', bytes => process.stderr.write(bytes));
  await client.connect(transport);
  const tools = await client.listTools();
  const openTool = tools.tools.find(tool => tool.name === 'mathmover_open_canvas');
  assert.match(openTool?._meta?.ui?.resourceUri, /^ui:\/\/mathmover\/canvas-[a-f0-9]{12}\.html$/);
  const appResource = await client.readResource({ uri: openTool._meta.ui.resourceUri });
  assert.equal(appResource.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(appResource.contents[0].text, /<iframe/);
  const result = await client.callTool({ name: 'mathmover_open_canvas', arguments: { title: '独立分发检查' } });
  assert.ok(!result.isError, JSON.stringify(result));
  const canvas = JSON.parse(result.content[0].text);
  assert.equal((await fetch(canvas.url)).status, 200);
  const origin = new URL(canvas.url).origin;
  assert.equal((await fetch(`${origin}/canvas.js`)).status, 200);
  assert.equal((await fetch(`${origin}/vendor/geogebra/5.4.931.2/deployggb.js`)).status, 200);
  const knowledge = await client.callTool({ name: 'get_expert_prompt', arguments: { category: 'D' } });
  assert.ok(!knowledge.isError, JSON.stringify(knowledge));
  assert.ok(canvas.workfile.startsWith(temporary));
  console.log('PASS: packed archive starts outside the repository, serves bundled canvas/runtime assets and supplies expert knowledge');
} finally {
  await client.close();
  try {
    const info = JSON.parse(await fs.readFile(path.join(dataDir, 'daemon.json'), 'utf8'));
    await fetch(`${info.origin}/api/control/shutdown`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${info.controlToken}` },
    });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        process.kill(info.pid, 0);
      } catch {
        break;
      }
      try {
        await fetch(`${info.origin}/api/control/health`, {
          headers: { Authorization: `Bearer ${info.controlToken}` },
        });
      } catch {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } catch {
    // The package verifier may fail before the daemon starts.
  }
  await removeTemporaryDirectory();
}
