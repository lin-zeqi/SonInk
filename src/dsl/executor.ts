import Konva from 'konva'
import { getMainLayer, getBackgroundLayer, getFeedbackLayer, getCanvasSize } from '../canvas/stage'
import { revealShape, revealStrokes } from '../canvas/draw-animation'
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
  type ComparisonQualifier,
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
  type ShapeType,
  type SpatialQualifier,
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
  small: 0.07,
  medium: 0.13,
  large: 0.20,
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
      node.offsetX(node.width() / 2)
      node.offsetY(node.height() / 2)
      return node
    }
    case 'path': {
      const { width, height } = getCanvasSize()
      const pts = cmd.props?.points
      const flat: number[] = []
      for (const p of pts!) {
        flat.push(width * p.fx, height * p.fy)
      }
      const close = cmd.props?.close ?? false
      // 闭合路径默认用 color 填充，也可用 fill 单独指定
      const fillColor = cmd.props?.fill ?? (close ? color : undefined)
      return new Konva.Line({
        id,
        points: flat,
        stroke: color,
        strokeWidth: 3,
        lineCap: 'round',
        lineJoin: 'round',
        closed: close,
        fill: fillColor,
        draggable: true,
      })
    }
  }
}

/**
 * 指代消解（P0 范围，docs/design.md §3.3）。
 * - 空 target：当前选中，否则最近对象；
 * - ref last：最近对象；ref selected：当前选中（无选中则退化为最近对象）；
 * - 特征匹配：shape/color 过滤全部对象；若有选中且选中与匹配集有交集，
 *   优先取交集（"选中红圆"后说"删掉这个圆"应只作用于选中者）；
 * - ref last + 特征同时存在时取匹配集中最近的一个（"刚才那个圆"）；
 * - groupName：匹配同名组（取最近创建的同名组全部对象），
 *   结合 part 可进一步过滤（"删掉房子的屋顶"）。
 */
function resolveTarget(target: TargetSpec | undefined): CanvasObject[] {
  const store = useObjectsStore()
  const all = store.objects
  const selected = store.selectedObjects

  const hasFeature = target?.shape !== undefined || target?.color !== undefined

  // groupName 优先：取最近创建的同名组（"把这个人变小" → 找到最近"人"组的所有图形）
  if (target?.groupName) {
    const groupObjects = all.filter((o) => o.groupName === target.groupName)
    if (!groupObjects.length) return applyPostFilter([], target)
    // 取最近出现的 groupId
    const latestGroupId = groupObjects[groupObjects.length - 1].groupId
    let matched = all.filter((o) => o.groupId === latestGroupId)
    // part 细粒度过滤："删掉房子的屋顶" → groupName="房子" + part="屋顶"
    if (target.part) {
      matched = matched.filter((o) => o.part === target.part)
      if (!matched.length) return applyPostFilter([], target)
    }
    return applyPostFilter(matched, target)
  }

  if (!target || (target.ref === undefined && !hasFeature)) {
    const matched = selected.length ? selected : all.slice(-1)
    return applyPostFilter(matched, target)
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
    if (target.ref === 'last' && matched.length > 1) matched = matched.slice(-1)
    return applyPostFilter(matched, target)
  }

  if (target.ref === 'last') return applyPostFilter(all.slice(-1), target)
  const matched = selected.length ? selected : all.slice(-1)
  return applyPostFilter(matched, target)
}

/**
 * 后过滤器：在特征匹配（shape/color/groupName）完成后，
 * 按空间/序数/比较限定词将匹配集收窄为单个元素。
 */
