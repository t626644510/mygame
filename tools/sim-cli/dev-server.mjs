import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const options = new Map();
for (let i = 2; i < process.argv.length; i += 2) options.set(process.argv[i], process.argv[i + 1]);
const port = Number(options.get('--port') ?? '5185');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
const resolve = value => path.resolve(repository, value);
const contentRoot = resolve(options.get('--content') ?? 'work/p1_frontend_20261116/review-fixture/content');
const exportRoot = resolve(options.get('--export-out') ?? 'work/p1_frontend_20261116/review-fixture/runtime');
const identityDirectory = resolve(options.get('--identity-dir') ?? `work/p1_backend_${port}`);
const dotnet = resolve(options.get('--dotnet') ?? 'work/p0_20261116/dotnet/dotnet.exe');
const cli = resolve(options.get('--cli') ?? 'tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll');
for (const value of [contentRoot, exportRoot, identityDirectory]) {
  const relative = path.relative(repository, value);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Development roots must stay in the checkout');
}
mkdirSync(identityDirectory, { recursive: true });
const prefix = `server-${process.pid}`;
const stdoutPath = path.join(identityDirectory, `${prefix}.stdout`);
const stderrPath = path.join(identityDirectory, `${prefix}.stderr`);
const stdout = openSync(stdoutPath, 'wx');
const stderr = openSync(stderrPath, 'wx');
const args = [cli, 'serve', '--port', String(port), '--content', contentRoot, '--export-out', exportRoot];
const sha = value => createHash('sha256').update(value).digest('hex');
const sourceDirectory = resolve('tools/sim-cli/src/MyGame.Sim.Cli');
const sources = readdirSync(sourceDirectory).filter(name => name.endsWith('.cs')).sort().map(name => ({ path: `tools/sim-cli/src/MyGame.Sim.Cli/${name}`, sha256: sha(readFileSync(path.join(sourceDirectory, name))) }));
const child = spawn(dotnet, args, { cwd: repository, windowsHide: true, stdio: ['ignore', stdout, stderr], env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false' } });
let identity;
child.on('spawn', async () => {
  identity = { schemaVersion: 1, scope: 'P1 isolated development backend', pid: child.pid, parentPid: process.pid, executable: dotnet, args, cwd: repository, contentRoot, exportRoot, port, bind: '127.0.0.1', parentExecutable: process.execPath, launcherArgs: process.argv, cliSha256: sha(readFileSync(cli)), sources, stdoutPath, stderrPath, startedAt: new Date().toISOString(), state: 'starting' };
  const save = () => {
    const text = JSON.stringify(identity, null, 2) + '\n';
    writeFileSync(path.join(identityDirectory, `${prefix}.json`), text);
    writeFileSync(path.join(identityDirectory, 'backend-process.json'), text);
  };
  save();
  for (let attempt = 0; attempt < 50 && child.exitCode === null; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
      const health = await response.json();
      if (response.ok && path.resolve(health.contentRoot) === contentRoot) {
        identity.state = 'ready'; identity.health = health; save();
        console.log(JSON.stringify(identity)); return;
      }
    } catch { /* Wait for the owned process to bind. */ }
    await new Promise(done => setTimeout(done, 100));
  }
  if (child.exitCode === null) { identity.state = 'readiness-failed'; save(); child.kill(); }
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  closeSync(stdout); closeSync(stderr);
  if (identity) {
    identity.state = 'stopped'; identity.exitCode = code; identity.signal = signal; identity.stoppedAt = new Date().toISOString();
    const text = JSON.stringify(identity, null, 2) + '\n';
    writeFileSync(path.join(identityDirectory, `${prefix}.json`), text);
    writeFileSync(path.join(identityDirectory, 'backend-process.json'), text);
  }
  process.exitCode = code ?? 1;
});
process.on('SIGINT', () => child.kill('SIGTERM'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
