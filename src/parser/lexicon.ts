import type { SemanticPosition, SemanticSize, ShapeType } from '../dsl/types'

/**
 * 词法资源：同义词表与文本归一化。
 * 所有表均按"长词在前"排列，匹配时首个命中生效，避免"圆形"被"圆"截胡之类的问题。
 */

/** 口语语气词与礼貌前缀，解析前清洗 */
const FILLER_PATTERN = /请|帮我|麻烦|给我|嗯+|呃+|哦|啊|呀|吧|一下/g

/** 标点与空白 */
const PUNCT_PATTERN = /[，。！？、,.!?\s]+/g

export function normalize(text: string): string {
  return text.replace(FILLER_PATTERN, '').replace(PUNCT_PATTERN, '')
}

export const SHAPE_SYNONYMS: ReadonlyArray<[string, ShapeType]> = [
  ['正方形', 'rect'],
  ['长方形', 'rect'],
  ['三角形', 'triangle'],
  ['圆形', 'circle'],
  ['圆圈', 'circle'],
  ['圈圈', 'circle'],
  ['方形', 'rect'],
  ['方块', 'rect'],
  ['矩形', 'rect'],
  ['三角', 'triangle'],
  ['直线', 'line'],
  ['横线', 'line'],
  ['线条', 'line'],
  ['文字', 'text'],
  ['文本', 'text'],
  ['圈', 'circle'],
  ['圆', 'circle'],
  ['球', 'circle'],
  ['线', 'line'],
]

/** 中文颜色词 → 十六进制（Material 色板，画布上观感统一） */
export const COLOR_SYNONYMS: ReadonlyArray<[string, string]> = [
  ['橙', '#fb8c00'],
  ['橘', '#fb8c00'],
  ['红', '#e53935'],
  ['黄', '#fdd835'],
  ['绿', '#43a047'],
  ['青', '#00acc1'],
  ['蓝', '#1e88e5'],
  ['紫', '#8e24aa'],
  ['粉', '#ec407a'],
  ['黑', '#212121'],
  ['白', '#fafafa'],
  ['灰', '#9e9e9e'],
  ['棕', '#8d6e63'],
  ['咖啡色', '#8d6e63'],
]

export const SIZE_SYNONYMS: ReadonlyArray<[string, SemanticSize]> = [
  ['大大的', 'large'],
  ['大一点', 'large'],
  ['大一些', 'large'],
  ['很大', 'large'],
  ['特大', 'large'],
  ['大点', 'large'],
  ['大的', 'large'],
  ['小一点', 'small'],
  ['小一些', 'small'],
  ['很小', 'small'],
  ['小小的', 'small'],
  ['小点', 'small'],
  ['小的', 'small'],
  ['中等', 'medium'],
  ['大', 'large'],
  ['小', 'small'],
]

export const POSITION_SYNONYMS: ReadonlyArray<[string, SemanticPosition]> = [
  ['左上角', 'top-left'],
  ['右上角', 'top-right'],
  ['左下角', 'bottom-left'],
  ['右下角', 'bottom-right'],
  ['左上', 'top-left'],
  ['右上', 'top-right'],
  ['左下', 'bottom-left'],
  ['右下', 'bottom-right'],
  ['正中间', 'center'],
  ['中间', 'center'],
  ['中央', 'center'],
  ['中心', 'center'],
  ['左边', 'left'],
  ['左侧', 'left'],
  ['右边', 'right'],
  ['右侧', 'right'],
  ['上面', 'top'],
  ['上方', 'top'],
  ['顶部', 'top'],
  ['上边', 'top'],
  ['下面', 'bottom'],
  ['下方', 'bottom'],
  ['底部', 'bottom'],
  ['下边', 'bottom'],
]

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}

/** 中文数字/阿拉伯数字混合串 → 数值（支持到"百"位，如"一百二十"） */
export function parseNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return parseInt(s, 10)
  let total = 0
  let current = 0
  for (const ch of s) {
    if (ch in CN_DIGITS) {
      current = current * 10 + CN_DIGITS[ch]
    } else if (/\d/.test(ch)) {
      current = current * 10 + Number(ch)
    } else if (ch === '十') {
      total += (current || 1) * 10
      current = 0
    } else if (ch === '百') {
      total += (current || 1) * 100
      current = 0
    } else {
      return null
    }
  }
  return total + current
}

/** 在文本中查找首个命中的同义词，返回映射值 */
export function lookup<T>(text: string, table: ReadonlyArray<[string, T]>): T | undefined {
  for (const [word, value] of table) {
    if (text.includes(word)) return value
  }
  return undefined
}
