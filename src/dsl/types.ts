/**
 * 绘图 DSL —— 解析层（规则引擎 / LLM）与执行引擎之间的唯一契约。
 *
 * 设计约束（docs/design.md §3.3）：
 * - 位置与大小支持语义值，由执行层结合画布尺寸换算为像素；
 * - 解析层禁止输出绝对坐标。
 */

export type ShapeType = 'circle' | 'rect' | 'triangle' | 'line' | 'text' | 'path'

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

/**
 * 路径描画点：连续点连成折线，勾勒出任意形状的轮廓。
 * LLM 不需要理解"圆"、"方"——只需要输出一组首尾相接的坐标点序列。
 */
export interface PathPoint {
  fx: number
  fy: number
}

/** 空间限定："左边那个"/"最上面那个"/"中间那个" */
export type SpatialQualifier = 'leftmost' | 'rightmost' | 'topmost' | 'bottommost' | 'center'

/** 比较限定："最大的那个"/"最小的那个"（按包围盒面积） */
export type ComparisonQualifier = 'largest' | 'smallest'

/** 相对已有对象的方位关系 */
export type RelativeRelation = 'left-of' | 'right-of' | 'above' | 'below' | 'between'

/**
 * 相对定位锚点（"在圆的右边画一个方形"）。
 * 按特征匹配已有对象，坐标计算全部由执行层完成（design.md §3.3）。
 */
export interface RelativeTo {
  shape?: ShapeType
  color?: string
  /** 按组合对象名匹配锚点（如 LLM 创建的"汽车"、"马路"） */
  groupName?: string
  relation: RelativeRelation
  /** between 第二锚点特征 */
  shape2?: ShapeType
  color2?: string
  groupName2?: string
}

export interface DrawProps {
  /** 十六进制颜色，省略时使用默认色 */
  color?: string
  /** 语义大小，或绝对像素值（圆=半径，方/三角=外接半径） */
  size?: SemanticSize | number
  /** 省略时默认画布中心附近随机偏移，避免重叠 */
  position?: SemanticPosition | PositionFraction
  /** 相对已有对象定位，优先级高于 position */
  relativeTo?: RelativeTo
  /** 仅直线有效：起止点比例坐标，缺省时画水平线 */
  from?: PositionFraction
  to?: PositionFraction
  /** 仅 shape=text 有效：标注内容 */
  text?: string
  /** 组合对象名（如"人"、"房子"），同组图形可整体选中/移动/缩放/删除 */
  groupName?: string
  /** 部件角色（如"头"、"屋顶"、"左腿"），用于细粒度指代 */
  part?: string
  /** 组合 ID（由执行引擎自动分配，LLM 与规则引擎不填） */
  groupId?: string
  /** 仅 shape=path 有效：连续坐标点序列，引擎自动连成折线 */
  points?: PathPoint[]
  /** 仅 shape=path 有效：填充色（闭合轮廓建议填色），省略时默认与 color 相同 */
  fill?: string
  /** 仅 shape=path 有效：是否闭合路径（连接终点回起点） */
  close?: boolean
  /** 仅 shape=path 有效：曲线平滑度 0~1（0=直角折线，0.3~0.5=圆润曲线）。
   *  用更少的点画出平滑形体（头、车轮、云、花瓣等），省略时默认 0 */
  tension?: number
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
 * groupName：按组合对象名匹配（"把这个人变小" → groupName: "人"）。
 * part：按部件角色匹配（"删掉房子的屋顶" → groupName: "房子" + part: "屋顶"）。
 */
export interface TargetSpec {
  ref?: 'last' | 'selected'
  shape?: ShapeType
  color?: string
  /** 按组合对象名匹配（取最近创建的同名组） */
  groupName?: string
  /** 按部件角色匹配 */
  part?: string
  /** 空间限定："左边那个"/"最上面那个"/"中间那个" */
  spatial?: SpatialQualifier
  /** 序数："第二个"（从 1 开始，按 seq 创建顺序） */
  ordinal?: number
  /** 比较限定："最大的那个"/"最小的那个"（按包围盒面积） */
  comparison?: ComparisonQualifier
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
  /** 相对已有对象定位（"放在汽车正下方"），优先级高于 direction */
  relativeTo?: RelativeTo
}

export interface ResizeCommand {
  action: 'resize'
  target?: TargetSpec
  /** 相对缩放倍数（>1 放大，<1 缩小），与 size 二选一 */
  scale?: number
  /** 绝对大小：目标半径像素（圆=半径，方/三角=外接半径；直线不适用） */
  size?: number
}

export interface DeleteCommand {
  action: 'delete'
  target?: TargetSpec
}

export interface ClearCommand {
  action: 'clear'
}

/** 修改已有对象颜色（"把这个圆变成蓝色"） */
export interface StyleCommand {
  action: 'style'
  target?: TargetSpec
  color: string
}

/** 导出画布为 PNG */
export interface ExportCommand {
  action: 'export'
}

/** 设置画布背景色（位于所有图形下方，不遮挡已有图形） */
export interface BackgroundCommand {
  action: 'background'
  color: string
}

/** 按时间顺序回放绘图过程（快照时间线） */
export interface ReplayCommand {
  action: 'replay'
}

/** 撤销上一次变更（复合指令作为一个事务整体撤销） */
export interface UndoCommand {
  action: 'undo'
}

export interface RedoCommand {
  action: 'redo'
}

/**
 * 从部件目录"下单"放置一个语义对象（LLM 排版器路径，feat/17）。
 * LLM 对已知对象只需给出 asset id + 摆放参数，执行前由 executeAll 展开成
 * 多条带 groupName/part 的 path draw——画面质量由预制美术兜底，且天然可编辑。
 */
export interface PlaceCommand {
  action: 'place'
  /** 部件目录中的资产 id（见 parser/templates.ts ASSETS） */
  asset: string
  /** 摆放中心，九宫格语义值或 0~1 比例坐标，省略时画布中心 */
  position?: SemanticPosition | PositionFraction
  /** 语义大小，省略时 medium */
  size?: SemanticSize
  /** 可选整体着色（覆盖资产默认配色，主要用于单色资产如火柴人） */
  color?: string
}

export type DslCommand =
  | DrawCommand
  | SelectCommand
  | MoveCommand
  | ResizeCommand
  | StyleCommand
  | DeleteCommand
  | ClearCommand
  | UndoCommand
  | RedoCommand
  | BackgroundCommand
  | ExportCommand
  | ReplayCommand
  | PlaceCommand

/** 执行结果，message 供 TTS 播报与字幕反馈 */
export interface ExecResult {
  ok: boolean
  message: string
}

export const SHAPE_TYPES: readonly ShapeType[] = ['circle', 'rect', 'triangle', 'line', 'text', 'path']

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

export const RELATIVE_RELATIONS: readonly RelativeRelation[] = [
  'left-of',
  'right-of',
  'above',
  'below',
  'between',
]

export const SHAPE_LABELS: Record<ShapeType, string> = {
  circle: '圆形',
  rect: '矩形',
  triangle: '三角形',
  line: '直线',
  text: '文字',
  path: '路径',
}

/** 九宫格 → 画布比例坐标（执行层换算与模板展开共用） */
export const POSITION_FRACTIONS: Record<SemanticPosition, [number, number]> = {
  'top-left': [0.33, 0.28],
  top: [0.5, 0.28],
  'top-right': [0.67, 0.28],
  left: [0.33, 0.5],
  center: [0.5, 0.5],
  right: [0.67, 0.5],
  'bottom-left': [0.33, 0.72],
  bottom: [0.5, 0.72],
  'bottom-right': [0.67, 0.72],
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
