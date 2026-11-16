import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const [baseURL, contentRootArg, evidence] = process.argv.slice(2)
if (!baseURL || !contentRootArg || !evidence) throw Error('Usage: node verification/offline-smoke.mjs <base-url> <isolated-content-root> <new-evidence-directory>')
const contentRoot = path.resolve(contentRootArg)
assert(contentRoot.toLocaleLowerCase().startsWith((path.resolve('../../work') + path.sep).toLocaleLowerCase()))
const health = await (await fetch(`${baseURL}/api/health`)).json()
assert.equal(path.resolve(health.contentRoot).toLocaleLowerCase(), contentRoot.toLocaleLowerCase())
const out = path.resolve(evidence)
await fs.mkdir(path.dirname(out), {recursive: true}); await fs.mkdir(out, {recursive: false})
const browser = await chromium.launch({headless: true, executablePath: process.env.EDITOR_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'})
const context = await browser.newContext({viewport: {width: 1280, height: 800}, locale: 'zh-CN'})
const page = await context.newPage()
const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message))
const value = `断线保留 ${Date.now()}`
const phase = async (name, data = {}) => {
  const item = {phase: name, at: new Date().toISOString(), ...data}
  await fs.writeFile(path.join(out, 'phase.json'), JSON.stringify(item, null, 2) + '\n')
  console.log(JSON.stringify(item))
}
try {
  await page.goto(`${baseURL}/#/items/mat_grain`)
  await page.locator('#field-name').waitFor()
  await page.locator('#field-name').fill(value)
  await phase('EDIT_READY_OWNER_MAY_STOP_BACKEND', {value, baseURL, contentRoot})
  // The process owner performs and records the actual stop. This script never
  // substitutes a network route mock or kills a process based on an unchecked PID.
  await page.getByText('本地模拟器未连接', {exact: true}).waitFor({timeout: 60000})
  const detectedAt = Date.now()
  let stop
  for (let i = 0; i < 50; i++) {try {stop = JSON.parse(await fs.readFile(path.join(out, 'stop.json'), 'utf8')); break} catch {await new Promise(resolve => setTimeout(resolve, 100))}}
  assert(stop, 'Owner must record real process stop in stop.json.')
  const elapsedMs = detectedAt - Date.parse(stop.stoppedAt)
  assert(elapsedMs <= 5000, `Offline banner exceeded 5s: ${elapsedMs}ms`)
  assert.equal(await page.locator('#field-name').inputValue(), value)
  assert(await page.getByTestId('save-item').isDisabled())
  await page.screenshot({path: path.join(out, 'offline-retained-disabled.png')})
  await phase('OFFLINE_CONFIRMED_OWNER_MAY_RESTART', {elapsedMs, stoppedProcess: stop})
  await page.getByText('本地模拟器未连接', {exact: true}).waitFor({state: 'hidden', timeout: 60000})
  assert.equal(await page.locator('#field-name').inputValue(), value)
  assert(await page.getByTestId('save-item').isEnabled())
  await page.keyboard.press('Control+s')
  const file = path.join(contentRoot, 'items', 'mat_grain.json')
  let saved = false
  for (let i = 0; i < 100; i++) {if (JSON.parse(await fs.readFile(file, 'utf8')).name === value) {saved = true; break} await new Promise(resolve => setTimeout(resolve, 100))}
  assert(saved)
  assert.deepEqual(pageErrors, [])
  await page.screenshot({path: path.join(out, 'recovered-saved-without-refresh.png')})
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ok: true, healthBefore: health, baseURL, contentRoot, browserVersion: browser.version(), value, elapsedMs, pageErrors, stoppedProcess: stop, recoveredAt: new Date().toISOString(), pageReloadsDuringStop: 0}, null, 2) + '\n')
  await phase('PASS_B10')
} catch (error) {
  await page.screenshot({path: path.join(out, 'failure.png')}).catch(() => {})
  await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify({error: error.stack || String(error), pageErrors}, null, 2) + '\n')
  throw error
} finally {await context.close(); await browser.close()}
