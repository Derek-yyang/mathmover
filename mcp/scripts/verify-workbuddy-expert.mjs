import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const expertRoot = path.resolve(
  process.env.MATHMOVER_EXPERT_ROOT
    ?? path.join(os.homedir(), '.workbuddy/plugins/marketplaces/my-experts/plugins/mathmover-builder'),
);
const manifestPath = path.join(expertRoot, '.codebuddy-plugin/plugin.json');
const packagePath = path.join(expertRoot, 'package.json');
const agentPath = path.join(expertRoot, 'agents/mathmover-builder.md');
const skillPath = path.join(expertRoot, 'skills/mathmover-workbuddy/SKILL.md');
const bootstrapPath = path.join(expertRoot, 'skills/mathmover-workbuddy/bootstrap.ps1');

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
const agent = await fs.readFile(agentPath, 'utf8');
const skill = await fs.readFile(skillPath, 'utf8');
const bootstrap = await fs.readFile(bootstrapPath, 'utf8');

assert.equal(manifest.name, 'mathmover-builder');
assert.equal(packageJson.name, 'mathmover-builder');
assert.equal(packageJson.version, manifest.version);
assert.equal(manifest.dependencies?.mcpServers, undefined);
assert.match(manifest.skills?.[0] ?? '', /mathmover-workbuddy/);
assert.match(agent, /mathmover_open_canvas/);
assert.match(agent, /自动安装脚本/);
assert.match(skill, /bootstrap\.ps1/);
assert.match(skill, /MATHMOVER_BOOTSTRAP=success/);
assert.match(bootstrap, /MATHMOVER_BOOTSTRAP=success/);
assert.match(bootstrap, /registry\.npmjs\.org/);

for (const forbidden of ['.mcp.json', 'bin', 'runtime']) {
  await assert.rejects(fs.access(path.join(expertRoot, forbidden)));
}

const files = [];
async function collect(current = expertRoot) {
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) await collect(absolute);
    else files.push(path.relative(expertRoot, absolute));
  }
}
await collect();

const zipPath = path.join(path.dirname(expertRoot), `${manifest.name}.zip`);
const zip = await fs.stat(zipPath).catch(() => undefined);
console.log(`PASS: ${expertRoot}`);
console.log(`Version ${manifest.version}; files ${files.length}${zip ? `; zip ${zip.size} bytes` : ''}`);
console.log('Slim expert uses the independently installed WorkBuddy MCP; no bundled runtime or .mcp.json.');
