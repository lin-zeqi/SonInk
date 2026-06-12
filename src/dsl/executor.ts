import Konva from 'konva'
import { getMainLayer, getFeedbackLayer, getCanvasSize } from '../canvas/stage'
import { revealShape } from '../canvas/draw-animation'
import { findNode, syncHighlight } from '../canvas/highlight'
import {
  captureSnapshot,
  clearPendingAttrs,
  restoreSnapshot,
  setPendingAttrs,
  snapshotChanged,
} from '../history/snapshot'
import { useHistoryStore } from '../store/history'
import { useObjectsStore, type CanvasObject } from '../store/objects'
import {
  DIRECTION_LABELS,
  POSITION_FRACTIONS,
  POSITION_LABELS,
  SHAPE_LABELS,
  type DeleteCommand,
  type Direction,
  type DslCommand,
  type DrawCommand,
  type ExecResult,
  type MoveCommand,
  type PositionFraction,
  type RelativeTo,
  type ResizeCommand,
  type SelectCommand,
  type SemanticPosition,
  type SemanticSize,
  type StyleCommand,
  type TargetSpec,
} from './types'

/**
 * DSL 执行引擎：将语义化指令换算为像素并落到 Konva 画布。
 * 语义 → 像素的全部换算集中在此处，解析层永不接触坐标（docs/design.md §3.3）。
 */

const DEFAULT_COLOR = '#42a5f5'

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

/** 移动/缩放的过渡动画时长（秒）——纯视觉，几何终态在指令执行时即确定 */
const TRANSITION_DURATION = 0.35

/** 缩放下限，避免对象缩到不可见 */
const MIN_RADIUS = 4

/**
 * 带过渡动画地修改节点属性：高亮框先清除（避免动画期间停留在旧位置），
 * 动画结束后按选中态重绘。
 */
function animateTo(node: Konva.Shape, attrs: Record<string, number | string>): void {
  getFeedbackLayer().destroyChildren()
  setPendingAttrs(node.id(), attrs)
  node.to({
    ...attrs,
    duration: TRANSITION_DURATION,
    easing: Konva.Easings.EaseInOut,
    onFinish: () => {
      clearPendingAttrs(node.id())
      syncHighlight()
    },
  })
}

let nextId = 1

function resolvePosition(
  position: SemanticPosition | PositionFraction | undefined
): { x: number; y: number } {
  const { width, height } = getCanvasSize()
  if (typeof position === 'object') {
    return { x: width * position.fx, y: height * position.fy }
  }
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

  // 填充图形同时带同色描边：渐进绘制动画沿描边逐笔画出轮廓。
  // draggable 随节点序列化进快照，撤销/重做恢复后仍可拖拽
  switch (cmd.shape) {
    case 'circle':
      return new Konva.Circle({
        id,
        x,
        y,
        radius: r,
        fill: color,
        stroke: color,
        strokeWidth: 3,
        draggable: true,
      })
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
        draggable: true,
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
        draggable: true,
      })
    case 'line': {
      const { from, to } = cmd.props ?? {}
      const { width, height } = getCanvasSize()
      // 指定起止点（LLM 组合图形场景）优先；否则按位置画水平线
      const points =
        from && to
          ? [width * from.fx, height * from.fy, width * to.fx, height * to.fy]
          : [x - r * 1.5, y, x + r * 1.5, y]
      return new Konva.Line({
        id,
        points,
        stroke: color,
        strokeWidth: 4,
        lineCap: 'round',
        draggable: true,
      })
    }
    case 'text': {
      const node = new Konva.Text({
        id,
        x,
        y,
        text: cmd.props?.text ?? '文本',
        fontSize: r,
        fontStyle: 'bold',
        fill: cmd.props?.color ?? '#212121',
        draggable: true,
      })
      // Konva.Text 以左上角定位，按测量结果居中到目标点
      node.offsetX(node.width() / 2)
      node.offsetY(node.height() / 2)
      return node
    }
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

/**
 * 相对定位（"在圆的右边画方形"）：按特征找锚点对象（多个匹配取最近创建的），
 * 用其包围盒 + 新对象大小算出新中心，转回比例坐标交给 createNode。
 */
