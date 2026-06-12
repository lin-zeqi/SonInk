import type { Direction, DrawProps, DslCommand, MoveCommand, TargetSpec } from '../dsl/types'
import {
  COLOR_SYNONYMS,
  POSITION_SYNONYMS,
  SHAPE_SYNONYMS,
  SIZE_SYNONYMS,
  lookup,
  normalize,
  parseNumber,
} from './lexicon'

/**
 * 规则解析引擎（快路径）。
 * 命中高频简单指令时本地毫秒级产出 DSL；未命中返回 miss，
 * 由管道转交 LLM 慢路径（后续 PR 接入）。
 */

export type ParseResult = { matched: true; commands: DslCommand[] } | { matched: false }

const MISS: ParseResult = { matched: false }

const CLEAR_PATTERN = /清空|清除|全部删除|重新开始|擦掉所有/

const DRAW_VERB_PATTERN = /画|绘|来|加|添|整/

const DELETE_PATTERN = /删掉|删除|去掉|移除|擦掉|删/

const SELECT_PATTERN = /选中|选择|选取|选/

/** "移到/放在/挪到"——绝对位置移动 */
const MOVE_TO_PATTERN = /[移挪放][到在]/

const MOVE_PATTERN = /移动|挪|移|放[到在]/

const LAST_REF_PATTERN = /刚才|刚刚|上一个|最后/

const PRONOUN_PATTERN = /它|这个|那个/

const DIRECTION_MAP: Record<string, Direction> = {
  左: 'left',
  右: 'right',
  上: 'up',
  下: 'down',
}

/** 绝对大小："半径五十"、"大小50"、"尺寸为80" */
const ABSOLUTE_SIZE_PATTERN = /(?:半径|大小|尺寸)(?:为|是)?([零一二两三四五六七八九十百\d]+)/

function extractSize(text: string): { size: DrawProps['size'] | undefined; rest: string } {
  const absolute = text.match(ABSOLUTE_SIZE_PATTERN)
  if (absolute) {
    const value = parseNumber(absolute[1])
    if (value !== null && value > 0) {
      // 从文本中移除已匹配片段，避免"大小"中的"大"再被语义大小误判
      return { size: value, rest: text.replace(absolute[0], '') }
    }
  }
  return { size: lookup(text, SIZE_SYNONYMS), rest: text }
}

function parseDraw(text: string): ParseResult {
  const shape = lookup(text, SHAPE_SYNONYMS)
  if (!shape) return MISS

  const props: DrawProps = {}
  const { size, rest } = extractSize(text)
  if (size !== undefined) props.size = size

  const color = lookup(rest, COLOR_SYNONYMS)
  if (color) props.color = color

  const position = lookup(rest, POSITION_SYNONYMS)
  if (position) props.position = position

  return { matched: true, commands: [{ action: 'draw', shape, props }] }
}

/**
 * 提取目标描述（指代消解输入，P0 范围）：
 * 特征（图形/颜色）优先；"刚才/上一个"→ last；
 * 仅当无任何特征时，代词（它/这个/那个）才解释为 selected。
 */
function extractTarget(text: string): TargetSpec {
  const target: TargetSpec = {}
  const shape = lookup(text, SHAPE_SYNONYMS)
  if (shape) target.shape = shape
  const color = lookup(text, COLOR_SYNONYMS)
  if (color) target.color = color

  if (LAST_REF_PATTERN.test(text)) {
    target.ref = 'last'
  } else if (!shape && !color && PRONOUN_PATTERN.test(text)) {
    target.ref = 'selected'
  }
  return target
}

function hasTarget(target: TargetSpec): boolean {
  return target.ref !== undefined || target.shape !== undefined || target.color !== undefined
}

function parseSelect(text: string): ParseResult {
  const target = extractTarget(text)
  // "选中"无修饰时默认最近对象
  if (!hasTarget(target)) target.ref = 'last'
  return { matched: true, commands: [{ action: 'select', target }] }
}

function parseDelete(text: string): ParseResult {
  const target = extractTarget(text)
  const command: DslCommand = hasTarget(target)
    ? { action: 'delete', target }
    : { action: 'delete' }
  return { matched: true, commands: [command] }
}

function parseMove(text: string): ParseResult {
  const cmd: MoveCommand = { action: 'move' }
  const target = extractTarget(text)
  if (hasTarget(target)) cmd.target = target

  // 绝对位置："移到中间"、"放到左上角"
  if (MOVE_TO_PATTERN.test(text)) {
    const position = lookup(text, POSITION_SYNONYMS)
    if (position) {
      cmd.position = position
      return { matched: true, commands: [cmd] }
    }
  }

  // 相对方向："往右移"、"向上挪一点"
  const dirMatch = text.match(/[往向朝]?(左|右|上|下)/)
  if (!dirMatch) return MISS
  cmd.direction = DIRECTION_MAP[dirMatch[1]]

  if (/一点点|一点|一些/.test(text)) {
    cmd.distance = 'small'
  } else if (/很多|大步|远/.test(text)) {
    cmd.distance = 'large'
  } else {
    const num = text.match(/([零一二两三四五六七八九十百\d]+)\s*(?:像素|px)?/)
    const value = num ? parseNumber(num[1]) : null
    // 过小的数值多为"一/两"等量词残留，忽略并使用默认步长
    if (value !== null && value >= 5) cmd.distance = value
  }

  return { matched: true, commands: [cmd] }
}

/**
 * 解析一条自然语言指令。
 * 注意：先做归一化（语气词/标点清洗），所有匹配基于归一化文本。
 * 意图判定顺序有讲究：
 * 1. 清空先于删除（"全部删除"不应落入单对象删除）；
 * 2. 绘制要求"绘制动词 + 图形词"同时存在，且先于移动判定
 *    （"画一个圆放在左上角"是绘制；"把圆放到左上角"无绘制动词，是移动）。
 */
export function parseCommand(raw: string): ParseResult {
  const text = normalize(raw)
  if (!text) return MISS

  if (CLEAR_PATTERN.test(text)) {
    return { matched: true, commands: [{ action: 'clear' }] }
  }

  if (DELETE_PATTERN.test(text)) {
    return parseDelete(text)
  }

  if (SELECT_PATTERN.test(text)) {
    return parseSelect(text)
  }

  if (DRAW_VERB_PATTERN.test(text) && lookup(text, SHAPE_SYNONYMS) !== undefined) {
    return parseDraw(text)
  }

  if (MOVE_PATTERN.test(text)) {
    return parseMove(text)
  }

  return MISS
}