function applyPostFilter(matched: CanvasObject[], target: TargetSpec | undefined): CanvasObject[] {
  if (!target) return matched
  // 如果用户明确用了代词（它/这个/那个），空间/序数/比较限定词
  // 此时是其他用途（如移动目标位置），不做后过滤
  if (target.ref) return matched

  // 当目标集太小（≤1）但有限定词时，扩展到全部对象再做过滤——
  // resolveTarget 的空 target 分支只返回 selected/last 单对象，"选中左边那个"
  // 需要在全部对象中找最左。
  if (matched.length <= 1 && (target.spatial || target.ordinal !== undefined || target.comparison)) {
    const all = useObjectsStore().objects
    if (all.length > matched.length) matched = [...all]
  }
  if (matched.length <= 1) return matched

  if (target.spatial) {
    matched = applySpatialFilter(matched, target.spatial)
  }
  if (target.ordinal !== undefined && matched.length > 1) {
    matched = applyOrdinalFilter(matched, target.ordinal)
  }
  if (target.comparison && matched.length > 1) {
    matched = applyComparisonFilter(matched, target.comparison)
  }

  return matched
}

/** 空间过滤：按包围盒中心位置选出最极端的对象 */
function applySpatialFilter(matched: CanvasObject[], qualifier: SpatialQualifier): CanvasObject[] {
  const { width, height } = getCanvasSize()

  type Scored = { obj: CanvasObject; score: number }
  const scored: Scored[] = []

  for (const obj of matched) {
    const node = findNode(obj.id)
    if (!node) continue
    const box = node.getClientRect()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    let score: number
    switch (qualifier) {
      case 'leftmost':
        score = -cx
        break
      case 'rightmost':
        score = cx
        break
      case 'topmost':
        score = -cy
        break
      case 'bottommost':
        score = cy
        break
      case 'center':
        score = -Math.hypot(cx - width / 2, cy - height / 2)
        break
      default:
        return matched
    }
    scored.push({ obj, score })
  }

  if (!scored.length) return []
  scored.sort((a, b) => b.score - a.score)
  return [scored[0].obj]
}

/** 序数过滤："第一个" = seq 最小（最早创建），n 从 1 开始 */
function applyOrdinalFilter(matched: CanvasObject[], n: number): CanvasObject[] {
  const sorted = [...matched].sort((a, b) => a.seq - b.seq)
  if (n < 1 || n > sorted.length) return []
  return [sorted[n - 1]]
}

