import { useEditorStore } from '../store'
import { Modal } from './ui/modal'
import { Button } from './ui/button'

function flatten(value: unknown, path = ''): Record<string, string> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return Object.assign({}, ...Object.entries(value).map(([key, child]) => flatten(child, path ? `${path}.${key}` : key)))
  return {[path]: typeof value === 'string' ? value : JSON.stringify(value)}
}
export function ConflictDialog() {
  const {conflict, current, saving, cancelConflict, useDisk, save, online} = useEditorStore()
  if (!conflict || !current) return null
  const disk = flatten(conflict.disk); const mine = flatten(current.item)
  const keys = [...new Set([...Object.keys(disk), ...Object.keys(mine)])].filter(key => disk[key] !== mine[key])
  return <Modal open onOpenChange={value => {if (!value) cancelConflict()}} title="检测到磁盘版本冲突" description="打开后文件已被其他操作修改。请检查差异，再选择要保存的版本。" className="conflict-modal" footer={<><Button className="mr-auto" onClick={cancelConflict} disabled={saving}>稍后处理</Button><Button onClick={useDisk} disabled={saving} data-testid="use-disk">用磁盘的</Button><Button variant="default" disabled={saving || !online || !conflict.etag} onClick={() => void save(conflict.etag)} data-testid="keep-mine">保留我的</Button></>}>
    <table className="conflict-table"><thead><tr><th>字段</th><th>磁盘上的版本</th><th>我的修改</th></tr></thead><tbody>{keys.map(key => <tr key={key}><th className="mono">{key}</th><td>{disk[key] ?? '—'}</td><td>{mine[key] ?? '—'}</td></tr>)}</tbody></table>
    {!keys.length && <p>两个版本的字段相同，但文件字节已变化。仍需明确选择。</p>}
  </Modal>
}
