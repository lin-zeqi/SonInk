import Konva from 'konva'
import { getMainLayer, getFeedbackLayer, getCanvasSize } from '../canvas/stage'
import { revealShape } from '../canvas/draw-animation'
import { useObjectsStore, type CanvasObject } from '../store/objects'
import {
  DIRECTION_LABELS,
  POSITION_LABELS,
  SHAPE_LABELS,
  type DeleteCommand,
  type Direction,
  type DslCommand,
  type DrawCommand,
  type ExecResult,
  type MoveCommand,
  type SelectCommand,
  type SemanticPosition,
  type SemanticSize,
  type TargetSpec,
} from './types'

/**
 * DSL 执行引擎：将语义化指令换算为像素并落到 Konva 画布。
 * 语义 → 像素的全部换算集中在此处，解析层永不接触坐标（docs/design.md §3.3）。
 */

const DEFAULT_COLOR = '#42a5f5'

/** 九宫格 → 画布比例坐标 */
const POSITION_FRACTIONS: Record<SemanticPosition, [number, number]> = {
  'top-left': [0.2, 0.22],
  top: [0.5, 0.22],
  'top-right': [0.8, 0.22],
  left: [0.2, 0.5],
  center: [0.5, 0.5],
  right: [0.8, 0.5],
  'bottom-left': [0.2, 0.78],
  bottom: [0.5, 0.78],
  'bottom-right': [0.8, 0.78],
}

/** 语义大小 → 相对画布短边的比例（圆=半径，方/三角=外接半径） */
const SIZE_FRACTIONS: Record<SemanticSize, number> = {
  small: 0.05,
  medium: 0.09,
  large: 0.15,
}

/** 语义移动步长 → 相对画布短边的比例 */
const MOVE_FRACTIONS: Record<'small' | 'medium' | 'large', number> = {
  small: 0.06,
  medium: 0.14,
  large: 0.28,
}

const DIRECTION_VECTORS: Record<Direction, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
}

let nextId = 1

function resolvePosition(position: SemanticPosition | undefined): { x: number; y: number } {
  const { width, height } = getCanvasSize()
  if (position) {
    const [fx, fy] = POSITION_FRACTIONS[position]
    return { x: width * fx, y: height * fy }
  }
  // 未指定位置：画布中心附近随机偏移，避免连续绘制完全重叠
  const jitter = () => (Math.random() - 0.5) * 0.24
  return { x: width * (0.5 + jitter()), y: height * (0.5 + jitter()) }
}

function resolveSize(size: SemanticSize | number | undefined): number {
  if (typeof size === 'number') return size
  const { width, height } = getCanvasSize()
  return Math.min(width, height) * SIZE_FRACTIONS[size ?? 'medium']
}

function createNode(cmd: DrawCommand, id: string): Konva.Shape {
  const { x, y } = resolvePosition(cmd.props?.position)
  const r = resolveSize(cmd.props?.size)
  const color = cmd.props?.color ?? DEFAULT_COLOR

  // 填充图形同时带同色描边：渐进绘制动画沿描边逐笔画出轮廓
  switch (cmd.shape) {
    case 'circle':
      return new Konva.Circle({ id, x, y, radius: r, fill: color, stroke: color, strokeWidth: 3 })
    case 'rect':
      return new Konva.Rect({
        id,
        x: x - r,
        y: y - r,
        width: r * 2,
        height: r * 2,
        fill: color,
        stroke: color,
        strokeWidth: 3,
      })
    case 'triangle':
      return new Konva.RegularPolygon({
        id,
        x,
        y,
        sides: 3,
        radius: r,
        fill: color,
        stroke: color,
        strokeWidth: 3,
      })
    case 'line':
      return new Konva.Line({
        id,
        points: [x - r * 1.5, y, x + r * 1.5, y],
        stroke: color,
        strokeWidth: 4,
        lineCap: 'round',
      })
  }
}

function findNode(id: string): Konva.Shape | null {
  return (getMainLayer().findOne(`#${id}`) as Konva.Shape | undefined) ?? null
}

/** 按选中集合重绘高亮框（反馈层，不进入对象登记表） */
function syncHighlight(): void {
  const layer = getFeedbackLayer()
  layer.destroyChildren()
  const store = useObjectsStore()
  for (const id of store.selectedIds) {
    const node = findNode(id)
    if (!node) continue
    const box = node.getClientRect()
    layer.add(
      new Konva.Rect({
        x: box.x - 4,
        y: box.y - 4,
        width: box.width + 8,
        height: box.height + 8,
        stroke: '#ff9800',
        strokeWidth: 2,
        dash: [6, 4],
      })
    )
  }
}

/**
 * 指代消解（P0 范围，docs/design.md §3.3）。
 * - 空 target：当前选中，否则最近对象；
 * - ref last：最近对象；ref selected：当前选中（无选中则退化为最近对象）；
 * - 特征匹配：shape/color 过滤全部对象；若有选中且选中与匹配集有交集，
 *   优先取交集（"选中红圆"后说"删掉这个圆"应只作用于选中者）；
 * - ref last + 特征同时存在时取匹配集中最近的一个（"刚才那个圆"）。
 */
