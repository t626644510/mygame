import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const [baseURL, evidence, expectedCountText = '60'] = process.argv.slice(2)
if (!baseURL || !evidence) throw Error('Usage: node verification/capture-ui.mjs <base-url> <new-evidence-directory> [expected-count=60]')
const out = path.resolve(evidence)
await fs.mkdir(path.dirname(out), {recursive: true})
await fs.mkdir(out, {recursive: false})
const browserPath = process.env.EDITOR_BROWSER_PATH || (process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : undefined)
const browser = await chromium.launch({headless: true, ...(browserPath ? {executablePath: browserPath} : {})}).catch(async error => {await fs.writeFile(path.join(out, 'launch-failure.json'), JSON.stringify({error: error.stack || String(error)}, null, 2) + '\n'); throw error})
const results = []
const fontPath = fileURLToPath(new URL('../../../Game/Assets/Prototype/Art/Fonts/NotoSansCJKsc-Regular.otf', import.meta.url))
const fontBytes = await fs.readFile(fontPath)
const fontSource = {path: fontPath, bytes: fontBytes.length, sha256: crypto.createHash('sha256').update(fontBytes).digest('hex')}
try {
  for (const size of [{width: 1280, height: 800}, {width: 1920, height: 1080}]) {
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({viewport: size, colorScheme, locale: 'zh-CN'})
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      const networkBuffers = {maxTotalBufferSize: 64 * 1024 * 1024, maxResourceBufferSize: 32 * 1024 * 1024}
      await cdp.send('Network.enable', networkBuffers)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      const fontResponsePromise = new Promise(resolve => cdp.on('Network.responseReceived', event => {if (event.response.url.includes('NotoSansCJKsc-Regular') && event.response.url.includes('.otf')) resolve(event)}))
      await page.goto(`${baseURL.replace(/\/$/, '')}/#/items/expedition_ore`)
      await page.locator('#field-id').waitFor()
      await page.waitForFunction(count => Number(document.querySelector('.page-heading .count')?.textContent) === count, Number(expectedCountText))
      await page.evaluate(() => document.fonts.ready)
      const fontResponse = await fontResponsePromise
      const responseBody = await cdp.send('Network.getResponseBody', {requestId: fontResponse.requestId})
      const receivedFontBytes = Buffer.from(responseBody.body, responseBody.base64Encoded ? 'base64' : 'utf8')
      const font = await page.evaluate(() => ({bodyFont: getComputedStyle(document.body).fontFamily, faces: Array.from(document.fonts).filter(face => face.family.replaceAll('"', '').replaceAll("'", '') === 'Noto Sans SC').map(face => ({family: face.family, status: face.status, weight: face.weight, style: face.style}))}))
      const fontHttp = {url: fontResponse.response.url, status: fontResponse.response.status, requestId: fontResponse.requestId, bytes: receivedFontBytes.length, sha256: crypto.createHash('sha256').update(receivedFontBytes).digest('hex'), networkBuffers}
      if (fontHttp.status !== 200 || fontHttp.sha256 !== fontSource.sha256 || !font.bodyFont.includes('Noto Sans SC') || !font.faces.length || font.faces.some(face => face.status !== 'loaded')) throw Error(JSON.stringify({fontSource, fontHttp, font}))
      await page.locator('[data-testid="item-detail"]').waitFor()
      await page.locator('[data-testid="item-detail"]').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))))
      await page.waitForFunction(() => {
        const row = document.querySelector('[data-testid="item-row-expedition_ore"]')
        const table = document.querySelector('.table-scroll')
        if (!row || !table) return false
        const r = row.getBoundingClientRect(); const t = table.getBoundingClientRect()
        return r.top >= t.top + 31 && r.bottom <= t.bottom + 1
      })
      const layout = await page.evaluate(() => {
        const table = document.querySelector('.table-scroll')
        const detail = document.querySelector('.detail-panel')
        const t = table.getBoundingClientRect(); const d = detail.getBoundingClientRect()
        const selected = document.querySelector('[data-testid="item-row-expedition_ore"]').getBoundingClientRect()
        const headers = Array.from(document.querySelectorAll('.item-table th button'))
        const headerTextLineCounts = headers.map(button => {const text = Array.from(button.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()); if (!text) return 0; const range = document.createRange(); range.selectNodeContents(text); return range.getClientRects().length})
        return {viewport: innerWidth, pageScrollWidth: document.documentElement.scrollWidth, table: {x: t.x, right: t.right, width: t.width, height: t.height, scrollHeight: table.scrollHeight, clientHeight: table.clientHeight}, detail: {x: d.x, width: d.width, right: d.right}, selectedRow: {top: selected.top, bottom: selected.bottom}, nameColumnWidth: document.querySelectorAll('.item-table th')[1].getBoundingClientRect().width, headerTextLineCounts, renderedRows: document.querySelectorAll('.item-table tbody tr').length, colorTheme: document.documentElement.dataset.theme}
      })
      if (layout.pageScrollWidth > size.width || Math.abs(layout.detail.width - 360) > 1 || layout.detail.right > size.width + 1 || layout.detail.x < layout.table.right - 1 || layout.table.scrollHeight <= layout.table.clientHeight || layout.headerTextLineCounts.some(count => count !== 1) || layout.renderedRows >= Number(expectedCountText) || layout.colorTheme !== colorScheme || errors.length) throw Error(JSON.stringify({layout, errors}))
      const name = `items-${size.width}x${size.height}-${colorScheme}.png`
      await page.screenshot({path: path.join(out, name), fullPage: true})
      const bytes = await fs.readFile(path.join(out, name))
      results.push({name, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, fontHttp, font, layout, errors})
      await context.close()
    }
  }
  if (results[2].layout.nameColumnWidth <= results[0].layout.nameColumnWidth) throw Error('Wide layout must allocate its extra space to the name column.')
  await fs.writeFile(path.join(out, 'capture.json'), JSON.stringify({capturedAt: new Date().toISOString(), baseURL, expectedCount: Number(expectedCountText), browserPath, browserVersion: browser.version(), fontSource, isolatedContexts: true, results}, null, 2) + '\n')
  console.log(JSON.stringify({ok: true, out, browser: browser.version(), captures: results.length}))
} catch (error) {
  await fs.writeFile(path.join(out, 'capture-failure.json'), JSON.stringify({error: error.stack || String(error), completed: results}, null, 2) + '\n')
  throw error
} finally {await browser.close()}
