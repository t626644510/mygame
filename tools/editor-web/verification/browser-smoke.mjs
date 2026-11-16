import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const [baseURL, contentRootArg, evidence] = process.argv.slice(2)
if (!baseURL || !contentRootArg || !evidence) throw Error('Usage: npm run test:browser -- <base-url> <isolated-content-root-under-work> <new-evidence-directory>')
const repository = path.resolve('../..')
const contentRoot = path.resolve(contentRootArg)
const workRoot = path.join(repository, 'work') + path.sep
assert(contentRoot.toLocaleLowerCase().startsWith(workRoot.toLocaleLowerCase()), 'Browser smoke requires an isolated content root under repository/work.')
assert(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Only a local test service may be used.')
const apiURL = baseURL.replace(/\/$/, '') + '/api'
const health = await (await fetch(`${apiURL}/health`)).json()
assert.equal(path.resolve(health.contentRoot).toLocaleLowerCase(), contentRoot.toLocaleLowerCase(), 'The live service must point at the explicit isolated content root.')
const out = path.resolve(evidence)
await fs.mkdir(path.dirname(out), {recursive: true}); await fs.mkdir(out, {recursive: false})
const browserPath = process.env.EDITOR_BROWSER_PATH || (process.platform === 'win32' ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : undefined)
const browser = await chromium.launch({headless: true, ...(browserPath ? {executablePath: browserPath} : {})})
const context = await browser.newContext({viewport: {width: 1280, height: 800}, locale: 'zh-CN'})
const page = await context.newPage()
const steps = []; const network = []; const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('response', response => {if (response.url().includes('/api/')) network.push({url: response.url(), method: response.request().method(), status: response.status()})})
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const jsonFile = async name => JSON.parse(await fs.readFile(path.join(contentRoot, 'items', `${name}.json`), 'utf8'))
const nextResponse = (part, status) => page.waitForResponse(response => response.url().includes(part) && response.status() === status)
const wait = async predicate => {for (let i = 0; i < 100; i++) {if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100))} throw Error('Timed out waiting for state')}
const byId = id => page.locator(`[id="${id}"]`)
const open = async id => {
  await page.keyboard.press('Control+k')
  await page.getByRole('textbox', {name: '全局实体搜索', exact: true}).fill(id)
  await page.keyboard.press('Enter')
  await wait(async () => await byId('field-id').inputValue() === id)
}
const step = async (name, run) => {await run(); steps.push({name, ok: true, at: new Date().toISOString()}); console.log(`PASS ${name}`)}
try {
  await page.goto(baseURL + '/#/items/expedition_ore')
  await byId('field-id').waitFor()
  await step('B4 real refs and deletion guard', async () => {
    assert(await page.getByRole('button', {name: '删除物品', exact: true}).isDisabled())
    const refs = await (await fetch(`${apiURL}/refs/expedition_ore`)).json()
    assert(refs.some(ref => ref.path.includes('preparation.json')))
    assert(refs.some(ref => ref.path === 'items/eq_patrol_sword.json'))
    assert(refs.some(ref => ref.legacy && ref.direction === 'source'))
    assert(refs.some(ref => ref.quantity === null))
  })
  await step('B3 duplicate, malformed and alias IDs rejected in UI', async () => {
    const nonce = Date.now().toString(36)
    const alias = `mat_taken_alias_${nonce}`
    const aliasOwner = {...await jsonFile('mat_grain'), id: `mat_alias_owner_${nonce}`, name: 'ID 别名隔离夹具', aliases: [alias]}
    const created = await fetch(`${apiURL}/content/item/${aliasOwner.id}`, {method: 'PUT', headers: {'Content-Type': 'application/json', 'If-None-Match': '*'}, body: JSON.stringify(aliasOwner)})
    assert.equal(created.status, 201)
    await page.getByTestId('new-item').click()
    const duplicate = nextResponse('/api/validate-item', 422)
    await byId('field-id').fill('expedition_ore'); await duplicate
    await wait(() => page.getByTestId('save-item').isDisabled())
    const malformed = nextResponse('/api/validate-item', 422)
    await byId('field-id').fill('not-an-id'); await malformed
    assert(await page.getByTestId('save-item').isDisabled())
    const aliasCollision = nextResponse('/api/validate-item', 422)
    await byId('field-id').fill(alias); await aliasCollision
    await wait(() => page.getByTestId('save-item').isDisabled())
    await page.screenshot({path: path.join(out, 'b3-invalid-id.png')})
    await page.keyboard.press('Escape')
    await page.getByRole('button', {name: '放弃并离开', exact: true}).click()
  })
  await step('B5 paste imports eight and explains two skipped rows', async () => {
    const nonce = Date.now().toString(36)
    const before = sha(await fs.readFile(path.join(contentRoot, 'items', 'expedition_ore.json')))
    const rows = ['ID\t名称\t类型\t堆叠\t参考价\t标签', ...Array.from({length: 8}, (_, i) => `mat_paste_${nonce}_${i}\t粘贴测试${i}\tmaterial\t99\t0\t测试`), 'expedition_ore\t重复测试\tmaterial\t99\t0\t测试', `mat_invalid_${nonce}\t非法类型\tinvalid\t99\t0\t测试`].join('\n')
    await page.getByRole('button', {name: '从表格粘贴', exact: true}).click()
    await page.getByRole('textbox', {name: '粘贴表格内容'}).fill(rows)
    await page.getByRole('button', {name: '导入合格行 (8)', exact: true}).waitFor()
    await wait(() => page.getByTestId('import-valid').isEnabled())
    await page.getByTestId('import-valid').click()
    await page.getByText('已导入 8 条，跳过 2 条', {exact: true}).waitFor()
    assert((await page.getByRole('dialog').innerText()).includes('类型非法'))
    await page.screenshot({path: path.join(out, 'b5-eight-imported-two-skipped.png')})
    assert.equal(sha(await fs.readFile(path.join(contentRoot, 'items', 'expedition_ore.json'))), before)
    await page.getByRole('button', {name: '关闭', exact: true}).click()
  })
  await step('B6 mandatory request and draft; B7 usable collection export', async () => {
    await open('con_simple_meal')
    await page.getByTestId('add-effect').click()
    assert(await page.getByRole('dialog').isVisible())
    await page.getByRole('button', {name: '附需求并添加能力'}).click()
    assert(await page.getByRole('alert').count() > 0)
    await page.getByRole('textbox', {name: '能力标识', exact: true}).fill('restore_hunger')
    await page.getByRole('textbox', {name: '需求标题', exact: true}).fill('恢复饥饿（前端隔离验证）')
    await page.getByRole('textbox', {name: '需求说明', exact: true}).fill('仅登记待实现能力，不修改旧Runtime。')
    await page.getByRole('textbox', {name: '预期结果', exact: true}).fill('后续专项实现恢复饥饿；本次保持草稿。')
    await page.getByRole('button', {name: '附需求并添加能力'}).click()
    await page.keyboard.press('Control+s')
    await wait(async () => (await jsonFile('con_simple_meal')).draft)
    const records = await (await fetch(`${apiURL}/requests`)).json()
    assert(records.some(record => record.target === 'item:con_simple_meal' && record.owner === 'engineering' && record.title.includes('前端隔离验证')))
    const exported = nextResponse('/api/export', 200)
    await wait(() => page.getByRole('button', {name: '导出可用内容', exact: true}).isEnabled())
    await page.getByRole('button', {name: '导出可用内容', exact: true}).click(); await exported
    const capabilities = await (await fetch(`${apiURL}/capabilities`)).json()
    const runtimePath = path.join(capabilities.exportRoot, 'items.json')
    const first = await fs.readFile(runtimePath)
    const runtime = JSON.parse(first.toString('utf8'))
    assert(!runtime.items.some(item => item.id === 'con_simple_meal'))
    assert(!runtime.items.some(item => 'draft' in item || 'notes' in item))
    const secondExport = nextResponse('/api/export', 200)
    await wait(() => page.getByRole('button', {name: '导出可用内容', exact: true}).isEnabled())
    await page.getByRole('button', {name: '导出可用内容', exact: true}).click(); await secondExport
    assert.equal(sha(await fs.readFile(runtimePath)), sha(first))
    await page.screenshot({path: path.join(out, 'b6-draft-export-excluded.png')})
  })
  await step('B9 both conflict choices use actual disk writes', async () => {
    await open('mat_grain')
    const file = path.join(contentRoot, 'items', 'mat_grain.json')
    let disk = await jsonFile('mat_grain')
    await byId('field-name').fill('我的版本 A')
    disk.name = '磁盘版本 A'; await fs.writeFile(file, JSON.stringify(disk, null, 2) + '\n')
    const conflict = nextResponse('/api/content/item/mat_grain', 409)
    await page.keyboard.press('Control+s'); await conflict
    await page.getByRole('dialog', {name: '检测到磁盘版本冲突'}).waitFor()
    await page.screenshot({path: path.join(out, 'b9-conflict-differences.png')})
    await page.getByTestId('use-disk').click()
    assert.equal(await byId('field-name').inputValue(), '磁盘版本 A')
    assert.equal((await jsonFile('mat_grain')).name, '磁盘版本 A')
    await byId('field-name').fill('我的版本 B')
    disk = await jsonFile('mat_grain'); disk.name = '磁盘版本 B'; await fs.writeFile(file, JSON.stringify(disk, null, 2) + '\n')
    const conflictAgain = nextResponse('/api/content/item/mat_grain', 409)
    await page.keyboard.press('Control+s'); await conflictAgain
    await page.getByTestId('keep-mine').click()
    await wait(async () => (await jsonFile('mat_grain')).name === '我的版本 B')
  })
  await step('B12 actual keyboard new, save, search, Escape and visible focus', async () => {
    await page.keyboard.press('Control+k')
    await page.keyboard.type('expedition-ore')
    await page.keyboard.press('Enter')
    await wait(async () => await byId('field-id').inputValue() === 'expedition_ore')
    await page.keyboard.press('Escape')
    await wait(async () => await page.getByTestId('item-detail').count() === 0)
    const tabUntil = async (kind, value) => {
      for (let i = 0; i < 100; i++) {
        if (await page.evaluate(({kind, value}) => kind === 'id' ? document.activeElement?.id === value : document.activeElement?.getAttribute('data-testid') === value, {kind, value})) return
        await page.keyboard.press('Tab')
      }
      throw Error(`Keyboard could not reach ${value}`)
    }
    await tabUntil('testid', 'new-item')
    await page.screenshot({path: path.join(out, 'b12-visible-focus.png')})
    await page.keyboard.press('Enter')
    await tabUntil('id', 'field-id')
    const id = `mat_keyboard_${Date.now().toString(36)}`
    await page.keyboard.press('Control+a'); await page.keyboard.type(id)
    await tabUntil('id', 'field-name'); await page.keyboard.type('纯键盘新建物品')
    await page.keyboard.press('Control+s')
    await wait(async () => {try {return (await jsonFile(id)).name === '纯键盘新建物品'} catch {return false}})
    await page.keyboard.press('Escape')
    await wait(async () => await page.getByTestId('item-detail').count() === 0)
    await page.keyboard.press('Control+k'); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('dialog').count(), 0)
  })
  assert.deepEqual(errors, [])
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ok: true, baseURL, contentRoot, health, browserPath, browserVersion: browser.version(), steps, deferred: ['B10 real process stop/restart remains with the backend process owner / independent verifier.', 'B8 Unity remains with the designated Unity owner.'], errors}, null, 2) + '\n')
} catch (error) {
  await page.screenshot({path: path.join(out, 'failure.png')}).catch(() => {})
  await fs.writeFile(path.join(out, 'failure.json'), JSON.stringify({ok: false, error: error.stack || String(error), steps, errors}, null, 2) + '\n')
  throw error
} finally {
  await fs.writeFile(path.join(out, 'network.json'), JSON.stringify(network, null, 2) + '\n')
  await context.close(); await browser.close()
}