function resolveTarget(target: TargetSpec | undefined): CanvasObject[] {
  const store = useObjectsStore()
  const all = store.objects
  const selected = store.selectedObjects

  const hasFeature = target?.shape !== undefined || target?.color !== undefined

  if (!target || (target.ref === undefined && !hasFeature)) {
    return selected.length ? selected : all.slice(-1)
  }

  if (hasFeature) {
    let matched = all.filter(
      (o) =>
        (target.shape === undefined || o.shape === target.shape) &&
        (target.color === undefined || o.color === target.color)
    )
    if (selected.length) {
      const inSelection = matched.filter((o) => store.selectedIds.includes(o.id))
      if (inSelection.length) matched = inSelection
    }
    if (target.ref === 'last' && matched.length > 1) return matched.slice(-1)
    return matched
  }

  if (target.ref === 'last') return all.slice(-1)
  return selected.length ? selected : all.slice(-1)
}

function describe(obj: CanvasObject): string {
  return SHAPE_LABELS[obj.shape]
}

function execDraw(cmd: DrawCommand): ExecResult {
  const id = `obj-${nextId++}`
  const node = createNode(cmd, id)
  getMainLayer().add(node)
  revealShape(node, cmd.shape === 'line' ? null : (cmd.props?.color ?? DEFAULT_COLOR))
  useObjectsStore().register({
    id,
    shape: cmd.shape,
    color: cmd.props?.color ?? DEFAULT_COLOR,
  })
  return { ok: true, message: `已画一个${SHAPE_LABELS[cmd.shape]}` }
}

function execSelect(cmd: SelectCommand): ExecResult {
  const matched = resolveTarget(cmd.target)
  if (!matched.length) return { ok: false, message: '没有找到匹配的对象' }

  useObjectsStore().setSelection(matched.map((o) => o.id))
  syncHighlight()

  if (matched.length === 1) return { ok: true, message: `已选中${describe(matched[0])}` }
  return {
    ok: true,
    message: `找到 ${matched.length} 个匹配对象，已全部高亮，请说得更具体些`,
  }
}

function execMove(cmd: MoveCommand): ExecResult {
  const matched = resolveTarget(cmd.target)
  if (!matched.length) return { ok: false, message: '画布上没有可移动的对象' }
  if (matched.length > 1) {
    return { ok: false, message: '匹配到多个对象，请先选中要移动的那一个' }
  }

  const node = findNode(matched[0].id)
  if (!node) return { ok: false, message: '对象状态异常，请重试' }

  const { width, height } = getCanvasSize()

  if (cmd.position) {
    const [fx, fy] = POSITION_FRACTIONS[cmd.position]
    const box = node.getClientRect()
    node.move({
      x: width * fx - (box.x + box.width / 2),
      y: height * fy - (box.y + box.height / 2),
    })
    syncHighlight()
    return { ok: true, message: `已移动到${POSITION_LABELS[cmd.position]}` }
  }

  const direction = cmd.direction ?? 'right'
  const distance =
    typeof cmd.distance === 'number'
      ? cmd.distance
      : Math.min(width, height) * MOVE_FRACTIONS[cmd.distance ?? 'medium']
  const [vx, vy] = DIRECTION_VECTORS[direction]
  node.move({ x: vx * distance, y: vy * distance })
  syncHighlight()
  return { ok: true, message: `已向${DIRECTION_LABELS[direction]}移动` }
}

function execDelete(cmd: DeleteCommand): ExecResult {
  const matched = resolveTarget(cmd.target)
  if (!matched.length) return { ok: false, message: '没有找到要删除的对象' }

  const store = useObjectsStore()
  for (const obj of matched) {
    findNode(obj.id)?.destroy()
    store.remove(obj.id)
  }
  syncHighlight()

  if (matched.length === 1) return { ok: true, message: `已删除${describe(matched[0])}` }
  return { ok: true, message: `已删除 ${matched.length} 个对象` }
}

function execClear(): ExecResult {
  getMainLayer().destroyChildren()
  getFeedbackLayer().destroyChildren()
  useObjectsStore().clear()
  return { ok: true, message: '已清空画布' }
}

export function execute(cmd: DslCommand): ExecResult {
  switch (cmd.action) {
    case 'draw':
      return execDraw(cmd)
    case 'select':
      return execSelect(cmd)
    case 'move':
      return execMove(cmd)
    case 'delete':
      return execDelete(cmd)
    case 'clear':
      return execClear()
  }
}

/** 顺序执行指令序列（复合指令拆解结果），返回合并反馈 */
export function executeAll(commands: DslCommand[]): ExecResult {
  const messages: string[] = []
  for (const cmd of commands) {
    const result = execute(cmd)
    if (!result.ok) return result
    messages.push(result.message)
  }
  return { ok: true, message: messages.join('，') }
}
