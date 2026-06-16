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

/**
 * 画布比例坐标（0~1，fx 横向、fy 纵向）。
 * 九宫格粒度不足以摆放组合图形（LLM 拆解"画一个人"等场景），
 * 比例坐标分辨率无关、不给 LLM 像素幻觉空间——像素坐标仍然禁止。
 */
export interface PositionFraction {
  fx: number
  fy: number
}

export interface DrawProps {
  /** 十六进制颜色，省略时使用默认色 */
  color?: string
  /** 语义大小，或绝对像素值（圆=半径，方/三角=外接半径） */
  size?: SemanticSize | number
  /** 省略时默认画布中心附近随机偏移，避免重叠 */
  position?: SemanticPosition | PositionFraction
  /** 仅直线有效：起止点比例坐标，缺省时画水平线 */
  from?: PositionFraction
  to?: PositionFraction
}

export interface DrawCommand {
  action: 'draw'
  shape: ShapeType
  props?: DrawProps
}

/**
 * 对象目标描述（指代消解的输入）。
 * P0 范围：ref 指代（"刚才那个"=last，"它/这个"=selected）与单特征匹配（颜色+图形）。
 * 空 target 表示"当前选中，否则最近对象"。
 */
export interface TargetSpec {
  ref?: 'last' | 'selected'
  shape?: ShapeType
  color?: string
}

export interface SelectCommand {
  action: 'select'
  target: TargetSpec
}

export type Direction = 'left' | 'right' | 'up' | 'down'

/** 语义步长或绝对像素 */
export type MoveDistance = 'small' | 'medium' | 'large' | number

export interface MoveCommand {
  action: 'move'
  target?: TargetSpec
  /** 相对移动：方向 + 步长 */
  direction?: Direction
  distance?: MoveDistance
  /** 绝对移动：九宫格目标位置（与 direction 二选一） */
  position?: SemanticPosition
}

export interface DeleteCommand {
  action: 'delete'
  target?: TargetSpec
}

export interface ClearCommand {
  action: 'clear'
}

export type DslCommand =
  | DrawCommand
  | SelectCommand
  | MoveCommand
  | DeleteCommand
  | ClearCommand

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

export const DIRECTIONS: readonly Direction[] = ['left', 'right', 'up', 'down']

export const SHAPE_LABELS: Record<ShapeType, string> = {
  circle: '圆形',
  rect: '矩形',
  triangle: '三角形',
  line: '直线',
}

export const POSITION_LABELS: Record<SemanticPosition, string> = {
  'top-left': '左上角',
  top: '上方',
  'top-right': '右上角',
  left: '左边',
  center: '中间',
  right: '右边',
  'bottom-left': '左下角',
  bottom: '下方',
  'bottom-right': '右下角',
}

export const DIRECTION_LABELS: Record<Direction, string> = {
  left: '左',
  right: '右',
  up: '上',
  down: '下',
}
