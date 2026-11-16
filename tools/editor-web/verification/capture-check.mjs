import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const task = process.argv[2]
const out = process.argv[3]
if (!['build', 'lint'].includes(task) || !out) throw Error('Usage: node verification/capture-check.mjs build|lint <new-evidence-directory>')
const root = path.resolve(out)
await fs.mkdir(path.dirname(root), {recursive: true})
await fs.mkdir(root, {recursive: false})
const command = process.platform === 'win32' ? process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe' : 'npm'
const args = process.platform === 'win32' ? ['/d', '/s', '/c', `npm.cmd run ${task}`] : ['run', task]
const stdout = []; const stderr = []; const startedAt = new Date().toISOString()
const child = spawn(command, args, {cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})
child.stdout.on('data', bytes => {stdout.push(bytes); process.stdout.write(bytes)})
child.stderr.on('data', bytes => {stderr.push(bytes); process.stderr.write(bytes)})
const {code, signal} = await new Promise((resolve, reject) => {child.once('error', reject); child.once('exit', (code, signal) => resolve({code, signal}))})
const streams = {stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr)}
const hashes = {}
for (const [name, bytes] of Object.entries(streams)) {await fs.writeFile(path.join(root, `${name}.bin`), bytes); hashes[name] = {bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex')}}
await fs.writeFile(path.join(root, 'receipt.json'), JSON.stringify({task, command, args, cwd: process.cwd(), pid: child.pid, startedAt, finishedAt: new Date().toISOString(), exitCode: code, signal, streams: hashes}, null, 2) + '\n')
process.exitCode = code ?? 1