function resolveRelativePosition(
  rel: RelativeTo,
  newSize: number
): { ok: true; position: PositionFraction } | { ok: false; message: string } {
  const anchors = useObjectsStore().objects.filter(
    (o) =>
      (rel.shape === undefined || o.shape === rel.shape) &&
      (rel.color === undefined || o.color === rel.color)
  )
  const anchor = anchors[anchors.length - 1]
  const node = anchor ? findNode(anchor.id) : null
  if (!node) {
    return {
      ok: false,
      message: `画布上没找到要参照的${rel.shape ? SHAPE_LABELS[rel.shape] : '对象'}`,
    }
  }

  const box = node.getClientRect()
  const gap = 16
  let x = box.x + box.width / 2
  let y = box.y + box.height / 2
  switch (rel.relation) {
    case 'right-of':
      x = box.x + box.width + gap + newSize
      break
    case 'left-of':
      x = box.x - gap - newSize
      break
    case 'above':
      y = box.y - gap - newSize
      break
    case 'below':
      y = box.y + box.height + gap + newSize
      break
  }

  const { width, height } = getCanvasSize()
  const clamp = (v: number) => Math.min(0.98, Math.max(0.02, v))
  return { ok: true, position: { fx: clamp(x / width), fy: clamp(y / height) } }
}

function execDraw(cmd: DrawCommand): ExecResult {
  if (cmd.props?.relativeTo) {
    const resolved = resolveRelativePosition(cmd.props.relativeTo, resolveSize(cmd.props.size))
    if (!resolved.ok) return { ok: false, message: resolved.message }
    cmd = { ...cmd, props: { ...cmd.props, position: resolved.position } }
  }

  const id = `obj-${nextId++}`
  const node = createNode(cmd, id)
  getMainLayer().add(node)
  const color = cmd.props?.color ?? (cmd.shape === 'text' ? '#212121' : DEFAULT_COLOR)
  revealShape(node, cmd.shape === 'line' ? null : color)
  useObjectsStore().register({ id, shape: cmd.shape, color })
  if (cmd.shape === 'text') {
    return { ok: true, message: `已写上"${cmd.props?.text ?? ''}"` }
  }
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
    animateTo(node, {
      x: node.x() + (width * fx - (box.x + box.width / 2)),
      y: node.y() + (height * fy - (box.y + box.height / 2)),
    })
    return { ok: true, message: `已移动到${POSITION_LABELS[cmd.position]}` }
  }

  const direction = cmd.direction ?? 'right'
  const distance =
    typeof cmd.distance === 'number'
      ? cmd.distance
      : Math.min(width, height) * MOVE_FRACTIONS[cmd.distance ?? 'medium']
  const [vx, vy] = DIRECTION_VECTORS[direction]
  animateTo(node, { x: node.x() + vx * distance, y: node.y() + vy * distance })
  return { ok: true, message: `已向${DIRECTION_LABELS[direction]}移动` }
}

function execResize(cmd: ResizeCommand): ExecResult {
  const matched = resolveTarget(cmd.target)
  if (!matched.length) return { ok: false, message: '画布上没有可缩放的对象' }
  if (matched.length > 1) {
    return { ok: false, message: '匹配到多个对象，请先选中要缩放的那一个' }
  }

  const node = findNode(matched[0].id)
  if (!node) return { ok: false, message: '对象状态异常，请重试' }

  const doneMessage =
    cmd.size !== undefined ? '已调整大小' : (cmd.scale ?? 1) > 1 ? '已放大' : '已缩小'

  if (node instanceof Konva.Circle || node instanceof Konva.RegularPolygon) {
    const r = node.radius()
    const target = Math.max(cmd.size ?? r * (cmd.scale ?? 1), MIN_RADIUS)
    animateTo(node, { radius: target })
    return { ok: true, message: doneMessage }
  }

  if (node instanceof Konva.Rect) {
    const w = node.width()
    const factor = cmd.size !== undefined ? (cmd.size * 2) / w : (cmd.scale ?? 1)
    const newW = Math.max(w * factor, MIN_RADIUS * 2)
    const newH = Math.max(node.height() * factor, MIN_RADIUS * 2)
    // 保持中心不动：宽高变化的一半反向补偿到左上角
    animateTo(node, {
      x: node.x() - (newW - w) / 2,
      y: node.y() - (newH - node.height()) / 2,
      width: newW,
      height: newH,
    })
    return { ok: true, message: doneMessage }
  }

  if (node instanceof Konva.Line) {
    if (cmd.size !== undefined) {
      return { ok: false, message: '直线请用倍数缩放，比如"放大一倍"' }
    }
    // 首次缩放时把变换原点移到线段包围盒中心（位置补偿，视觉不变），
    // 之后通过 scale 缩放，points 始终保持创建时的原始值
    if (!node.offsetX() && !node.offsetY()) {
      const box = node.getSelfRect()
      const cx = box.x + box.width / 2
      const cy = box.y + box.height / 2
      node.offset({ x: cx, y: cy })
      node.move({ x: cx, y: cy })
    }
    const factor = cmd.scale ?? 1
    animateTo(node, {
      scaleX: (node.scaleX() || 1) * factor,
      scaleY: (node.scaleY() || 1) * factor,
    })
    return { ok: true, message: doneMessage }
  }

  return { ok: false, message: '该对象不支持缩放' }
}