/** 比较过滤："最大的"/"最小的"按包围盒面积排序 */
function applyComparisonFilter(matched: CanvasObject[], qualifier: ComparisonQualifier): CanvasObject[] {
  type Scored = { obj: CanvasObject; area: number }
  const scored: Scored[] = []

  for (const obj of matched) {
    const node = findNode(obj.id)
    if (!node) continue
    const box = node.getClientRect()
    scored.push({ obj, area: box.width * box.height })
  }

  if (!scored.length) return []
  scored.sort((a, b) => qualifier === 'largest' ? b.area - a.area : a.area - b.area)
  return [scored[0].obj]
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
  // between：双锚点中点
  if (rel.relation === 'between') {
    const anchor1 = findAnchor(rel.shape, rel.color, rel.groupName)
    const anchor2 = findAnchor(rel.shape2, rel.color2, rel.groupName2)
    if (!anchor1 || !anchor2) {
      const desc1 = describeAnchor(rel.shape, rel.color, rel.groupName)
      const desc2 = describeAnchor(rel.shape2, rel.color2, rel.groupName2)
      const missing = !anchor1 ? desc1 : desc2
      return { ok: false, message: `画布上没找到要参照的${missing}` }
    }
    const box1 = anchor1.getClientRect()
    const box2 = anchor2.getClientRect()
    const cx = ((box1.x + box1.width / 2) + (box2.x + box2.width / 2)) / 2
    const cy = ((box1.y + box1.height / 2) + (box2.y + box2.height / 2)) / 2
    const { width, height } = getCanvasSize()
    const clamp = (v: number) => Math.min(0.98, Math.max(0.02, v))
    return { ok: true, position: { fx: clamp(cx / width), fy: clamp(cy / height) } }
  }

  const anchor = findAnchor(rel.shape, rel.color, rel.groupName)
  if (!anchor) {
    const desc = describeAnchor(rel.shape, rel.color, rel.groupName)
    return { ok: false, message: `画布上没找到要参照的${desc}` }
  }

  const box = anchor.getClientRect()
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

/** 按特征查找锚点 Konva 节点（多个匹配取最近创建的） */
function findAnchor(
  shape: ShapeType | undefined,
  color: string | undefined,
  groupName: string | undefined
): Konva.Shape | null {
  const matched = useObjectsStore().objects.filter(
    (o) =>
      (shape === undefined || o.shape === shape) &&
      (color === undefined || o.color === color) &&
      (groupName === undefined || o.groupName === groupName)
  )
  const obj = matched[matched.length - 1]
  return obj ? findNode(obj.id) : null
}

/** 锚点描述文本（报错用） */
function describeAnchor(
  shape: ShapeType | undefined,
  _color: string | undefined,
  groupName: string | undefined
): string {
  if (groupName) return groupName
  if (shape) return SHAPE_LABELS[shape]
  return '对象'
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

  if (cmd.shape === 'path') {
    // path 节点先加入画布但不播放动画——逐笔描画由 executeAll 统一调度
    // 预置隐藏态，等待 revealStrokes 按序显现
    useObjectsStore().register({
      id: node.id(),
      shape: 'path',
      color,
      groupId: cmd.props?.groupId,
      groupName: cmd.props?.groupName,
      part: cmd.props?.part,
    })
    return { ok: true, message: '' }
  }

  // 基础图形（圆/方/三角/直线/文字）：立即播放原有渐进绘制动画
  revealShape(node, cmd.shape === 'line' ? null : color)
  useObjectsStore().register({
    id: node.id(),
    shape: cmd.shape,
    color,
    groupId: cmd.props?.groupId,
    groupName: cmd.props?.groupName,
    part: cmd.props?.part,
  })
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

  const { width, height } = getCanvasSize()

  // 相对已有对象定位（"放在汽车正下方"）
  if (cmd.relativeTo) {
    const resolved = resolveRelativePosition(cmd.relativeTo, 0)
    if (!resolved.ok) return resolved
    const targetX = width * resolved.position.fx
    const targetY = height * resolved.position.fy

    // 计算目标对象的当前包围盒中心
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const obj of matched) {
      const node = findNode(obj.id)
      if (!node) continue
      const box = node.getClientRect()
      minX = Math.min(minX, box.x)
      minY = Math.min(minY, box.y)
      maxX = Math.max(maxX, box.x + box.width)
      maxY = Math.max(maxY, box.y + box.height)
    }
    const currentCx = (minX + maxX) / 2
    const currentCy = (minY + maxY) / 2
    const dx = targetX - currentCx
    const dy = targetY - currentCy

    for (const obj of matched) {
      const node = findNode(obj.id)
      if (node) animateTo(node, { x: node.x() + dx, y: node.y() + dy })
    }
    const relLabels: Record<string, string> = { 'left-of': '左侧', 'right-of': '右侧', above: '上方', below: '下方' }
    const relLabel = relLabels[cmd.relativeTo.relation] ?? cmd.relativeTo.relation
    return { ok: true, message: `已移到锚点${relLabel}` }
  }

  // 组移动或批量移动（"把太阳移到左边" → 移动太阳组全部图形）
  if (matched.length > 1) {
    // 计算组的包围盒中心作为参考点
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const obj of matched) {
      const node = findNode(obj.id)
      if (!node) continue
      const box = node.getClientRect()
      minX = Math.min(minX, box.x)
      minY = Math.min(minY, box.y)
      maxX = Math.max(maxX, box.x + box.width)
      maxY = Math.max(maxY, box.y + box.height)
    }
    const groupCx = (minX + maxX) / 2
    const groupCy = (minY + maxY) / 2

    if (cmd.position) {
      const [fx, fy] = POSITION_FRACTIONS[cmd.position]
      const dx = width * fx - groupCx
      const dy = height * fy - groupCy
      for (const obj of matched) {
        const node = findNode(obj.id)
        if (node) animateTo(node, { x: node.x() + dx, y: node.y() + dy })
      }
      return { ok: true, message: `已移动到${POSITION_LABELS[cmd.position]}` }
    }

    const direction = cmd.direction ?? 'right'
    const distance =
      typeof cmd.distance === 'number'
        ? cmd.distance
        : Math.min(width, height) * MOVE_FRACTIONS[cmd.distance ?? 'medium']
    const [vx, vy] = DIRECTION_VECTORS[direction]
    for (const obj of matched) {
      const node = findNode(obj.id)
      if (node) animateTo(node, { x: node.x() + vx * distance, y: node.y() + vy * distance })
    }
    return { ok: true, message: `已向${DIRECTION_LABELS[direction]}移动` }
  }

  const node = findNode(matched[0].id)
  if (!node) return { ok: false, message: '对象状态异常，请重试' }

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

  const doneMessage =
    cmd.size !== undefined ? '已调整大小' : (cmd.scale ?? 1) > 1 ? '已放大' : '已缩小'

  // 组缩放或批量缩放（"把这个人变小" → 缩放人组全部图形）
  for (const obj of matched) {
    const result = resizeOne(obj, cmd)
    if (!result.ok) return result
  }
  if (matched.length === 1) return { ok: true, message: doneMessage }
  return { ok: true, message: `${doneMessage}（${matched.length} 个对象）` }
}

