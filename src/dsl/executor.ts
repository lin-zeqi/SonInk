import Konva from 'konva'
import { getMainLayer, getCanvasSize } from '../canvas/stage'
import { useObjectsStore } from '../store/objects'
import {
  SHAPE_LABELS,
  type DslCommand,
  type DrawCommand,
  type ExecResult,
  type SemanticPosition,
  type SemanticSize,
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

  switch (cmd.shape) {
    case 'circle':
      return new Konva.Circle({ id, x, y, radius: r, fill: color })
    case 'rect':
      return new Konva.Rect({
        id,
        x: x - r,
        y: y - r,
        width: r * 2,
        height: r * 2,
        fill: color,
      })
    case 'triangle':
      return new Konva.RegularPolygon({ id, x, y, sides: 3, radius: r, fill: color })
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

function execDraw(cmd: DrawCommand): ExecResult {
  const id = `obj-${nextId++}`
  const node = createNode(cmd, id)
  getMainLayer().add(node)
  useObjectsStore().register({
    id,
    shape: cmd.shape,
    color: cmd.props?.color ?? DEFAULT_COLOR,
  })
  return { ok: true, message: `已画一个${SHAPE_LABELS[cmd.shape]}` }
}

function execClear(): ExecResult {
  getMainLayer().destroyChildren()
  useObjectsStore().clear()
  return { ok: true, message: '已清空画布' }
}

export function execute(cmd: DslCommand): ExecResult {
  switch (cmd.action) {
    case 'draw':
      return execDraw(cmd)
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
