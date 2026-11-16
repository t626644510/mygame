import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'

const [baseURL, fixtureArgument, outArgument] = process.argv.slice(2)
if (!baseURL || !fixtureArgument || !outArgument) throw Error('Usage: node verification/measure-combat-run.mjs <baseURL> <isolated-content-root> <new-output-root>')
const repo = path.resolve('../..'), fixture = path.resolve(fixtureArgument), out = path.resolve(outArgument), sha = b => crypto.createHash('sha256').update(b).digest('hex')
assert(fixture.toLowerCase().startsWith(path.join(repo, 'work').toLowerCase() + path.sep), 'Refuse production content')
const get = async route => {const response = await fetch(baseURL + '/api' + route); assert.equal(response.status, 200); return response.json()}
const health = await get('/health'); assert.equal(path.resolve(health.contentRoot).toLowerCase(), fixture.toLowerCase())
const trials = await Promise.all((await get('/content/trial')).map(({id}) => get('/content/trial/' + id))), trial = trials.find(trial => /mage.*library|library.*mage/.test(trial.id))
assert(trial, 'Actual round4_mage_library fixture required')
const assembledResponse = await fetch(baseURL + '/api/assemble', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({trialId: trial.id})})
assert.equal(assembledResponse.status, 200); const assembledBytes = Buffer.from(await assembledResponse.arrayBuffer()), assembly = JSON.parse(assembledBytes)
assert.equal(assembly.kind, 'scenario'); assert.equal(assembly.provenance.sourceSha256, sha(await fs.readFile(path.join(repo, 'Game/Assets/StreamingAssets/Prototype/Combat/round4_mage_library.json'))))
const snapshot = async () => {const result = []; const walk = async dir => {for (const entry of await fs.readdir(dir, {withFileTypes: true})) {const file = path.join(dir, entry.name); if (entry.isDirectory()) await walk(file); else result.push({path: path.relative(fixture, file).replaceAll('\\', '/'), sha256: sha(await fs.readFile(file))})}}; await walk(fixture); return result.sort((a,b)=>a.path.localeCompare(b.path))}
const before = await snapshot(); await fs.mkdir(path.dirname(out), {recursive: true}); await fs.mkdir(out, {recursive: false}); await fs.writeFile(path.join(out, 'assembled.response.bin'), assembledBytes)
const browser = await chromium.launch({executablePath: process.env.EDITOR_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true})
const context = await browser.newContext({viewport: {width: 1280, height: 800}, colorScheme: 'light', recordVideo: {dir: path.join(out, 'video'), size: {width: 1280, height: 800}}}), page = await context.newPage()
await context.tracing.start({screenshots: true, snapshots: true, sources: true})
let result
try {
 await page.goto(`${baseURL}/#/combat/trial/${encodeURIComponent(trial.id)}`)
 await page.getByRole('button', {name: '重新读取战斗目录'}).waitFor({state: 'visible'}); await page.waitForFunction(() => !document.querySelector('[aria-label="重新读取战斗目录"]').disabled && document.querySelectorAll('.source-context').length > 0)
 await page.evaluate(async () => {await document.fonts.ready; await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})))})
 const beforeUI = await page.evaluate(() => ({bodyFont: getComputedStyle(document.body).fontFamily, faces: [...document.fonts].filter(face => face.family.includes('Noto')).map(face => ({family: face.family, status: face.status}))})); assert(beforeUI.faces.some(face => face.status === 'loaded'))
 const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/trial/run') && response.request().method() === 'POST')
 const beforeClick = await page.evaluate(() => performance.now()); await page.getByTestId('run-trial').click()
 const response = await responsePromise; const responseBytes = await response.body(), requestBytes = response.request().postDataBuffer(); await fs.writeFile(path.join(out, 'run.response.bin'), responseBytes); await fs.writeFile(path.join(out, 'run.request.bin'), requestBytes)
 assert.equal(response.status(), 200)
 await page.waitForFunction(() => !!document.querySelector('[data-testid="trial-result"]')?.getAttribute('data-run-ms'))
 const measured = await page.evaluate(() => ({handlerToPaintMs: Number(document.querySelector('[data-testid="trial-result"]').getAttribute('data-run-ms')), observedAt: performance.now(), resultText: document.querySelector('[data-testid="trial-result"]').textContent, renderedSteps: document.querySelectorAll('[data-step-index]').length}))
 const posted = JSON.parse(requestBytes); assert.equal((posted.editIntents || []).length, 0); assert(Object.values(posted.overrides || {}).every(entries => entries.length === 0))
 assert.deepEqual(await snapshot(), before, 'Performance run changed fixture files')
 await page.screenshot({path: path.join(out, 'result.png')})
 await page.locator('.combat-source').scrollIntoViewIfNeeded()
 await page.screenshot({path: path.join(out, 'source-context-ready.png')})
 const sourceContextText = await page.locator('.combat-source').innerText()
 result = {ok: measured.handlerToPaintMs < 1000, at: new Date().toISOString(), browser: browser.version(), health, trialId: trial.id, provenance: assembly.provenance, sourceContextText, measure: {...measured, automationUpperBoundMs: measured.observedAt - beforeClick}, thresholdMs: 1000, actualStatus: response.status(), request: {bytes: requestBytes.length, sha256: sha(requestBytes)}, response: {bytes: responseBytes.length, sha256: sha(responseBytes)}, font: beforeUI, fixtureUnchanged: true, fixtureBefore: before, note: 'One actual click after normal page/data/font readiness; complete result commit plus two animation frames measured by the product. No override, response mock, CSS injection or repeated simulation hidden behind the measurement.'}
 await fs.writeFile(path.join(out, 'performance.json'), JSON.stringify(result, null, 2) + '\n')
 assert(result.ok, `Actual click-to-paint ${measured.handlerToPaintMs}ms exceeds 1s`)
 console.log(JSON.stringify({ok: true, elapsedMs: measured.handlerToPaintMs, out}))
} catch (error) {await page.screenshot({path: path.join(out, 'FAILURE.png')}).catch(() => {}); await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify({error: error.stack || String(error), result}, null, 2) + '\n'); throw error}
finally {await context.tracing.stop({path: path.join(out, 'trace.zip')}); await context.close(); await browser.close()}
