import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'

const [baseURL, fixtureArgument, outArgument] = process.argv.slice(2)
if (!baseURL || !fixtureArgument || !outArgument) throw Error('Usage: node verification/capture-combat-ui.mjs <baseURL> <isolated-content-root> <new-output-root>')
const repo = path.resolve('../..'), fixture = path.resolve(fixtureArgument), output = path.resolve(outArgument)
assert(fixture.toLowerCase().startsWith(path.join(repo, 'work').toLowerCase() + path.sep), 'Refuse non-isolated content')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const json = async url => {const response = await fetch(baseURL + '/api' + url); assert.equal(response.status, 200, url); return response.json()}
const health = await json('/health'); assert.equal(path.resolve(health.contentRoot).toLowerCase(), fixture.toLowerCase())
const capabilities = await json('/capabilities'); assert(capabilities.contentTypes.some(type => type.id === 'trial'), 'P2 backend not ready')
const trials = await Promise.all((await json('/content/trial')).map(({id}) => json('/content/trial/' + id)))
const trial = trials.find(trial => trial.allies.some(slot => slot.unitId === 'mage') && /mage.*library|library.*mage/.test(trial.id))
assert(trial, 'Fixture must import actual round4_mage_library')
const characterId = trial.allies.find(slot => slot.unitId === 'mage').characterId
const fontBytes = await fs.readFile(path.join(repo, 'Game/Assets/Prototype/Art/Fonts/NotoSansCJKsc-Regular.otf'))
const snapshots = async root => {const files = []; const walk = async dir => {for (const entry of await fs.readdir(dir, {withFileTypes: true})) {const file = path.join(dir, entry.name); if (entry.isDirectory()) await walk(file); else files.push({path: path.relative(root, file).replaceAll('\\', '/'), sha256: sha(await fs.readFile(file))})}}; await walk(root); return files.sort((a, b) => a.path.localeCompare(b.path))}
const before = await snapshots(fixture)
await fs.mkdir(path.dirname(output), {recursive: true}); await fs.mkdir(output, {recursive: false}); await fs.mkdir(path.join(output, 'network'))
const sourceFiles = []
async function sourceSnapshot(dir = '.') {for (const entry of await fs.readdir(dir, {withFileTypes: true})) {if (['node_modules', 'dist', '.git'].includes(entry.name)) continue; const file = path.join(dir, entry.name); if (entry.isDirectory()) await sourceSnapshot(file); else if (!file.endsWith('.tsbuildinfo')) sourceFiles.push({path: file.replaceAll('\\', '/'), sha256: sha(await fs.readFile(file))})}}
await sourceSnapshot(); sourceFiles.sort((a, b) => a.path.localeCompare(b.path))
const browser = await chromium.launch({executablePath: process.env.EDITOR_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true})
const results = [], network = [], errors = [], pending = []
let sequence = 0
try {
 for (const viewport of [{width: 1280, height: 800}, {width: 1920, height: 1080}]) for (const colorScheme of ['light', 'dark']) {
  const context = await browser.newContext({viewport, colorScheme, recordVideo: {dir: path.join(output, 'videos'), size: viewport}}), page = await context.newPage()
  await context.tracing.start({screenshots: true, snapshots: true, sources: true})
  page.on('pageerror', error => errors.push(error.stack || String(error)))
  page.on('response', response => {if (!response.url().includes('/api/')) return; const number = ++sequence; pending.push((async () => {const bytes = await response.body(), stem = String(number).padStart(5, '0'), post = response.request().postDataBuffer(); await fs.writeFile(path.join(output, 'network', stem + '.response.bin'), bytes); if (post) await fs.writeFile(path.join(output, 'network', stem + '.request.bin'), post); network.push({number, url: response.url(), method: response.request().method(), status: response.status(), headers: response.headers(), bytes: bytes.length, sha256: sha(bytes), requestSha256: post ? sha(post) : null})})().catch(error => network.push({number, url: response.url(), method: response.request().method(), status: response.status(), bodyUnavailable: error.message, note: 'Cancelled/closed request body is not claimed as captured raw evidence.'})))})
  const cdp = await context.newCDPSession(page); await cdp.send('Network.enable', {maxTotalBufferSize: 64 * 1024 * 1024, maxResourceBufferSize: 32 * 1024 * 1024})
  let fontResponse
  const fontBody = new Promise((resolve, reject) => {
   cdp.on('Network.responseReceived', event => {if (event.response.url.includes('NotoSansCJKsc-Regular') && event.response.url.includes('.otf')) fontResponse = {requestId: event.requestId, url: event.response.url, status: event.response.status}})
   cdp.on('Network.loadingFinished', event => {if (event.requestId === fontResponse?.requestId) void cdp.send('Network.getResponseBody', {requestId: event.requestId}).then(body => {const bytes = Buffer.from(body.body, body.base64Encoded ? 'base64' : 'utf8'); resolve({...fontResponse, bytes: bytes.length, sha256: sha(bytes)})}).catch(reject)})
  })
  const stem = `${viewport.width}x${viewport.height}-${colorScheme}`
  try {
   await page.addInitScript(theme => localStorage.setItem('helper-theme', theme), colorScheme)
   await page.goto(`${baseURL}/#/combat/character/${encodeURIComponent(characterId)}`)
   await page.locator('[data-testid="instruction-capacity"]').filter({hasText: '/ 5'}).waitFor()
   const font = await fontBody; assert.equal(font.status, 200); assert.equal(font.sha256, sha(fontBytes)); assert.equal(font.bytes, fontBytes.length)
   await page.getByRole('button', {name: '新增指令', exact: true}).click()
   const added = page.locator('[data-instruction-id]').last()
   await added.locator('.condition-token').click()
   await page.getByRole('button', {name: '添加条件', exact: true}).click(); await page.getByRole('button', {name: '添加条件', exact: true}).click()
   await page.getByLabel('条件1类型', {exact: true}).selectOption('mp_ratio_at_most'); await page.getByLabel('条件1读取来源').selectOption('actor'); await page.getByLabel('条件1阈值', {exact: true}).fill('25')
   await page.getByLabel('条件2类型', {exact: true}).selectOption('hp_ratio_at_most'); await page.getByLabel('条件2阈值', {exact: true}).fill('35')
   await page.getByLabel('连接符1', {exact: true}).selectOption('and'); await page.getByLabel('连接符2', {exact: true}).selectOption('or'); await page.getByLabel('括号位置', {exact: true}).selectOption('left')
   await page.getByRole('button', {name: '应用条件', exact: true}).click()
   // Move the real fallback rule to the top through the keyboard drag sensor.
   const staff = page.locator('[data-instruction-id="staff_fallback"] .rule-grip'); await staff.focus(); await page.keyboard.press('Space')
   for (let count = 0; count < 4; count++) {await page.keyboard.press('ArrowUp'); await page.waitForTimeout(100)}
   await page.keyboard.press('Space')
   await page.locator('[data-testid="capacity-divider"]').waitFor(); await page.waitForFunction(() => !Array.from(document.querySelectorAll('.rule-meta .badge')).some(element => element.textContent.includes('等待核心')))
   await added.scrollIntoViewIfNeeded()
   const capture = async name => {
    await page.evaluate(async () => {await document.fonts.ready; await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))})
    const layout = await page.evaluate(() => {
     const rect = element => {const r = element.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom}}
     return {viewport: {width: innerWidth, height: innerHeight}, pageScrollWidth: document.documentElement.scrollWidth, bodyFont: getComputedStyle(document.body).fontFamily, fontFaces: [...document.fonts].filter(face => face.family.replaceAll('"', '') === 'Noto Sans SC').map(face => ({family: face.family, status: face.status})), inspector: rect(document.querySelector('.combat-inspector')), main: rect(document.querySelector('.combat-main')), divider: document.querySelector('[data-testid="capacity-divider"]') ? rect(document.querySelector('[data-testid="capacity-divider"]')) : null, threeTermSentence: [...document.querySelectorAll('.condition-token')].find(element => element.textContent.includes('且') && element.textContent.includes('或'))?.textContent || '', comparison: document.querySelector('[data-testid="comparison-card"]')?.textContent || '', runMs: document.querySelector('[data-testid="trial-result"]')?.getAttribute('data-run-ms') || '', theme: document.documentElement.dataset.theme}
    })
    assert.equal(layout.pageScrollWidth, viewport.width); assert.equal(layout.inspector.width, 360); assert(layout.inspector.right <= viewport.width); assert(layout.fontFaces.some(face => face.status === 'loaded')); assert(layout.bodyFont.includes('Noto Sans SC')); assert.equal(layout.theme, colorScheme)
    const file = `${name}-${stem}.png`; await page.screenshot({path: path.join(output, file)}); const bytes = await fs.readFile(path.join(output, file)); results.push({page: name, file, sha256: sha(bytes), bytes: bytes.length, font, layout, trialId: trial.id, characterId})
   }
   await capture('character')
   await page.getByRole('button', {name: '试炼场', exact: true}).click(); await page.locator('.combat-list-scroll>button').filter({hasText: trial.id}).click()
   await page.getByTestId('run-trial').click(); await page.getByTestId('trial-result').waitFor(); await page.waitForFunction(() => !!document.querySelector('[data-testid="trial-result"]')?.getAttribute('data-run-ms'))
   await page.getByTestId('compare-trial').click(); await page.getByTestId('comparison-card').waitFor(); await page.waitForFunction(() => document.querySelector('[data-testid="comparison-card"]')?.textContent.includes('记录序号'))
   await capture('trial')
   await context.tracing.stop({path: path.join(output, `trace-${stem}.zip`)})
  } catch (error) {await page.screenshot({path: path.join(output, `FAILURE-${stem}.png`)}).catch(() => {}); await fs.writeFile(path.join(output, `FAILURE-${stem}.html`), await page.content()); await context.tracing.stop({path: path.join(output, `FAILURE-trace-${stem}.zip`)}).catch(() => {}); throw error}
  finally {await context.close()}
 }
 await Promise.all(pending); assert.deepEqual(errors, []); assert.deepEqual(await snapshots(fixture), before, 'C12 edits must remain in memory; disk fixture unchanged')
 for (const file of sourceFiles) assert.equal(sha(await fs.readFile(file.path)), file.sha256, 'Source changed during capture: ' + file.path)
 for (const route of ['/trial/run', '/trial/compare']) assert.equal(network.filter(record => record.url.endsWith(route) && record.status === 200 && record.sha256).length, 4, 'Missing complete real response bodies for ' + route)
 assert.equal(results.length, 8)
 await fs.writeFile(path.join(output, 'capture.json'), JSON.stringify({ok: true, at: new Date().toISOString(), browser: browser.version(), baseURL, health, sourceRoot: process.cwd(), sourceFiles, sourceAggregateSha256: sha(sourceFiles.map(file => `${file.path}\n${file.sha256}\n`).join('')), sourceUnchangedDuringCapture: true, fixtureBefore: before, fixtureDiskUnchanged: true, results, errors, note: 'Eight actual pages; UI-only unsaved condition+priority edits. C12 timing is the unsaved variant, not claimed as original C13 performance. Four contexts each include actual font HTTP/body proof.'}, null, 2) + '\n')
 await fs.writeFile(path.join(output, 'network.json'), JSON.stringify(network.sort((a, b) => a.number - b.number), null, 2) + '\n')
 console.log(JSON.stringify({ok: true, screenshots: results.length, output}))
} catch (error) {await Promise.allSettled(pending); await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({at: new Date().toISOString(), error: error.stack || String(error), results, errors, network}, null, 2) + '\n'); throw error}
finally {await browser.close()}
