import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function preserve(prefix, stdout, stderr, receipt) {
  await mkdir(path.dirname(prefix), { recursive: true });
  await writeFile(`${prefix}.stdout`, stdout);
  await writeFile(`${prefix}.stderr`, stderr);
  const result = {
    ...receipt,
    capture: 'Node child_process pipes collected as Buffer; identical bytes saved and hashed',
    stdout: { path: `${prefix}.stdout`, bytes: stdout.length, sha256: sha256(stdout) },
    stderr: { path: `${prefix}.stderr`, bytes: stderr.length, sha256: sha256(stderr) },
  };
  await writeJson(`${prefix}.command.json`, result);
  return { ...result, stdoutBytes: stdout, stderrBytes: stderr };
}

// No shell is used. On Windows, execute npm-cli.js with node.exe instead of npm.cmd.
export async function runRecorded({ executable, args = [], cwd, prefix, timeoutMs = 120000, env = {} }) {
  const startedAtUtc = new Date().toISOString();
  const output = [];
  const errors = [];
  const child = spawn(executable, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', bytes => output.push(bytes));
  child.stderr.on('data', bytes => errors.push(bytes));
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    // The retained ChildProcess targets only the process spawned by this call.
    child.kill();
  }, timeoutMs);
  const { exitCode, signal, spawnError } = await new Promise(resolve => {
    let error;
    child.once('error', value => { error = value.message; });
    child.once('close', (code, closeSignal) => resolve({ exitCode: code, signal: closeSignal, spawnError: error ?? null }));
  });
  clearTimeout(timeout);
  return preserve(prefix, Buffer.concat(output), Buffer.concat(errors), {
    executable, args, cwd, processId: child.pid ?? null, startedAtUtc,
    completedAtUtc: new Date().toISOString(), timeoutMs, timedOut, exitCode, signal, spawnError,
  });
}

export async function startRecorded({ executable, args = [], cwd, prefix, timeoutMs = 600000, env = {} }) {
  await mkdir(path.dirname(prefix), { recursive: true });
  const output = [];
  const errors = [];
  const startedAtUtc = new Date().toISOString();
  const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', bytes => output.push(bytes));
  child.stderr.on('data', bytes => errors.push(bytes));
  let timedOut = false;
  let spawnError = null;
  let stopRequested = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
  const completed = new Promise((resolve, reject) => {
    child.once('error', error => { spawnError = error.message; });
    child.once('close', async (exitCode, signal) => {
      clearTimeout(timer);
      try { resolve(await preserve(prefix, Buffer.concat(output), Buffer.concat(errors), { executable, args, cwd, processId: child.pid ?? null, startedAtUtc, completedAtUtc: new Date().toISOString(), timeoutMs, timedOut, stopRequested, exitCode, signal, spawnError })); }
      catch (error) { reject(error); }
    });
  });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  return {
    child, startedAtUtc, completed,
    stop: async () => {
      stopRequested = true;
      // Uses the retained child handle. It never searches by port or executable name.
      if (child.exitCode === null && child.signalCode === null) child.kill();
      const receipt = await completed;
      await verifySavedBytes(receipt);
      return receipt;
    },
  };
}

// These are transport bytes, without JSON reformatting, text decoding, or newline conversion.
export async function requestRecorded({ baseUrl, route, method = 'GET', headers = {}, body, prefix, timeoutMs = 10000 }) {
  const requestBytes = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body), 'utf8');
  const url = new URL(route, baseUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Independent acceptance only sends HTTP to its local isolated services.');
  }
  const requestHeaders = { ...headers };
  if (body !== undefined) {
    requestHeaders['Content-Type'] ??= 'application/json';
    requestHeaders['Content-Length'] = requestBytes.length;
  }
  const startedAtUtc = new Date().toISOString();
  const result = await new Promise(resolve => {
    const req = http.request(url, { method, headers: requestHeaders }, response => {
      const chunks = [];
      response.on('data', bytes => chunks.push(bytes));
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, rawHeaders: response.rawHeaders, bytes: Buffer.concat(chunks), error: null }));
      response.once('error', error => resolve({ status: response.statusCode, headers: response.headers, rawHeaders: response.rawHeaders, bytes: Buffer.concat(chunks), error: error.message }));
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`HTTP timeout after ${timeoutMs}ms`)));
    req.once('error', error => resolve({ status: null, headers: {}, rawHeaders: [], bytes: Buffer.alloc(0), error: error.message }));
    if (requestBytes.length) req.write(requestBytes);
    req.end();
  });
  await mkdir(path.dirname(prefix), { recursive: true });
  await writeFile(`${prefix}.request`, requestBytes);
  await writeFile(`${prefix}.response`, result.bytes);
  const receipt = {
    url: url.href, method, requestHeaders, startedAtUtc, completedAtUtc: new Date().toISOString(), timeoutMs,
    request: { path: `${prefix}.request`, bytes: requestBytes.length, sha256: sha256(requestBytes) },
    response: { path: `${prefix}.response`, bytes: result.bytes.length, sha256: sha256(result.bytes), status: result.status, headers: result.headers, rawHeaders: result.rawHeaders },
    error: result.error,
  };
  await writeJson(`${prefix}.http.json`, receipt);
  return { ...receipt, responseBytes: result.bytes, json: result.bytes.length ? safeJson(result.bytes) : null };
}

function safeJson(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { return null; }
}

export async function snapshotFiles(root) {
  const result = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Fixture must not contain links: ${fullPath}`);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) {
        const bytes = await readFile(fullPath);
        result.push({ path: path.relative(root, fullPath).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256(bytes) });
      } else throw new Error(`Unsupported fixture entry: ${fullPath}`);
    }
  }
  try { await stat(root); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  await walk(root);
  return result.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

export function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function verifySavedBytes(receipt) {
  for (const field of ['stdout', 'stderr']) {
    const bytes = await readFile(receipt[field].path);
    if (bytes.length !== receipt[field].bytes || sha256(bytes) !== receipt[field].sha256) {
      throw new Error(`Evidence bytes/hash mismatch: ${receipt[field].path}`);
    }
  }
}
