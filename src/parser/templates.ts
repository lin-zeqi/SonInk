import {
  POSITION_FRACTIONS,
  type DrawCommand,
  type PathPoint,
  type PositionFraction,
  type SemanticPosition,
  type SemanticSize,
} from '../dsl/types'

/**
 * 语义对象模板：每个模板拆分为多条有意义的笔画路径。
 * 每条 path 是一个独立的绘制单元（头部轮廓、一条腿、一道光线…），
 * 共享 groupName，执行引擎按顺序逐笔描画。
 *
 * 坐标体系：比例坐标 + 像素大小。
 * fx 偏移按 ~3:2 画布对 fy 偏移做 0.67 折减，目视比例协调。
 */

type Builder = (c: PositionFraction, s: number) => DrawCommand[]

const FX = 0.67

function pt(fx: number, fy: number): PathPoint {
  return { fx, fy }
}

/** 用 N 边形逼近圆形，返回闭合的 PathPoint[] */
function circlePts(cx: number, cy: number, r: number, n = 14): PathPoint[] {
  const pts: PathPoint[] = []
  for (let i = 0; i <= n; i++) {
    const a = (i * 2 * Math.PI) / n - Math.PI / 2
    pts.push(pt(cx + Math.cos(a) * r * FX, cy + Math.sin(a) * r))
  }
  return pts
}

// --- 火柴人：头+身+四肢，6 笔 ---
const stickman: Builder = (c, s) => {
  const headR = 0.06 * s
  const G = '人'
  return [
    // 头部（14 边形近似圆，填色）
    { action: 'draw', shape: 'path', props: { color: '#212121', fill: '#212121', points: circlePts(c.fx, c.fy - 0.12 * s, headR), close: true, groupName: G } },
    // 身体
    { action: 'draw', shape: 'path', props: { color: '#212121', points: [pt(c.fx, c.fy - 0.06 * s), pt(c.fx, c.fy + 0.10 * s)], groupName: G } },
    // 左腿
    { action: 'draw', shape: 'path', props: { color: '#212121', points: [pt(c.fx, c.fy + 0.10 * s), pt(c.fx - 0.05 * s * FX, c.fy + 0.22 * s)], groupName: G } },
    // 右腿
    { action: 'draw', shape: 'path', props: { color: '#212121', points: [pt(c.fx, c.fy + 0.10 * s), pt(c.fx + 0.05 * s * FX, c.fy + 0.22 * s)], groupName: G } },
    // 左臂
    { action: 'draw', shape: 'path', props: { color: '#212121', points: [pt(c.fx, c.fy + 0.02 * s), pt(c.fx - 0.06 * s * FX, c.fy - 0.04 * s)], groupName: G } },
    // 右臂
    { action: 'draw', shape: 'path', props: { color: '#212121', points: [pt(c.fx, c.fy + 0.02 * s), pt(c.fx + 0.06 * s * FX, c.fy - 0.04 * s)], groupName: G } },
  ]
}

// --- 房子：五边形轮廓填色，1 笔 ---
const house: Builder = (c, s) => [{
  action: 'draw', shape: 'path', props: {
    color: '#8d6e63',
    fill: '#8d6e63',
    points: [
      pt(c.fx - 0.10 * s * FX, c.fy + 0.10 * s),
      pt(c.fx - 0.10 * s * FX, c.fy - 0.04 * s),
      pt(c.fx, c.fy - 0.16 * s),
      pt(c.fx + 0.10 * s * FX, c.fy - 0.04 * s),
      pt(c.fx + 0.10 * s * FX, c.fy + 0.10 * s),
    ],
    close: true,
    groupName: '房子',
  },
}]

