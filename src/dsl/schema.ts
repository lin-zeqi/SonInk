import {
  DIRECTIONS,
  SHAPE_TYPES,
  SEMANTIC_SIZES,
  SEMANTIC_POSITIONS,
  type DslCommand,
  type DrawProps,
  type PositionFraction,
  type TargetSpec,
} from './types'

const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/

/**
 * DSL 运行时校验。
 * TS 类型只约束项目内部代码；LLM 输出与调试 JSON 来自运行时边界之外，
 * 必须经过本模块校验后才能进入执行引擎。
 */

export type ValidationResult =
  | { ok: true; commands: DslCommand[] }
  | { ok: false; error: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isFraction(v: unknown): v is PositionFraction {
  return (
    isRecord(v) &&
    typeof v.fx === 'number' &&
    typeof v.fy === 'number' &&
    v.fx >= 0 &&
    v.fx <= 1 &&
    v.fy >= 0 &&
    v.fy <= 1
  )
}

function validateProps(v: unknown): { ok: true; props: DrawProps } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, props: {} }
  if (!isRecord(v)) return { ok: false, error: 'props 必须是对象' }

  const props: DrawProps = {}

  if (v.color !== undefined) {
    if (typeof v.color !== 'string' || !HEX_COLOR.test(v.color)) {
      return { ok: false, error: `非法颜色值: ${String(v.color)}` }
    }
    props.color = v.color
  }

  if (v.size !== undefined) {
    if (typeof v.size === 'number') {
      if (v.size <= 0 || !Number.isFinite(v.size)) {
        return { ok: false, error: `非法大小: ${String(v.size)}` }
      }
      props.size = v.size
    } else if (SEMANTIC_SIZES.includes(v.size as never)) {
      props.size = v.size as DrawProps['size']
    } else {
      return { ok: false, error: `非法大小: ${String(v.size)}` }
    }
  }

  if (v.position !== undefined) {
    if (typeof v.position === 'string') {
      if (!SEMANTIC_POSITIONS.includes(v.position as never)) {
        return { ok: false, error: `非法位置: ${String(v.position)}` }
      }
      props.position = v.position as DrawProps['position']
    } else if (isFraction(v.position)) {
      props.position = { fx: v.position.fx, fy: v.position.fy }
    } else {
      return { ok: false, error: '非法位置：需为九宫格语义值或 0~1 比例坐标 {fx, fy}' }
    }
  }

  for (const key of ['from', 'to'] as const) {
    if (v[key] !== undefined) {
      if (!isFraction(v[key])) {
        return { ok: false, error: `非法${key === 'from' ? '起点' : '终点'}：需为 0~1 比例坐标 {fx, fy}` }
      }
      props[key] = { fx: (v[key] as PositionFraction).fx, fy: (v[key] as PositionFraction).fy }
    }
  }

  return { ok: true, props }
}

function validateTarget(
  v: unknown
): { ok: true; target: TargetSpec | undefined } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, target: undefined }
  if (!isRecord(v)) return { ok: false, error: 'target 必须是对象' }

  const target: TargetSpec = {}
  if (v.ref !== undefined) {
    if (v.ref !== 'last' && v.ref !== 'selected') {
      return { ok: false, error: `非法指代: ${String(v.ref)}` }
    }
    target.ref = v.ref
  }
  if (v.shape !== undefined) {
    if (!SHAPE_TYPES.includes(v.shape as never)) {
      return { ok: false, error: `不支持的图形: ${String(v.shape)}` }
    }
    target.shape = v.shape as TargetSpec['shape']
  }
  if (v.color !== undefined) {
    if (typeof v.color !== 'string' || !HEX_COLOR.test(v.color)) {
      return { ok: false, error: `非法颜色值: ${String(v.color)}` }
    }
    target.color = v.color
  }
  return { ok: true, target }
}

function validateOne(v: unknown): { ok: true; command: DslCommand } | { ok: false; error: string } {
  if (!isRecord(v)) return { ok: false, error: '指令必须是对象' }

  switch (v.action) {
    case 'draw': {
      if (!SHAPE_TYPES.includes(v.shape as never)) {
        return { ok: false, error: `不支持的图形: ${String(v.shape)}` }
      }
      const propsResult = validateProps(v.props)
      if (!propsResult.ok) return propsResult
      return {
        ok: true,
        command: { action: 'draw', shape: v.shape as never, props: propsResult.props },
      }
    }
    case 'select': {
      const t = validateTarget(v.target)
      if (!t.ok) return t
      return { ok: true, command: { action: 'select', target: t.target ?? {} } }
    }
    case 'move': {
      const t = validateTarget(v.target)
      if (!t.ok) return t

      const hasDirection = v.direction !== undefined
      const hasPosition = v.position !== undefined
      if (!hasDirection && !hasPosition) {
        return { ok: false, error: '移动指令缺少方向或目标位置' }
      }
      if (hasDirection && !DIRECTIONS.includes(v.direction as never)) {
        return { ok: false, error: `非法方向: ${String(v.direction)}` }
      }
      if (hasPosition && !SEMANTIC_POSITIONS.includes(v.position as never)) {
        return { ok: false, error: `非法位置: ${String(v.position)}` }
      }

      let distance: number | 'small' | 'medium' | 'large' | undefined
      if (v.distance !== undefined) {
        if (typeof v.distance === 'number' && Number.isFinite(v.distance) && v.distance > 0) {
          distance = v.distance
        } else if (v.distance === 'small' || v.distance === 'medium' || v.distance === 'large') {
          distance = v.distance
        } else {
          return { ok: false, error: `非法步长: ${String(v.distance)}` }
        }
      }

      return {
        ok: true,
        command: {
          action: 'move',
          target: t.target,
          direction: hasDirection ? (v.direction as never) : undefined,
          position: hasPosition ? (v.position as never) : undefined,
          distance,
        },
      }
    }
    case 'delete': {
      const t = validateTarget(v.target)
      if (!t.ok) return t
      return { ok: true, command: { action: 'delete', target: t.target } }
    }
    case 'clear':
      return { ok: true, command: { action: 'clear' } }
    case 'undo':
      return { ok: true, command: { action: 'undo' } }
    case 'redo':
      return { ok: true, command: { action: 'redo' } }
    default:
      return { ok: false, error: `不支持的操作: ${String(v.action)}` }
  }
}

/** 校验单条指令或指令数组（复合指令拆解结果） */
export function validateDsl(value: unknown): ValidationResult {
  const list = Array.isArray(value) ? value : [value]
  if (list.length === 0) return { ok: false, error: '指令序列为空' }

  const commands: DslCommand[] = []
  for (const item of list) {
    const result = validateOne(item)
    if (!result.ok) return result
    commands.push(result.command)
  }
  return { ok: true, commands }
}
