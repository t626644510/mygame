import {useCallback, useEffect, useRef} from 'react'
import {Focus, Minus, Plus} from 'lucide-react'
import {Button} from '../../components/ui/button'
import {drawLayoutScene, terrainBitmap, tileSize, type Camera, type CanvasGhost, type Layers} from './canvasRenderer'
import {buildingIndex, projectBuilding, resolveBuilding} from './geometry'
import type {Building, BuildingInstance, Layout, LayoutDistance, Point} from './types'

export type MapTool = 'select' | 'passable' | 'blocked' | 'water'
interface Props {layout: Layout; definitions: Building[]; selected: string; errorIds: string[]; placement: BuildingInstance | null; tool: MapTool; layers: Layers; distance: LayoutDistance | null; ghostStatus: CanvasGhost['status']; ghostMessage: string; focus: (Point & {serial: number}) | null; disabled: boolean; onSelect: (id: string) => void; onGhost: (instance: BuildingInstance | null) => void; onPlace: (point: Point, continuous: boolean) => void; onMove: (id: string, point: Point) => void; onPaint: (tiles: Layout['tiles']) => void; onCancel: () => void}
export function LayoutCanvas(props: Props) {
 const viewport = useRef<HTMLDivElement>(null), background = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLCanvasElement>(null), zoomText = useRef<HTMLSpanElement>(null), coordinates = useRef<HTMLSpanElement>(null), tooltip = useRef<HTMLDivElement>(null), data = useRef(props)
 data.current = props
 const activePlacement = props.placement, updateGhost = props.onGhost
 const camera = useRef<Camera>({x: 20, y: 20, zoom: 1}), size = useRef({width: 1, height: 1}), bitmap = useRef<HTMLCanvasElement | null>(null), frame = useRef(0), theme = useRef<'light' | 'dark'>('light'), ghost = useRef<BuildingInstance | null>(null), space = useRef(false), flashing = useRef<{point: Point; start: number} | null>(null), initialized = useRef('')
 const interaction = useRef<{kind: 'pan'; start: Point; camera: Camera} | {kind: 'move'; id: string; start: Point; original: BuildingInstance} | {kind: 'paint'; tiles: Map<string, Layout['tiles'][number]>} | null>(null)
 const render = useCallback(function drawFrame() {
  frame.current = 0
  const current = data.current, bg = background.current?.getContext('2d'), fg = overlay.current?.getContext('2d'); if (!bg || !fg || !bitmap.current) return
  const dpr = window.devicePixelRatio || 1; bg.setTransform(dpr, 0, 0, dpr, 0, 0); fg.setTransform(dpr, 0, 0, dpr, 0, 0)
  const flash = flashing.current, elapsed = flash ? performance.now() - flash.start : 9999
  drawLayoutScene(bg, fg, {...size.current, camera: camera.current, layout: current.layout, definitions: current.definitions, layers: current.layers, theme: theme.current, bitmap: bitmap.current, selected: current.selected, errorIds: current.errorIds, ghost: ghost.current ? {instance: ghost.current, status: current.ghostStatus, message: current.ghostMessage} : null, distance: current.distance, highlight: flash?.point || null, highlightAlpha: elapsed < 1300 ? 0.45 + 0.45 * Math.sin(elapsed / 85) : 0})
  if (zoomText.current) zoomText.current.textContent = `${Math.round(camera.current.zoom * 100)}%`
  if (viewport.current) {viewport.current.dataset.zoom = String(camera.current.zoom); viewport.current.dataset.cameraX = String(camera.current.x); viewport.current.dataset.cameraY = String(camera.current.y); viewport.current.dataset.renderedAt = String(performance.now())}
  if (elapsed < 1300) frame.current = requestAnimationFrame(drawFrame)
 }, [])
 const invalidate = useCallback(() => {if (!frame.current) frame.current = requestAnimationFrame(render)}, [render])
 const fit = useCallback(() => {const layout = data.current.layout, {width, height} = size.current, zoom = Math.max(0.25, Math.min(4, (width - 64) / (layout.width * tileSize), (height - 64) / (layout.height * tileSize))); camera.current = {zoom, x: (width - layout.width * tileSize * zoom) / 2, y: (height - layout.height * tileSize * zoom) / 2}; invalidate()}, [invalidate])
 const rebuild = useCallback(() => {const current = data.current; theme.current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'; bitmap.current = terrainBitmap(current.layout, current.distance, theme.current, current.layers); invalidate()}, [invalidate])
 useEffect(() => {
  const element = viewport.current; if (!element) return
  const resize = () => {const bounds = element.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; size.current = {width: bounds.width, height: bounds.height}; for (const canvas of [background.current, overlay.current]) if (canvas) {canvas.width = Math.round(bounds.width * dpr); canvas.height = Math.round(bounds.height * dpr)} if (!initialized.current) fit(); invalidate()}
  const observer = new ResizeObserver(resize); observer.observe(element); resize()
  const mutation = new MutationObserver(rebuild); mutation.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']})
  const key = (event: KeyboardEvent) => {const editable = event.target instanceof HTMLElement && !!event.target.closest('input,textarea,select,[contenteditable="true"]'); if (event.code === 'Space' && !editable && element.contains(document.activeElement)) {space.current = event.type === 'keydown'; event.preventDefault()}}
  const blur = () => {space.current = false}
  window.addEventListener('keydown', key); window.addEventListener('keyup', key); window.addEventListener('blur', blur)
  const wheel = (event: WheelEvent) => {event.preventDefault(); const bounds = element.getBoundingClientRect(), px = event.clientX - bounds.left, py = event.clientY - bounds.top, old = camera.current, zoom = Math.max(0.25, Math.min(4, old.zoom * Math.exp(-event.deltaY * 0.0015))), ratio = zoom / old.zoom; camera.current = {zoom, x: px - (px - old.x) * ratio, y: py - (py - old.y) * ratio}; invalidate()}
  element.addEventListener('wheel', wheel, {passive: false})
  let active = true; void document.fonts.ready.then(() => {if (active) invalidate()}); document.fonts.addEventListener('loadingdone', invalidate)
  return () => {active = false; document.fonts.removeEventListener('loadingdone', invalidate); observer.disconnect(); mutation.disconnect(); element.removeEventListener('wheel', wheel); window.removeEventListener('keydown', key); window.removeEventListener('keyup', key); window.removeEventListener('blur', blur); if (frame.current) cancelAnimationFrame(frame.current); frame.current = 0}
 }, [fit, invalidate, rebuild])
 useEffect(() => {rebuild()}, [props.layout, props.distance, props.layers, rebuild])
 useEffect(() => {if (initialized.current !== props.layout.id && size.current.width > 1) {initialized.current = props.layout.id; fit()}}, [props.layout.id, fit])
 useEffect(() => {invalidate()}, [props.selected, props.ghostStatus, props.ghostMessage, props.definitions, props.errorIds, invalidate])
 useEffect(() => {if (!props.placement) {ghost.current = null; invalidate()}}, [props.placement, invalidate])
 useEffect(() => {if (activePlacement && ghost.current) {ghost.current = {...activePlacement, x: ghost.current.x, y: ghost.current.y}; updateGhost(ghost.current); invalidate()}}, [activePlacement, updateGhost, invalidate])
 useEffect(() => {if (!props.focus) return; const point = props.focus; camera.current = {...camera.current, x: size.current.width / 2 - (point.x + 0.5) * tileSize * camera.current.zoom, y: size.current.height / 2 - (point.y + 0.5) * tileSize * camera.current.zoom}; flashing.current = {point, start: performance.now()}; invalidate(); viewport.current?.focus()}, [props.focus, invalidate])
 const pointAt = (event: {clientX: number; clientY: number}) => {const bounds = viewport.current!.getBoundingClientRect(), cell = tileSize * camera.current.zoom; return {x: Math.floor((event.clientX - bounds.left - camera.current.x) / cell), y: Math.floor((event.clientY - bounds.top - camera.current.y) / cell)}}
 const paint = (point: Point) => {const active = interaction.current, current = data.current; if (active?.kind !== 'paint' || point.x < 0 || point.y < 0 || point.x >= current.layout.width || point.y >= current.layout.height) return; const key = `${point.x},${point.y}`; if (current.tool === 'passable') active.tiles.delete(key); else active.tiles.set(key, {...point, kind: current.tool === 'water' ? 'water' : 'blocked'}); bitmap.current = terrainBitmap({...current.layout, tiles: [...active.tiles.values()]}, current.distance, theme.current, current.layers); invalidate()}
 const down = (event: React.PointerEvent<HTMLDivElement>) => {
  if ((event.target as HTMLElement).closest('button') || data.current.disabled) return
  event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
  if (event.button === 1 || event.button === 0 && space.current) {event.preventDefault(); interaction.current = {kind: 'pan', start: {x: event.clientX, y: event.clientY}, camera: {...camera.current}}; return}
  if (event.button !== 0) return
  const point = pointAt(event), current = data.current
  if (current.placement) {current.onPlace(point, event.shiftKey); return}
  if (current.tool !== 'select') {interaction.current = {kind: 'paint', tiles: new Map(current.layout.tiles.map(tile => [`${tile.x},${tile.y}`, tile]))}; paint(point); return}
  const index = buildingIndex(current.definitions)
  const found = [...current.layout.buildings].reverse().find(instance => {const definition = resolveBuilding(index, instance.buildingId); if (!definition) return false; const g = projectBuilding(definition, instance); return point.x >= g.x && point.x < g.x + g.width && point.y >= g.y && point.y < g.y + g.height})
  if (found) {current.onSelect(found.instanceId); interaction.current = {kind: 'move', id: found.instanceId, original: found, start: point}}
  else {const spawn = current.layout.spawns.find(spawn => spawn.x === point.x && spawn.y === point.y); current.onSelect(spawn ? 'spawn:' + spawn.id : '')}
 }
 const move = (event: React.PointerEvent<HTMLDivElement>) => {
  const current = data.current, point = pointAt(event), active = interaction.current
  if (coordinates.current) coordinates.current.textContent = `${point.x}, ${point.y}`
  if (active?.kind === 'pan') {camera.current = {...active.camera, x: active.camera.x + event.clientX - active.start.x, y: active.camera.y + event.clientY - active.start.y}; invalidate(); return}
  if (current.disabled) return
  if (active?.kind === 'paint') {paint(point); return}
  const preview = active?.kind === 'move' ? {...active.original, x: active.original.x + point.x - active.start.x, y: active.original.y + point.y - active.start.y} : current.placement ? {...current.placement, ...point} : null
  if (preview && (!ghost.current || preview.x !== ghost.current.x || preview.y !== ghost.current.y || preview.rotation !== ghost.current.rotation)) {ghost.current = preview; current.onGhost(preview); invalidate()}
  if (tooltip.current) {const rect = viewport.current!.getBoundingClientRect(); tooltip.current.style.left = Math.min(size.current.width - 240, event.clientX - rect.left + 16) + 'px'; tooltip.current.style.top = Math.min(size.current.height - 54, event.clientY - rect.top + 16) + 'px'}
 }
 const up = () => {const active = interaction.current, current = data.current; interaction.current = null; if (active?.kind === 'move' && ghost.current) current.onMove(active.id, {x: ghost.current.x, y: ghost.current.y}); else if (active?.kind === 'paint') current.onPaint([...active.tiles.values()]); if (!current.placement) {ghost.current = null; current.onGhost(null)} invalidate()}
 const zoom = (factor: number) => {const current = camera.current, next = Math.max(0.25, Math.min(4, current.zoom * factor)), ratio = next / current.zoom; camera.current = {zoom: next, x: size.current.width / 2 - (size.current.width / 2 - current.x) * ratio, y: size.current.height / 2 - (size.current.height / 2 - current.y) * ratio}; invalidate()}
 return <div className={`layout-viewport tool-${props.placement ? 'place' : props.tool}`} ref={viewport} tabIndex={0} role="application" aria-label="基地布局画布，滚轮缩放，空格或中键拖动平移" data-testid="layout-canvas" data-renderer="src/features/base/canvasRenderer.ts#drawLayoutScene" data-layout-width={props.layout.width} data-layout-height={props.layout.height} data-instance-count={props.layout.buildings.length} data-distance={props.layers.distance && !!props.distance} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => {interaction.current = null; ghost.current = null; props.onGhost(null); rebuild()}} onPointerLeave={() => {if (!interaction.current) {ghost.current = null; props.onGhost(null); invalidate()}}} onContextMenu={e => {e.preventDefault(); props.onCancel()}}><canvas ref={background} aria-hidden="true" /><canvas ref={overlay} aria-hidden="true" /><div className="canvas-view-tools"><Button size="icon" variant="ghost" aria-label="缩小地图" onClick={() => zoom(1 / 1.25)}><Minus size={14} /></Button><span ref={zoomText}>100%</span><Button size="icon" variant="ghost" aria-label="放大地图" onClick={() => zoom(1.25)}><Plus size={14} /></Button><Button size="sm" variant="ghost" title="适配窗口，缩放下限25%" onClick={fit}><Focus size={13} />适配窗口</Button></div><div className="canvas-position"><span ref={coordinates}>—</span><span>{props.layout.width} × {props.layout.height}</span><span>R 旋转 · Shift 连放 · Delete 删除</span></div><div ref={tooltip} className={`canvas-ghost-tip ${props.ghostStatus}`} hidden={!ghost.current}>{props.ghostMessage || '位置检查中…'}</div></div>
}
