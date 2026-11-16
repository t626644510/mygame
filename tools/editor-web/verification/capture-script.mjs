import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const [script, out, ...args] = process.argv.slice(2)
if (!['capture-ui', 'browser-smoke', 'offline-smoke', 'capture-combat-ui', 'measure-combat-run'].includes(script) || !out) throw Error('Usage: node verification/capture-script.mjs <supported-script> <new-raw-log-directory> <script-arguments...>')
const root = path.resolve(out)
await fs.mkdir(path.dirname(root), {recursive: true}); await fs.mkdir(root, {recursive: false})
const commandArgs = [path.resolve('verification', `${script}.mjs`), ...args]
const child = spawn(process.execPath, commandArgs, {cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})
const stdout = []; const stderr = []
child.stdout.on('data', value => {stdout.push(value); process.stdout.write(value)})
child.stderr.on('data', value => {stderr.push(value); process.stderr.write(value)})
const exit = await new Promise((resolve, reject) => {child.once('error', reject); child.once('exit', (code, signal) => resolve({code, signal}))})
const streams = {}
for (const [name, bytes] of [['stdout', Buffer.concat(stdout)], ['stderr', Buffer.concat(stderr)]]) {
  await fs.writeFile(path.join(root, `${name}.bin`), bytes)
  streams[name] = {bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')}
}
await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify({script, executablePath: process.execPath, args: commandArgs, cwd: process.cwd(), pid: child.pid, finishedAt: new Date().toISOString(), exit, streams}, null, 2) + '\n')
process.exitCode = exit.code ?? 1
