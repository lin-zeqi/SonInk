/**
 * 绘图 DSL —— 解析层（规则引擎 / LLM）与执行引擎之间的唯一契约。
 *
 * 设计约束（docs/design.md §3.3）：
 * - 位置与大小支持语义值，由执行层结合画布尺寸换算为像素；
 * - 解析层禁止输出绝对坐标。
 */

export type ShapeType = 'circle' | 'rect' | 'triangle' | 'line'

export type SemanticSize = 'small' | 'medium' | 'large'

/** 九宫格语义位置 */
export type SemanticPosition =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'center'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right'

export interface DrawProps {
  /** 十六进制颜色，省略时使用默认色 */
  color?: string
  /** 语义大小，或绝对像素值（圆=半径，方/三角=外接半径） */
  size?: SemanticSize | number
  /** 省略时默认画布中心附近随机偏移，避免重叠 */
  position?: SemanticPosition
}

export interface DrawCommand {
  action: 'draw'
  shape: ShapeType
  props?: DrawProps
}

export interface ClearCommand {
  action: 'clear'
}

export type DslCommand = DrawCommand | ClearCommand

/** 执行结果，message 供 TTS 播报与字幕反馈 */
export interface ExecResult {
  ok: boolean
  message: string
}

export const SHAPE_TYPES: readonly ShapeType[] = ['circle', 'rect', 'triangle', 'line']

export const SEMANTIC_SIZES: readonly SemanticSize[] = ['small', 'medium', 'large']

export const SEMANTIC_POSITIONS: readonly SemanticPosition[] = [
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
]

export const SHAPE_LABELS: Record<ShapeType, string> = {
  circle: '圆形',
  rect: '矩形',
  triangle: '三角形',
  line: '直线',
}