// --- 树：树干+树冠，2 笔 ---
const tree: Builder = (c, s) => {
  const G = '树'
  return [
    // 树干
    { action: 'draw', shape: 'path', props: {
      color: '#8d6e63',
      points: [
        pt(c.fx - 0.02 * s * FX, c.fy + 0.16 * s),
        pt(c.fx - 0.02 * s * FX, c.fy + 0.04 * s),
        pt(c.fx + 0.02 * s * FX, c.fy + 0.04 * s),
        pt(c.fx + 0.02 * s * FX, c.fy + 0.16 * s),
      ],
      close: true,
      groupName: G,
    }},
    // 树冠（多边形填色）
    { action: 'draw', shape: 'path', props: {
      color: '#43a047',
      fill: '#43a047',
      points: [
        pt(c.fx - 0.10 * s * FX, c.fy + 0.04 * s),
        pt(c.fx - 0.08 * s * FX, c.fy - 0.04 * s),
        pt(c.fx - 0.03 * s * FX, c.fy - 0.10 * s),
        pt(c.fx + 0.03 * s * FX, c.fy - 0.10 * s),
        pt(c.fx + 0.08 * s * FX, c.fy - 0.04 * s),
        pt(c.fx + 0.10 * s * FX, c.fy + 0.04 * s),
      ],
      close: true,
      groupName: G,
    }},
  ]
}

// --- 太阳：圆面+8 道光芒，9 笔 ---
const sun: Builder = (c, s) => {
  const G = '太阳'
  const commands: DrawCommand[] = [
    // 圆面（14 边形填色）
    { action: 'draw', shape: 'path', props: { color: '#fdd835', fill: '#fdd835', points: circlePts(c.fx, c.fy, 0.05 * s), close: true, groupName: G } },
  ]
  // 8 道光芒
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 - Math.PI / 2
    const innerR = 0.06 * s
    const outerR = 0.10 * s
    commands.push({
      action: 'draw', shape: 'path', props: {
        color: '#fb8c00',
        points: [
          pt(c.fx + Math.cos(a) * innerR * FX, c.fy + Math.sin(a) * innerR),
          pt(c.fx + Math.cos(a) * outerR * FX, c.fy + Math.sin(a) * outerR),
        ],
        groupName: G,
      },
    })
  }
  return commands
}

// --- 雪人：下圆+上圆，2 笔 ---
const snowman: Builder = (c, s) => {
  const G = '雪人'
  return [
    { action: 'draw', shape: 'path', props: { color: '#90caf9', fill: '#90caf9', points: circlePts(c.fx, c.fy + 0.06 * s, 0.06 * s), close: true, groupName: G } },
    { action: 'draw', shape: 'path', props: { color: '#90caf9', fill: '#90caf9', points: circlePts(c.fx, c.fy - 0.04 * s, 0.04 * s), close: true, groupName: G } },
  ]
}

// --- 笑脸：脸+双眼+嘴，4 笔 ---
const smiley: Builder = (c, s) => {
  const G = '笑脸'
  return [
    // 脸（16 边形填色）
    { action: 'draw', shape: 'path', props: { color: '#fdd835', fill: '#fdd835', points: circlePts(c.fx, c.fy, 0.06 * s, 16), close: true, groupName: G } },
    // 左眼（短线表示点）
    { action: 'draw', shape: 'path', props: { color: '#212121', points: [pt(c.fx - 0.025 * s * FX, c.fy - 0.025 * s), pt(c.fx - 0.015 * s * FX, c.fy - 0.025 * s)], groupName: G } },
    // 右眼
    { action: 'draw', shape: 'path', props: { color: '#212121', points: [pt(c.fx + 0.015 * s * FX, c.fy - 0.025 * s), pt(c.fx + 0.025 * s * FX, c.fy - 0.025 * s)], groupName: G } },
    // 嘴巴（弧线）
    { action: 'draw', shape: 'path', props: { color: '#212121', points: [pt(c.fx - 0.025 * s * FX, c.fy + 0.03 * s), pt(c.fx + 0.025 * s * FX, c.fy + 0.03 * s)], groupName: G } },
  ]
}

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

/** 命中返回 [模板词, 构建器] */
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