function execStyle(cmd: StyleCommand): ExecResult {
  const matched = resolveTarget(cmd.target)
  if (!matched.length) return { ok: false, message: '没有找到要改颜色的对象' }

  const store = useObjectsStore()
  for (const obj of matched) {
    const node = findNode(obj.id)
    if (!node) continue
    // 直线/文字只有单一着色通道，填充图形描边同步换色
    const attrs: Record<string, string> =
      node instanceof Konva.Line
        ? { stroke: cmd.color }
        : node instanceof Konva.Text
          ? { fill: cmd.color }
          : { fill: cmd.color, stroke: cmd.color }
    animateTo(node, attrs)
    store.updateColor(obj.id, cmd.color)
  }

  if (matched.length === 1) return { ok: true, message: `已为${describe(matched[0])}换色` }
  return { ok: true, message: `已为 ${matched.length} 个对象换色` }
}

function execExport(): ExecResult {
  const stage = getMainLayer().getStage()
  if (!stage) return { ok: false, message: '画布尚未就绪' }

  // 选中高亮属于交互反馈，不进入导出图
  const feedbackLayer = getFeedbackLayer()
  const wasVisible = feedbackLayer.visible()
  feedbackLayer.visible(false)
  const url = stage.toDataURL({ pixelRatio: 2, mimeType: 'image/png' })
  feedbackLayer.visible(wasVisible)

  const a = document.createElement('a')
  a.href = url
  a.download = `sonink-${Date.now()}.png`
  a.click()

  if (import.meta.env.DEV) {
    const hook = (window as unknown as Record<string, Record<string, unknown> | undefined>)
      .__sonink
    if (hook) hook.lastExport = url
  }
  return { ok: true, message: '已导出图片' }
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
    case 'resize':
      return execResize(cmd)
    case 'style':
      return execStyle(cmd)
    case 'delete':
      return execDelete(cmd)
    case 'clear':
      return execClear()
    case 'undo':
      return useHistoryStore().undo()
    case 'redo':
      return useHistoryStore().redo()
    case 'export':
      return execExport()
    case 'replay':
      return useHistoryStore().replay()
  }
}

/** 改变画布状态、需要进入撤销历史的指令（select 只改高亮，undo/redo 自身操作历史） */
function isMutating(cmd: DslCommand): boolean {
  return (
    cmd.action === 'draw' ||
    cmd.action === 'move' ||
    cmd.action === 'resize' ||
    cmd.action === 'style' ||
    cmd.action === 'delete' ||
    cmd.action === 'clear'
  )
}

/**
 * 顺序执行指令序列（复合指令拆解结果），返回合并反馈。
 *
 * 整个序列是一个撤销事务：执行前抓取快照，全部成功且状态有变则提交历史
 * （复合指令一次"撤销"整体回退）；中途失败则恢复快照，已执行的部分回滚，
 * 画布不会停在半完成状态。
 */
export function executeAll(commands: DslCommand[]): ExecResult {
  const before = commands.some(isMutating) ? captureSnapshot() : null

  const messages: string[] = []
  for (const cmd of commands) {
    const result = execute(cmd)
    if (!result.ok) {
      if (before && messages.length > 0) {
        restoreSnapshot(before)
        return { ok: false, message: `${result.message}（复合指令已整体回滚）` }
      }
      return result
    }
    messages.push(result.message)
  }

  if (before && snapshotChanged(before)) useHistoryStore().commit(before)
  return { ok: true, message: messages.join('，') }
}
