import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const [target, countText = '60'] = process.argv.slice(2)
if (!target) throw Error('Usage: node verification/prepare-fixture.mjs <new-directory-under-repository/work> [count=60]')
const repository = path.resolve('../..')
const root = path.resolve(target)
if (!root.toLocaleLowerCase().startsWith((path.join(repository, 'work') + path.sep).toLocaleLowerCase())) throw Error('Fixture must be inside repository/work.')
const count = Number(countText)
if (!Number.isInteger(count) || count < 5 || count > 1000) throw Error('Fixture count must be 5..1000.')
await fs.mkdir(path.dirname(root), {recursive: true}); await fs.mkdir(root, {recursive: false})
const content = path.join(root, 'content')
await fs.mkdir(path.join(content, 'items'), {recursive: true})
await fs.mkdir(path.join(content, '_requests'))
const ids = ['expedition_ore', 'quenching_sand', 'mat_grain', 'con_simple_meal', 'eq_patrol_sword']
const source = []
for (const id of ids) {
  const bytes = await fs.readFile(path.join(repository, 'content/items', `${id}.json`))
  await fs.writeFile(path.join(content, 'items', `${id}.json`), bytes)
  source.push({path: `content/items/${id}.json`, sha256: crypto.createHash('sha256').update(bytes).digest('hex')})
}
for (const name of (await fs.readdir(path.join(repository, 'content/_requests'))).filter(name => name.endsWith('.json'))) await fs.copyFile(path.join(repository, 'content/_requests', name), path.join(content, '_requests', name))
const categories = ['material', 'equipment', 'consumable', 'currency', 'key']
const labels = ['材料', '装备', '消耗品', '货币', '关键物品']
const prefixes = ['mat', 'eq', 'con', 'cur', 'key']
for (let i = 0; i < count - ids.length; i++) {
  const ci = i % categories.length; const suffix = String(i + 1).padStart(3, '0')
  const item = {schemaVersion: 1, id: `${prefixes[ci]}_layout_test_${suffix}`, aliases: [], name: `布局测试${labels[ci]} ${suffix}`, category: categories[ci], description: '仅用于 P1 浏览器布局验证的隔离测试定义，不是正式游戏内容。', icon: '', stackLimit: ci === 1 ? 1 : 99, baseValue: 0, tags: ['layout_fixture'], equipment: {slot: ci === 1 ? 'weapon' : '', combatBonus: [], enhancement: []}, consumable: {effects: []}, draft: false}
  await fs.writeFile(path.join(content, 'items', `${item.id}.json`), JSON.stringify(item, null, 2) + '\n')
}
await fs.writeFile(path.join(root, 'fixture.json'), JSON.stringify({fixtureOnly: true, preparedAt: new Date().toISOString(), count, contentRoot: content, runtimeRoot: path.join(root, 'runtime'), source}, null, 2) + '\n')
console.log(JSON.stringify({ok: true, count, contentRoot: content, runtimeRoot: path.join(root, 'runtime')}))