/** 对单个对象执行缩放 */
function resizeOne(obj: CanvasObject, cmd: ResizeCommand): ExecResult {
  const node = findNode(obj.id)
  if (!node) return { ok: false, message: '对象状态异常，请重试' }

  if (node instanceof Konva.Circle || node instanceof Konva.RegularPolygon) {
    const r = node.radius()
    const target = Math.max(cmd.size ?? r * (cmd.scale ?? 1), MIN_RADIUS)
    animateTo(node, { radius: target })
    return { ok: true, message: '' }
  }

  if (node instanceof Konva.Rect) {
    const w = node.width()
    const factor = cmd.size !== undefined ? (cmd.size * 2) / w : (cmd.scale ?? 1)
    const newW = Math.max(w * factor, MIN_RADIUS * 2)
    const newH = Math.max(node.height() * factor, MIN_RADIUS * 2)
    animateTo(node, {
      x: node.x() - (newW - w) / 2,
      y: node.y() - (newH - node.height()) / 2,
      width: newW,
      height: newH,
    })
    return { ok: true, message: '' }
  }

  if (node instanceof Konva.Line) {
    if (cmd.size !== undefined) {
      return { ok: false, message: '直线请用倍数缩放，比如"放大一倍"' }
    }
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
    return { ok: true, message: '' }
  }

  if (node instanceof Konva.Text) {
    const currentSize = node.fontSize()
    const target = Math.max(cmd.size ?? currentSize * (cmd.scale ?? 1), MIN_RADIUS)
    getFeedbackLayer().destroyChildren()
    setPendingAttrs(node.id(), { fontSize: target })
    node.to({
      fontSize: target,
      duration: TRANSITION_DURATION,
      easing: Konva.Easings.EaseInOut,
      onFinish: () => {
        clearPendingAttrs(node.id())
        node.offsetX(node.width() / 2)
        node.offsetY(node.height() / 2)
        syncHighlight()
      },
    })
    return { ok: true, message: '' }
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
  let partLabel = ''
  if (cmd.target?.groupName && cmd.target?.part && matched.length === 1) {
    partLabel = `的${cmd.target.part}`
  }
  for (const obj of matched) {
    findNode(obj.id)?.destroy()
    store.remove(obj.id)
  }
  syncHighlight()

  if (matched.length === 1) return { ok: true, message: `已删除${describe(matched[0])}${partLabel}` }
  return { ok: true, message: `已删除 ${matched.length} 个对象${partLabel}` }
}

function execClear(): ExecResult {
  getBackgroundLayer().destroyChildren()
  getMainLayer().destroyChildren()
  getFeedbackLayer().destroyChildren()
  useObjectsStore().clear()
  return { ok: true, message: '已清空画布' }
}

function execBackground(cmd: { action: 'background'; color: string }): ExecResult {
  const layer = getBackgroundLayer()
  const { width, height } = getCanvasSize()
  layer.destroyChildren()
  layer.add(new Konva.Rect({
    id: 'bg',
    x: 0,
    y: 0,
    width,
    height,
    fill: cmd.color,
    listening: false,
  }))
  return { ok: true, message: `已设置背景色` }
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
    case 'background':
      return execBackground(cmd)
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
    cmd.action === 'clear' ||
    cmd.action === 'background'
  )
}

