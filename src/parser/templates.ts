import {
  POSITION_FRACTIONS,
  type DrawCommand,
  type PositionFraction,
  type SemanticPosition,
  type SemanticSize,
} from '../dsl/types'

/**
 * 语义对象模板：高频组合图形（太阳=圆+光线）在规则层直接展开为
 * 基础绘制指令序列——不依赖 LLM、零延迟、无 Key 可演示。
 * 未内置的开放语义对象（"画一个城堡"）仍由 LLM 慢路径拆解。
 *
 * 坐标体系与 LLM 拆解一致：比例坐标 + 像素大小。
 * fx 偏移按 ~3:2 画布对 fy 偏移做 0.67 折减，目视比例协调。
 */

type Builder = (c: PositionFraction, s: number) => DrawCommand[]

const FX = 0.67 // 横向偏移折减系数

function circle(color: string, size: number, fx: number, fy: number): DrawCommand {
  return { action: 'draw', shape: 'circle', props: { color, size, position: { fx, fy } } }
}

function rect(color: string, size: number, fx: number, fy: number): DrawCommand {
  return { action: 'draw', shape: 'rect', props: { color, size, position: { fx, fy } } }
}

function triangle(color: string, size: number, fx: number, fy: number): DrawCommand {
  return { action: 'draw', shape: 'triangle', props: { color, size, position: { fx, fy } } }
}

function line(color: string, x1: number, y1: number, x2: number, y2: number): DrawCommand {
  return {
    action: 'draw',
    shape: 'line',
    props: { color, from: { fx: x1, fy: y1 }, to: { fx: x2, fy: y2 } },
  }
}

const sun: Builder = (c, s) => {
  const commands = [circle('#fdd835', 26 * s, c.fx, c.fy)]
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4
    commands.push(
      line(
        '#fb8c00',
        c.fx + Math.cos(a) * 0.065 * s * FX,
        c.fy + Math.sin(a) * 0.065 * s,
        c.fx + Math.cos(a) * 0.105 * s * FX,
        c.fy + Math.sin(a) * 0.105 * s
      )
    )
  }
  return commands
}

const house: Builder = (c, s) => [
  rect('#8d6e63', 30 * s, c.fx, c.fy + 0.05 * s),
  triangle('#e53935', 42 * s, c.fx, c.fy - 0.075 * s),
]

const tree: Builder = (c, s) => [
  rect('#8d6e63', 9 * s, c.fx, c.fy + 0.075 * s),
  triangle('#43a047', 34 * s, c.fx, c.fy - 0.03 * s),
]

const snowman: Builder = (c, s) => [
  circle('#90caf9', 30 * s, c.fx, c.fy + 0.05 * s),
  circle('#90caf9', 19 * s, c.fx, c.fy - 0.05 * s),
]

const stickman: Builder = (c, s) => [
  circle('#212121', 14 * s, c.fx, c.fy - 0.1 * s),
  line('#212121', c.fx, c.fy - 0.073 * s, c.fx, c.fy + 0.03 * s),
  line('#212121', c.fx - 0.045 * s * FX, c.fy - 0.03 * s, c.fx + 0.045 * s * FX, c.fy - 0.03 * s),
  line('#212121', c.fx, c.fy + 0.03 * s, c.fx - 0.04 * s * FX, c.fy + 0.115 * s),
  line('#212121', c.fx, c.fy + 0.03 * s, c.fx + 0.04 * s * FX, c.fy + 0.115 * s),
]

const smiley: Builder = (c, s) => [
  circle('#fdd835', 34 * s, c.fx, c.fy),
  circle('#212121', 4.5 * s, c.fx - 0.022 * s * FX, c.fy - 0.022 * s),
  circle('#212121', 4.5 * s, c.fx + 0.022 * s * FX, c.fy - 0.022 * s),
  line('#212121', c.fx - 0.022 * s * FX, c.fy + 0.022 * s, c.fx + 0.022 * s * FX, c.fy + 0.022 * s),
]

/** 长词在前（与同义词表同规则） */
const TEMPLATES: ReadonlyArray<[string, Builder]> = [
  ['火柴人', stickman],
  ['小人', stickman],
  ['太阳', sun],
  ['房子', house],
  ['屋子', house],
  ['雪人', snowman],
  ['笑脸', smiley],
  ['树', tree],
]

/** 命中返回 [模板词, 构建器]，供调用方把模板词从文本剥离（"小人"的"小"不能误判大小） */
export function lookupTemplate(text: string): [string, Builder] | undefined {
  return TEMPLATES.find(([word]) => text.includes(word))
}

export function expandTemplate(
  builder: Builder,
  position: SemanticPosition | undefined,
  size: SemanticSize | undefined
): DrawCommand[] {
  const [fx, fy] = position ? POSITION_FRACTIONS[position] : [0.5, 0.5]
  const s = size === 'small' ? 0.7 : size === 'large' ? 1.4 : 1
  return builder({ fx, fy }, s)
}
