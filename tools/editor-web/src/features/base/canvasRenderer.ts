import type {Building, BuildingInstance, Layout, LayoutDistance, Point} from './types'
import {buildingIndex, projectBuilding, resolveBuilding} from './geometry'

export const tileSize = 24
export interface Camera {x: number; y: number; zoom: number}
export interface Layers {terrain: boolean; buildings: boolean; entrances: boolean; grid: boolean; distance: boolean}
export interface CanvasGhost {instance: BuildingInstance; status: 'pending' | 'valid' | 'invalid'; message: string}
export const distancePalette = {
 light: {near: '#D6EDDF', middle: '#F1E6C8', far: '#F0D8D8', unreachable: '#DCE0E7'},
 dark: {near: '#29493F', middle: '#51482E', far: '#51363D', unreachable: '#252C37'},
}
const buildingColors: Record<string, string> = {workshop: '#5679B6', storage: '#4D8B74', housing: '#9A815A', shop: '#9472AA', public_service: '#518FA0', decoration: '#768891', pending: '#A77B3B'}
export function terrainBitmap(layout: Layout, distance: LayoutDistance | null, theme: 'light' | 'dark', layers: Layers) {
 const canvas = document.createElement('canvas'), scale = 4
 canvas.width = Math.max(1, Math.min(256, layout.width)) * scale; canvas.height = Math.max(1, Math.min(256, layout.height)) * scale
 const ctx = canvas.getContext('2d')!, palette = distancePalette[theme]
 ctx.fillStyle = theme === 'dark' ? '#17202B' : '#F1F4F8'; ctx.fillRect(0, 0, canvas.width, canvas.height)
 if (layers.distance && distance) for (let y = 0; y < layout.height; y++) for (let x = 0; x < layout.width; x++) {
  const d = distance.distanceField[y * layout.width + x]
  ctx.fillStyle = d < 0 ? palette.unreachable : d <= 4 ? palette.near : d <= 8 ? palette.middle : palette.far
  ctx.fillRect(x * scale, y * scale, scale, scale)
  if (d < 0) {ctx.strokeStyle = theme === 'dark' ? '#455263' : '#B2BBC9'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(x * scale, (y + 1) * scale); ctx.lineTo((x + 1) * scale, y * scale); ctx.stroke()}
 }
 if (layers.terrain) for (const tile of layout.tiles) {
  ctx.fillStyle = tile.kind === 'water' ? theme === 'dark' ? '#244C6C' : '#A4C9DF' : theme === 'dark' ? '#3D4652' : '#AEB8C6'
  ctx.fillRect(tile.x * scale, tile.y * scale, scale, scale)
 }
 return canvas
}
interface Frame {width: number; height: number; camera: Camera; layout: Layout; definitions: Building[]; layers: Layers; theme: 'light' | 'dark'; bitmap: HTMLCanvasElement; selected: string; errorIds: string[]; ghost: CanvasGhost | null; distance: LayoutDistance | null; highlight: Point | null; highlightAlpha: number}
export function drawLayoutScene(background: CanvasRenderingContext2D, overlay: CanvasRenderingContext2D, frame: Frame) {
 const {width, height, camera, layout, definitions, layers, theme, bitmap, selected, errorIds, ghost, distance, highlight, highlightAlpha} = frame, cell = tileSize * camera.zoom
 for (const ctx of [background, overlay]) ctx.clearRect(0, 0, width, height)
 background.fillStyle = theme === 'dark' ? '#101720' : '#E6EBF1'; background.fillRect(0, 0, width, height)
 background.imageSmoothingEnabled = false; background.drawImage(bitmap, camera.x, camera.y, layout.width * cell, layout.height * cell)
 const minX = Math.max(0, Math.floor(-camera.x / cell)), minY = Math.max(0, Math.floor(-camera.y / cell)), maxX = Math.min(layout.width, Math.ceil((width - camera.x) / cell)), maxY = Math.min(layout.height, Math.ceil((height - camera.y) / cell))
 if (layers.grid && cell >= 10) {
  background.strokeStyle = theme === 'dark' ? '#FFFFFF12' : '#40516B20'; background.lineWidth = 1; background.beginPath()
  for (let x = minX; x <= maxX; x++) {const px = Math.round(camera.x + x * cell) + 0.5; background.moveTo(px, Math.max(0, camera.y)); background.lineTo(px, Math.min(height, camera.y + layout.height * cell))}
  for (let y = minY; y <= maxY; y++) {const py = Math.round(camera.y + y * cell) + 0.5; background.moveTo(Math.max(0, camera.x), py); background.lineTo(Math.min(width, camera.x + layout.width * cell), py)}
  background.stroke()
 }
 if (layers.distance && distance && cell >= 22) {
  overlay.font = '10px "JetBrains Mono", monospace'; overlay.textAlign = 'center'; overlay.textBaseline = 'middle'; overlay.fillStyle = theme === 'dark' ? '#C0C8D0' : '#596677'
  for (let y = minY; y < maxY; y++) for (let x = minX; x < maxX; x++) {const d = distance.distanceField[y * layout.width + x]; if (d >= 0) overlay.fillText(String(d), camera.x + (x + 0.5) * cell, camera.y + (y + 0.5) * cell)}
 }
 const byId = buildingIndex(definitions)
 const renderBuilding = (instance: BuildingInstance, preview = false) => {
  const building = resolveBuilding(byId, instance.buildingId); if (!building) return
  const g = projectBuilding(building, instance), x = camera.x + g.x * cell, y = camera.y + g.y * cell, w = g.width * cell, h = g.height * cell
  if (x + w < -cell || y + h < -cell || x > width + cell || y > height + cell) return
  if (layers.buildings) {
   overlay.fillStyle = preview ? ghost?.status === 'invalid' ? '#D85B6855' : ghost?.status === 'valid' ? '#3BAF8055' : '#8E9AAC55' : buildingColors[building.function] || '#768891'
   overlay.globalAlpha = preview ? 0.85 : theme === 'dark' ? 0.9 : 0.84; overlay.fillRect(x + 1, y + 1, w - 2, h - 2); overlay.globalAlpha = 1
   overlay.strokeStyle = preview ? ghost?.status === 'invalid' ? '#E06573' : ghost?.status === 'valid' ? '#47BE91' : '#A9B4C4' : errorIds.includes(instance.instanceId) ? '#ED6075' : instance.instanceId === selected ? theme === 'dark' ? '#A3C1FF' : '#2455C3' : '#FFFFFF44'; overlay.lineWidth = instance.instanceId === selected || preview || errorIds.includes(instance.instanceId) ? 2 : 1
   overlay.setLineDash(preview ? [5, 3] : []); overlay.strokeRect(x + 1, y + 1, w - 2, h - 2); overlay.setLineDash([])
   if (w >= 36 && h >= 18) {
    overlay.save(); overlay.beginPath(); overlay.rect(x + 3, y + 2, w - 6, h - 4); overlay.clip(); overlay.fillStyle = '#FFFFFF'; overlay.textAlign = 'center'; overlay.textBaseline = 'middle'; overlay.font = '11px "Noto Sans SC", sans-serif'; overlay.fillText(building.name, x + w / 2, y + h / 2 - (h >= 40 ? 7 : 0), w - 6)
    if (h >= 40) {overlay.font = '9px "JetBrains Mono", monospace'; overlay.fillText(instance.instanceId, x + w / 2, y + h / 2 + 9, w - 6)}
    overlay.restore()
   }
  }
  if (layers.entrances) {
   const ex = camera.x + (g.entrance.x + 0.5) * cell, ey = camera.y + (g.entrance.y + 0.5) * cell, radius = Math.max(2, Math.min(5, cell / 5))
   overlay.fillStyle = theme === 'dark' ? '#F4CB78' : '#8E6218'; overlay.beginPath(); overlay.arc(ex, ey, radius, 0, Math.PI * 2); overlay.fill()
   if (cell >= 20) {overlay.fillStyle = theme === 'dark' ? '#FFF0CB' : '#4C3510'; overlay.font = '12px sans-serif'; overlay.textAlign = 'center'; overlay.textBaseline = 'middle'; const localX = g.entrance.x - g.x, localY = g.entrance.y - g.y; overlay.fillText(localX < 0 ? '→' : localX >= g.width ? '←' : localY < 0 ? '↓' : localY >= g.height ? '↑' : '·', ex, ey)}
  }
 }
 for (const instance of layout.buildings) if (instance.instanceId !== ghost?.instance.instanceId) renderBuilding(instance)
 for (const spawn of layout.spawns) {
  const x = camera.x + (spawn.x + 0.5) * cell, y = camera.y + (spawn.y + 0.5) * cell
  if (x < -cell || x > width + cell || y < -cell || y > height + cell) continue
  overlay.fillStyle = theme === 'dark' ? '#95D6CE' : '#246E70'; const r = Math.min(6, Math.max(3, cell / 4)); overlay.beginPath(); overlay.moveTo(x, y - r); overlay.lineTo(x + r, y); overlay.lineTo(x, y + r); overlay.lineTo(x - r, y); overlay.closePath(); overlay.fill()
  if (cell >= 24) {overlay.font = '10px "Noto Sans SC", sans-serif'; overlay.textAlign = 'left'; overlay.fillText(spawn.id, x + r + 3, y - 6)}
  if (selected === 'spawn:' + spawn.id) {overlay.strokeStyle = '#638FF2'; overlay.lineWidth = 2; overlay.strokeRect(x - cell / 2 + 1, y - cell / 2 + 1, cell - 2, cell - 2)}
 }
 if (ghost) renderBuilding(ghost.instance, true)
 if (highlight && highlightAlpha > 0) {overlay.save(); overlay.globalAlpha = highlightAlpha; overlay.fillStyle = '#EB657B55'; overlay.strokeStyle = '#ED6075'; overlay.lineWidth = 3; overlay.fillRect(camera.x + highlight.x * cell, camera.y + highlight.y * cell, cell, cell); overlay.strokeRect(camera.x + highlight.x * cell + 1, camera.y + highlight.y * cell + 1, cell - 2, cell - 2); overlay.restore()}
}
