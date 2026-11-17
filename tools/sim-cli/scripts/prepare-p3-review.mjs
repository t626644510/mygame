import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invalidLayouts, chainProbes } from '../../editor-verification/p3/fixtures.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = path.join(repository, 'content');
const work = path.join(repository, 'work');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
let createdRoot;

async function info(file) {
  try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Reject links in source data and destination ancestors; never follow a work junction.
async function realDirectories(directory) {
  const absolute = path.resolve(directory), root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const entry = await info(current);
    if (entry && (!entry.isDirectory() || entry.isSymbolicLink())) throw new Error(`Not a plain directory: ${current}`);
  }
}

async function files(directory, prefix = '') {
  await realDirectories(directory);
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Source link is not supported: ${full}`);
    if (entry.isDirectory()) result.push(...await files(full, relative));
    else if (entry.isFile()) {
      const bytes = await readFile(full);
      result.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
    } else throw new Error(`Unsupported source entry: ${full}`);
  }
  return result;
}

async function main() {
  if (process.argv.length === 3 && ['--help', '-h'].includes(process.argv[2])) {
    console.log('node tools/sim-cli/scripts/prepare-p3-review.mjs --preset clean|layout-errors|chain --out work/<new-directory> [--port 5185] [--ui-port 5175] [--dotnet <executable>] [--cli <dll>]');
    return;
  }
  const options = new Map();
  const names = ['--preset', '--out', '--port', '--ui-port', '--dotnet', '--cli'];
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i], value = process.argv[i + 1];
    if (!names.includes(name) || !value || value.startsWith('--') || options.has(name)) throw new Error(`Invalid argument: ${name}`);
    options.set(name, value);
  }
  const preset = options.get('--preset');
  if (!['clean', 'layout-errors', 'chain'].includes(preset) || !options.has('--out')) throw new Error('Use --preset clean|layout-errors|chain --out work/<new-directory>.');
  const target = path.resolve(repository, options.get('--out'));
  const relative = path.relative(work, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('The new review directory must be a child of this checkout\'s work/.');
  if (await info(target)) throw new Error(`Refusing existing path; choose a new directory: ${target}`);
  await realDirectories(path.dirname(target));
  const port = Number(options.get('--port') ?? 5185), uiPort = Number(options.get('--ui-port') ?? 5175);
  if (![port, uiPort].every(value => Number.isInteger(value) && value >= 1 && value <= 65535) || port === uiPort) throw new Error('Use different backend/UI ports in 1..65535.');
  const sourceBefore = await files(source);
  const additions = [];
  const add = (type, entity) => additions.push({ type, entity, path: `${{ item: 'items', recipe: 'recipes', building: 'buildings', layout: 'layouts' }[type]}/${entity.id}.json` });
  if (preset === 'layout-errors') {
    for (const probe of invalidLayouts()) {
      if (probe.definition) add('building', probe.definition);
      add('layout', probe.entity);
    }
  }
  if (preset === 'chain') {
    const grain = JSON.parse(await readFile(path.join(source, 'items/mat_grain.json'), 'utf8'));
    for (const id of ['mat_moon_silk', 'mat_review_no_source', 'mat_review_no_sink']) {
      add('item', { ...structuredClone(grain), id, aliases: [], name: `P3 review: ${id}`, description: 'Isolated static analysis example; not an adopted item or economy rule.', baseValue: 2, tags: [] });
    }
    const probes = chainProbes();
    // The acceptance fixtures are normally tested one at a time. Separate these
    // endpoints so the simultaneous cycle cannot supply/consume their examples.
    probes.noSource.inputs[0].itemId = 'mat_review_no_source';
    probes.noSink.outputs[0].itemId = 'mat_review_no_sink';
    for (const entity of [probes.noSource, ...probes.cycle, probes.noBuilding, probes.noSink, probes.nonPositiveMargin]) add('recipe', entity);
  }
  const ids = new Set(), sourcePaths = new Set(sourceBefore.map(row => row.path));
  for (const row of sourceBefore.filter(row => row.path.endsWith('.json'))) {
    const value = JSON.parse(await readFile(path.join(source, row.path), 'utf8'));
    if (value && !Array.isArray(value) && typeof value.id === 'string') {
      ids.add(value.id); for (const alias of value.aliases ?? []) ids.add(alias);
    }
  }
  for (const row of additions) {
    if (sourcePaths.has(row.path) || ids.has(row.entity.id)) throw new Error(`Preset ID already exists in canonical content: ${row.entity.id}`);
    ids.add(row.entity.id);
  }
  await mkdir(path.dirname(target), { recursive: true });
  await realDirectories(path.dirname(target));
  await mkdir(target, { recursive: false }); // Atomic claim; an existing empty directory also fails.
  createdRoot = target;
  const contentRoot = path.join(target, 'content'), runtimeRoot = path.join(target, 'runtime');
  await mkdir(contentRoot); await mkdir(runtimeRoot);
  for (const row of sourceBefore) {
    const destination = path.join(contentRoot, row.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(source, row.path), destination, constants.COPYFILE_EXCL);
    if (sha256(await readFile(destination)) !== row.sha256) throw new Error(`Source changed during copy: ${row.path}`);
  }
  for (const row of additions) {
    const destination = path.join(contentRoot, row.path);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, jsonBytes(row.entity), { flag: 'wx' });
  }
  if (JSON.stringify(await files(source)) !== JSON.stringify(sourceBefore)) throw new Error('Canonical content changed while preparing; no files are deleted or reset.');
  const dotnet = options.get('--dotnet') ?? 'dotnet';
  const cli = path.resolve(repository, options.get('--cli') ?? 'tools/sim-cli/src/MyGame.Sim.Cli/bin/Release/net8.0/sim-cli.dll');
  const route = (type, id) => `${type === 'recipe' ? '#/production/recipe' : type === 'item' ? '#/items' : `#/map/${type}`}/${id}`;
  const receipt = {
    schemaVersion: 1, preset, sourceRoot: source, workRoot: target, contentRoot, runtimeRoot,
    notice: '仅静态设计与检查，运行时未接入。准备操作不启动服务，不修改 canonical content。',
    expected: { exportAllowed: preset !== 'layout-errors', layoutErrorCodes: preset === 'layout-errors' ? invalidLayouts().map(probe => probe.code) : [],
      analysisWarningCodes: preset === 'chain' ? ['no_source', 'cycle', 'no_building', 'no_sink', 'non_positive_margin'] : [] },
    samples: [{ type: 'layout', id: 'layout_first_meal_near' }, { type: 'layout', id: 'layout_first_meal_far' }, { type: 'recipe', id: 'rcp_simple_meal' }, ...additions.map(row => ({ type: row.type, id: row.entity.id }))]
      .map(row => ({ ...row, url: `http://127.0.0.1:${uiPort}/${route(row.type, row.id)}` })),
    chainUrl: `http://127.0.0.1:${uiPort}/#/production/chain`,
    commands: { syntax: 'PowerShell; build the current source with SDK 8.0.428 first. See tools/sim-cli/README.md.',
      backend: `& ${quote(dotnet)} ${quote(cli)} serve --content ${quote(contentRoot)} --export-out ${quote(runtimeRoot)} --port ${port}`,
      frontend: `Set-Location ${quote(path.join(repository, 'tools/editor-web'))}\n$env:SIM_API_URL = ${quote(`http://127.0.0.1:${port}`)}\nnpm.cmd ci --cache ${quote(path.join(target, 'npm-cache'))}\nnpm.cmd run dev -- --port ${uiPort}`,
      stop: '在各自启动终端按 Ctrl+C，只关闭自己启动的服务。',
      restore: '选择另一个不存在的 work/ 子目录，再执行 --preset clean；不覆盖或删除已有编辑目录。' },
    copiedFiles: sourceBefore, addedFiles: await Promise.all(additions.map(async row => { const bytes = await readFile(path.join(contentRoot, row.path)); return { path: row.path, bytes: bytes.length, sha256: sha256(bytes) }; })),
  };
  await writeFile(path.join(target, 'P3_REVIEW_PRESET.json'), jsonBytes(receipt), { flag: 'wx' });
  process.stdout.write(jsonBytes({ ...receipt, manifest: path.join(target, 'P3_REVIEW_PRESET.json') }));
}

main().catch(error => {
  process.stderr.write(`${error.message}\n${createdRoot ? `Preparation stopped; partial new directory is retained without deleting anything: ${createdRoot}\n` : ''}`);
  process.exitCode = 2;
});