/**
 * 自动位置收紧：LLM 没有空间推理能力，输出的 fx/fy 坐标往往撒得太开。
 * 本函数检测本批次中所有 draw 指令的横向跨度，若超过画布 35% 则整体
 * 向中心压缩到 30%——保持内部相对比例不变，只改变整体密度。
 * 仅处理显式 fx/fy 坐标；语义位置（九宫格）不走此逻辑。
 */
function autoCompact(commands: DslCommand[]): void {
  const draws: { cmd: DrawCommand; fx: number }[] = []
  for (const cmd of commands) {
    if (cmd.action === 'draw' && cmd.props?.position && typeof cmd.props.position === 'object') {
      draws.push({ cmd, fx: cmd.props.position.fx })
    }
  }
  if (draws.length < 2) return

  let minFx = Infinity
  let maxFx = -Infinity
  for (const { fx } of draws) {
    if (fx < minFx) minFx = fx
    if (fx > maxFx) maxFx = fx
  }

  const spread = maxFx - minFx
  if (spread <= 0.35) return // 已经很紧凑了

  const centerFx = (minFx + maxFx) / 2
  const scale = 0.30 / spread
  for (const { cmd } of draws) {
    const pos = cmd.props!.position as PositionFraction
    const newFx = centerFx + (pos.fx - centerFx) * scale
    cmd.props = { ...cmd.props!, position: { fx: newFx, fy: pos.fy } }
  }
}

/**
 * 顺序执行指令序列（复合指令拆解结果），返回合并反馈。
 *
 * 整个序列是一个撤销事务：执行前抓取快照，全部成功且状态有变则提交历史
 * （复合指令一次"撤销"整体回退）；中途失败则恢复快照，已执行的部分回滚，
 * 画布不会停在半完成状态。
 */
export function executeAll(commands: DslCommand[]): ExecResult {
  // 预扫描：为带 groupName 的 draw 指令自动分配 groupId
  // 同批次中同名 groupName 共享同一个 groupId，不同批次各自独立
  const groupMap = new Map<string, string>()
  let nextGroupId = 1
  for (const cmd of commands) {
    if (cmd.action === 'draw' && cmd.props?.groupName && !cmd.props.groupId) {
      const name = cmd.props.groupName
      if (!groupMap.has(name)) {
        groupMap.set(name, `group-${nextGroupId++}`)
      }
      cmd.props = { ...cmd.props, groupId: groupMap.get(name)! }
    }
  }

  // 自动收紧：如果本批次的 draw 指令间距过大，整体压缩到紧凑范围
  autoCompact(commands)

  const before = commands.some(isMutating) ? captureSnapshot() : null

  // 记录执行前的节点数，用于收集本批次新增的 path 节点做逐笔描画
  const nodeCountBefore = getMainLayer().getChildren().length

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
    if (result.message) messages.push(result.message)
  }

  // 逐笔描画：收集本批次新增的 path 节点，按创建顺序依次显现
  const allNewNodes = getMainLayer().getChildren().slice(nodeCountBefore)
  const pathNodes: Konva.Shape[] = []
  for (const n of allNewNodes) {
    if (!(n instanceof Konva.Shape)) continue
    const obj = useObjectsStore().objects.find((o) => o.id === String(n.id()))
    if (obj?.shape === 'path') pathNodes.push(n)
  }
  if (pathNodes.length > 0) {
    revealStrokes(pathNodes, { baseInterval: 400, jitter: 80 })
  }

  if (before && snapshotChanged(before)) useHistoryStore().commit(before)
  return { ok: true, message: messages.join('，') || '已开始描画...' }
}
