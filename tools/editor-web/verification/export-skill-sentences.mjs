import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {skillSentence} from '../src/features/combat/skillSentence.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const [inputArgument, outputArgument] = process.argv.slice(2)
if (!inputArgument || !outputArgument) throw Error('Usage: node verification/export-skill-sentences.mjs <scenario.json> <new-output-dir>')
const input = path.resolve(inputArgument), output = path.resolve(outputArgument)
await fs.mkdir(path.dirname(output), {recursive: true}); await fs.mkdir(output, {recursive: false})
const sha = b => crypto.createHash('sha256').update(b).digest('hex')
const bytes = await fs.readFile(input), scenario = JSON.parse(bytes)
const source = path.join(root, 'tools/editor-web/src/features/combat/skillSentence.ts'), sourceBytes = await fs.readFile(source)
const rows = scenario.actions.filter(action => action.id.startsWith('mage_')).map(action => ({id: action.id, sourceFields: action, sentence: skillSentence(action)}))
const result = {generatedAt: new Date().toISOString(), sourceInput: path.relative(root, input).replaceAll('\\', '/'), inputSha256: sha(bytes), sentenceSource: path.relative(root, source).replaceAll('\\', '/'), sentenceSourceSha256: sha(sourceBytes), totalActions: scenario.actions.length, mageCount: rows.length, otherCount: scenario.actions.length - rows.length, rows}
await fs.writeFile(path.join(output, 'sentences.json'), JSON.stringify(result, null, 2) + '\n')
await fs.writeFile(path.join(output, 'sentences.md'), '# P2 mage skill sentences — implementation export\n\n27 mage actions are separate from the other 8 actions. This is a configuration description, not runtime or browser acceptance.\n\n' + rows.map(row => `## ${row.id}\n\n${row.sentence}\n`).join('\n'))
await fs.writeFile(path.join(output, 'skillSentence.ts'), sourceBytes)
console.log(JSON.stringify({ok: true, rows: rows.length, output, sourceSha256: result.sentenceSourceSha256}))
