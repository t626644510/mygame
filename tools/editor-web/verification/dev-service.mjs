import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => value.startsWith('--') ? [...pairs, [value.slice(2), values[index + 1]]] : pairs, []))
const identityDir = path.resolve(args['identity-dir'] || '../../work/helper-editor-dev-service')
const port = Number(args.port || 5175)
const identity = {pid: process.pid, executablePath: process.execPath, cwd: process.cwd(), arguments: process.argv, port, api: process.env.SIM_API_URL || 'http://127.0.0.1:5185', startedAt: new Date().toISOString()}
await fs.mkdir(identityDir, {recursive: true})
await fs.writeFile(path.join(identityDir, 'frontend-process.json'), JSON.stringify(identity, null, 2) + '\n')
console.log(JSON.stringify(identity))
const server = await createServer({server: {host: '127.0.0.1', port, strictPort: true}})
await server.listen()
server.printUrls()
const stop = async signal => {await server.close(); console.log(JSON.stringify({pid: process.pid, stoppedBy: signal})); process.exit(0)}
process.on('SIGINT', () => void stop('SIGINT'))
process.on('SIGTERM', () => void stop('SIGTERM'))
