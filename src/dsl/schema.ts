import {
  SHAPE_TYPES,
  SEMANTIC_SIZES,
  SEMANTIC_POSITIONS,
  type DslCommand,
  type DrawProps,
} from './types'

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

function validateProps(v: unknown): { ok: true; props: DrawProps } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, props: {} }
  if (!isRecord(v)) return { ok: false, error: 'props 必须是对象' }

  const props: DrawProps = {}

  if (v.color !== undefined) {
    if (typeof v.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(v.color)) {
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
    if (!SEMANTIC_POSITIONS.includes(v.position as never)) {
      return { ok: false, error: `非法位置: ${String(v.position)}` }
    }
    props.position = v.position as DrawProps['position']
  }

  return { ok: true, props }
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
    case 'clear':
      return { ok: true, command: { action: 'clear' } }
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
