import {
  DIRECTIONS,
  RELATIVE_RELATIONS,
  SHAPE_TYPES,
  SEMANTIC_SIZES,
  SEMANTIC_POSITIONS,
  type DslCommand,
  type DrawProps,
  type PathPoint,
  type PositionFraction,
  type RelativeTo,
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

  if (v.relativeTo !== undefined) {
    const r = v.relativeTo as Record<string, unknown>
    if (!isRecord(r) || !RELATIVE_RELATIONS.includes(r.relation as never)) {
      return { ok: false, error: `非法相对定位：relation 需为 ${RELATIVE_RELATIONS.join('/')}` }
    }
    const relativeTo: RelativeTo = { relation: r.relation as RelativeTo['relation'] }
    if (r.shape !== undefined) {
      if (!SHAPE_TYPES.includes(r.shape as never)) {
        return { ok: false, error: `非法锚点图形: ${String(r.shape)}` }
      }
      relativeTo.shape = r.shape as RelativeTo['shape']
    }
    if (r.color !== undefined) {
      if (typeof r.color !== 'string' || !HEX_COLOR.test(r.color)) {
        return { ok: false, error: `非法锚点颜色: ${String(r.color)}` }
      }
      relativeTo.color = r.color
    }
    if (r.groupName !== undefined) {
      if (typeof r.groupName !== 'string' || !r.groupName.trim()) {
        return { ok: false, error: '非法锚点 groupName' }
      }
      relativeTo.groupName = r.groupName.trim()
    }
    // 第二锚点（between）
    if (r.shape2 !== undefined) {
      if (!SHAPE_TYPES.includes(r.shape2 as never)) {
        return { ok: false, error: `非法第二锚点图形: ${String(r.shape2)}` }
      }
      relativeTo.shape2 = r.shape2 as RelativeTo['shape2']
    }
    if (r.color2 !== undefined) {
      if (typeof r.color2 !== 'string' || !HEX_COLOR.test(r.color2)) {
        return { ok: false, error: `非法第二锚点颜色: ${String(r.color2)}` }
      }
      relativeTo.color2 = r.color2
    }
    if (r.groupName2 !== undefined) {
      if (typeof r.groupName2 !== 'string' || !r.groupName2.trim()) {
        return { ok: false, error: '非法第二锚点 groupName2' }
      }
      relativeTo.groupName2 = r.groupName2.trim()
    }
    const hasAnchor1 = relativeTo.shape !== undefined || relativeTo.color !== undefined || relativeTo.groupName !== undefined
    const hasAnchor2 = relativeTo.shape2 !== undefined || relativeTo.color2 !== undefined || relativeTo.groupName2 !== undefined
    if (!hasAnchor1) {
      return { ok: false, error: '相对定位缺少锚点特征（shape/color/groupName）' }
    }
    if (relativeTo.relation === 'between' && !hasAnchor2) {
      return { ok: false, error: 'between 需要第二锚点特征（shape2/color2/groupName2）' }
    }
    props.relativeTo = relativeTo
  }

  for (const key of ['from', 'to'] as const) {
    if (v[key] !== undefined) {
      if (!isFraction(v[key])) {
        return { ok: false, error: `非法${key === 'from' ? '起点' : '终点'}：需为 0~1 比例坐标 {fx, fy}` }
      }
      props[key] = { fx: (v[key] as PositionFraction).fx, fy: (v[key] as PositionFraction).fy }
    }
  }

  if (v.text !== undefined) {
    if (typeof v.text !== 'string' || !v.text.trim()) {
      return { ok: false, error: '文本内容必须是非空字符串' }
    }
    props.text = v.text.trim()
  }

  if (v.groupName !== undefined) {
    if (typeof v.groupName !== 'string' || !v.groupName.trim()) {
      return { ok: false, error: 'groupName 必须是非空字符串' }
    }
    props.groupName = v.groupName.trim()
  }

  if (v.part !== undefined) {
    if (typeof v.part !== 'string' || !v.part.trim()) {
      return { ok: false, error: 'part 必须是非空字符串' }
    }
    props.part = v.part.trim()
  }

  if (v.points !== undefined) {
    if (!Array.isArray(v.points) || v.points.length < 2) {
      return { ok: false, error: '路径 points 需要至少 2 个坐标点' }
    }
    const pts: PathPoint[] = []
    for (const p of v.points) {
      if (!isFraction(p)) {
        return { ok: false, error: `非法坐标点: ${JSON.stringify(p)}` }
      }
      pts.push({ fx: (p as PositionFraction).fx, fy: (p as PositionFraction).fy })
    }
    props.points = pts
  }

  if (v.fill !== undefined) {
    if (typeof v.fill !== 'string' || !HEX_COLOR.test(v.fill)) {
      return { ok: false, error: `非法填充色: ${String(v.fill)}` }
    }
    props.fill = v.fill
  }

  if (v.close !== undefined) {
    props.close = Boolean(v.close)
  }

  if (v.tension !== undefined) {
    if (typeof v.tension !== 'number' || !Number.isFinite(v.tension) || v.tension < 0 || v.tension > 1) {
      return { ok: false, error: `非法曲线平滑度 tension（需 0~1）: ${String(v.tension)}` }
    }
    props.tension = v.tension
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
  if (v.groupName !== undefined) {
    if (typeof v.groupName !== 'string' || !v.groupName.trim()) {
      return { ok: false, error: 'groupName 必须是非空字符串' }
    }
    target.groupName = v.groupName.trim()
  }
  if (v.part !== undefined) {
    if (typeof v.part !== 'string' || !v.part.trim()) {
      return { ok: false, error: 'part 必须是非空字符串' }
    }
    target.part = v.part.trim()
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
      if (v.shape === 'text' && propsResult.props.text === undefined) {
        return { ok: false, error: '文字图形缺少 text 内容' }
      }
      if (v.shape === 'path' && propsResult.props.points === undefined) {
        return { ok: false, error: '路径图形缺少 points 坐标点序列' }
      }
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

      let relativeTo: RelativeTo | undefined
      if (v.relativeTo !== undefined) {
        const r = v.relativeTo as Record<string, unknown>
        if (!isRecord(r) || !RELATIVE_RELATIONS.includes(r.relation as never)) {
          return { ok: false, error: `非法相对定位：relation 需为 ${RELATIVE_RELATIONS.join('/')}` }
        }
        relativeTo = { relation: r.relation as RelativeTo['relation'] }
        if (r.shape !== undefined) {
          if (!SHAPE_TYPES.includes(r.shape as never)) {
            return { ok: false, error: `非法锚点图形: ${String(r.shape)}` }
          }
          relativeTo.shape = r.shape as RelativeTo['shape']
        }
        if (r.color !== undefined) {
          if (typeof r.color !== 'string' || !HEX_COLOR.test(r.color)) {
            return { ok: false, error: `非法锚点颜色: ${String(r.color)}` }
          }
          relativeTo.color = r.color
        }
        if (r.groupName !== undefined) {
          if (typeof r.groupName !== 'string' || !r.groupName.trim()) {
            return { ok: false, error: '非法锚点 groupName' }
          }
          relativeTo.groupName = r.groupName.trim()
        }
        if (r.shape2 !== undefined) {
          if (!SHAPE_TYPES.includes(r.shape2 as never)) {
            return { ok: false, error: `非法第二锚点图形: ${String(r.shape2)}` }
          }
          relativeTo.shape2 = r.shape2 as RelativeTo['shape2']
        }
        if (r.color2 !== undefined) {
          if (typeof r.color2 !== 'string' || !HEX_COLOR.test(r.color2)) {
            return { ok: false, error: `非法第二锚点颜色: ${String(r.color2)}` }
          }
          relativeTo.color2 = r.color2
        }
        if (r.groupName2 !== undefined) {
          if (typeof r.groupName2 !== 'string' || !r.groupName2.trim()) {
            return { ok: false, error: '非法第二锚点 groupName2' }
          }
          relativeTo.groupName2 = r.groupName2.trim()
        }
        const hasAnchor1 = relativeTo.shape !== undefined || relativeTo.color !== undefined || relativeTo.groupName !== undefined
        const hasAnchor2 = relativeTo.shape2 !== undefined || relativeTo.color2 !== undefined || relativeTo.groupName2 !== undefined
        if (!hasAnchor1) {
          return { ok: false, error: '相对定位缺少锚点特征（shape/color/groupName）' }
        }
        if (relativeTo.relation === 'between' && !hasAnchor2) {
          return { ok: false, error: 'between 需要第二锚点特征（shape2/color2/groupName2）' }
        }
      }

      const hasDirection = v.direction !== undefined
      const hasPosition = v.position !== undefined
      if (!hasDirection && !hasPosition && !relativeTo) {
        return { ok: false, error: '移动指令缺少方向、目标位置或锚点' }
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
          relativeTo,
        },
      }
    }
    case 'resize': {
      const t = validateTarget(v.target)
      if (!t.ok) return t

      let scale: number | undefined
      if (v.scale !== undefined) {
        if (typeof v.scale !== 'number' || !Number.isFinite(v.scale) || v.scale <= 0) {
          return { ok: false, error: `非法缩放倍数: ${String(v.scale)}` }
        }
        scale = v.scale
      }
      let size: number | undefined
      if (v.size !== undefined) {
        if (typeof v.size !== 'number' || !Number.isFinite(v.size) || v.size <= 0) {
          return { ok: false, error: `非法大小: ${String(v.size)}` }
        }
        size = v.size
      }
      if (scale === undefined && size === undefined) {
        return { ok: false, error: '缩放指令缺少倍数或目标大小' }
      }
      return { ok: true, command: { action: 'resize', target: t.target, scale, size } }
    }
    case 'delete': {
      const t = validateTarget(v.target)
      if (!t.ok) return t
      return { ok: true, command: { action: 'delete', target: t.target } }
    }
    case 'style': {
      const t = validateTarget(v.target)
      if (!t.ok) return t
      if (typeof v.color !== 'string' || !HEX_COLOR.test(v.color)) {
        return { ok: false, error: `非法颜色值: ${String(v.color)}` }
      }
      return { ok: true, command: { action: 'style', target: t.target, color: v.color } }
    }
    case 'clear':
      return { ok: true, command: { action: 'clear' } }
    case 'undo':
      return { ok: true, command: { action: 'undo' } }
    case 'redo':
      return { ok: true, command: { action: 'redo' } }
    case 'background': {
      if (typeof v.color !== 'string' || !HEX_COLOR.test(v.color)) {
        return { ok: false, error: `非法背景色: ${String(v.color)}` }
      }
      return { ok: true, command: { action: 'background', color: v.color } }
    }
    case 'export':
      return { ok: true, command: { action: 'export' } }
    case 'replay':
      return { ok: true, command: { action: 'replay' } }
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
