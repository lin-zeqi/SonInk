import type {
  Direction,
  DrawProps,
  DslCommand,
  MoveCommand,
  RelativeRelation,
  RelativeTo,
  ResizeCommand,
  TargetSpec,
} from '../dsl/types'
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

/** 重做先于撤销判定："取消撤销"包含"撤销" */
const REDO_PATTERN = /重做|取消撤销|恢复/

const UNDO_PATTERN = /撤销|撤回|回退|退回|上一步|悔棋/

const DRAW_VERB_PATTERN = /画|绘|来|加|添|整|搞|弄|生成|创建/

const DELETE_PATTERN = /删掉|删除|去掉|移除|擦掉|删/

/** 复合指令连接词与子句分隔符 */
const CLAUSE_SPLITTER = /[，,。；;]|然后|接着|以及|还有|和/

const SELECT_PATTERN = /选中|选择|选取|选/

/** "移到/放在/挪到"——绝对位置移动 */
const MOVE_TO_PATTERN = /[移挪放][到在]/

const MOVE_PATTERN = /移动|挪|移|放[到在]/

/** 缩放："放大"不会误中移动（MOVE_TO 要求"放到/放在"） */
const RESIZE_PATTERN = /放大|缩小|变大|变小|调大|调小|大一点|大一些|小一点|小一些/

const ENLARGE_PATTERN = /放大|变大|调大|大一点|大一些/

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

/** 相对定位："在圆的右边"、"在红色的圆左边"（锚点描述限长防贪婪误吞全句） */
const RELATIVE_PATTERN =
  /在(.{1,10}?)的?(右边|右侧|右面|左边|左侧|左面|上面|上方|上边|下面|下方|下边)/

const RELATION_MAP: Record<string, RelativeRelation> = {
  右边: 'right-of',
  右侧: 'right-of',
  右面: 'right-of',
  左边: 'left-of',
  左侧: 'left-of',
  左面: 'left-of',
  上面: 'above',
  上方: 'above',
  上边: 'above',
  下面: 'below',
  下方: 'below',
  下边: 'below',
}

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
  // 相对定位锚点先行剥离："在圆的右边画方形"——锚点（圆）不能参与新图形的槽位提取
  let working = text
  let relativeTo: RelativeTo | undefined
  const rel = working.match(RELATIVE_PATTERN)
  if (rel) {
    const anchorShape = lookup(rel[1], SHAPE_SYNONYMS)
    const anchorColor = lookup(rel[1], COLOR_SYNONYMS)
    if (anchorShape || anchorColor) {
      relativeTo = { relation: RELATION_MAP[rel[2]] }
      if (anchorShape) relativeTo.shape = anchorShape
      if (anchorColor) relativeTo.color = anchorColor
      working = working.replace(rel[0], '')
    }
  }

  const shape = lookup(working, SHAPE_SYNONYMS)
  if (!shape) return MISS

  const props: DrawProps = {}
  if (relativeTo) props.relativeTo = relativeTo
  const { size, rest } = extractSize(working)
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

function parseResize(text: string): ParseResult {
  const cmd: ResizeCommand = { action: 'resize' }
  const target = extractTarget(text)
  if (hasTarget(target)) cmd.target = target

  // 绝对大小："放大到半径五十"
  const absolute = text.match(ABSOLUTE_SIZE_PATTERN)
  if (absolute) {
    const value = parseNumber(absolute[1])
    if (value !== null && value > 0) {
      cmd.size = value
      return { matched: true, commands: [cmd] }
    }
  }

  const enlarge = ENLARGE_PATTERN.test(text)
  if (/一倍/.test(text)) {
    // 口语中"放大一倍"= 2 倍，"缩小一倍"= 一半
    cmd.scale = enlarge ? 2 : 0.5
  } else if (/一半/.test(text)) {
    cmd.scale = 0.5
  } else if (/一点点|一点|一些/.test(text)) {
    cmd.scale = enlarge ? 1.25 : 0.8
  } else {
    cmd.scale = enlarge ? 1.5 : 0.67
  }
  return { matched: true, commands: [cmd] }
}

/**
 * 解析单个子句。
 * 意图判定顺序有讲究：
 * 1. 清空先于删除（"全部删除"不应落入单对象删除）；
 * 2. 绘制要求"绘制动词 + 图形词"同时存在，且先于移动判定
 *    （"画一个圆放在左上角"是绘制；"把圆放到左上角"无绘制动词，是移动）。
 */
function parseSingle(raw: string): ParseResult {
  const text = normalize(raw)
  if (!text) return MISS

  if (REDO_PATTERN.test(text)) {
    return { matched: true, commands: [{ action: 'redo' }] }
  }

  if (UNDO_PATTERN.test(text)) {
    return { matched: true, commands: [{ action: 'undo' }] }
  }

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

  if (RESIZE_PATTERN.test(text)) {
    return parseResize(text)
  }

  if (MOVE_PATTERN.test(text)) {
    return parseMove(text)
  }

  return MISS
}

/**
 * 有绘制意图但说不出图形（"画一个"、"画那个那个那个"）——
 * 去掉动词、指代与量词后没有任何剩余信息时，由管道发起规则级追问，
 * 不浪费一次 LLM 调用。注意"画一个人"residual 为"人"，仍交给 LLM。
 */
export function isShapeMissing(raw: string): boolean {
  const text = normalize(raw)
  if (!DRAW_VERB_PATTERN.test(text)) return false
  if (lookup(text, SHAPE_SYNONYMS) !== undefined) return false
  const residual = text
    .replace(new RegExp(DRAW_VERB_PATTERN.source, 'g'), '')
    .replace(/那个|这个|它|一个|个|一|点|东西|图形|什么|帮忙/g, '')
  return residual.length === 0
}

/**
 * 解析一条自然语言指令（入口）。
 *
 * 先尝试按连接词拆分子句（"画一个红色的圆和一个蓝色的圆"、
 * "画一个圆，然后在左上角画个方块"）：所有子句都解析成功才采纳拆分结果，
 * 任一子句失败则回退整句解析——保证拆分逻辑永远不让原本能解析的句子变差。
 * 无动词子句（"…和一个蓝色的圆"的后半句）承接前一子句的绘制意图。
 */
export function parseCommand(raw: string): ParseResult {
  const clauses = raw.split(CLAUSE_SPLITTER).filter((c) => normalize(c) !== '')

  if (clauses.length > 1) {
    const commands: DslCommand[] = []
    let allMatched = true
    let prevWasDraw = false

    for (const clause of clauses) {
      let result = parseSingle(clause)
      if (!result.matched && prevWasDraw) {
        const text = normalize(clause)
        if (lookup(text, SHAPE_SYNONYMS) !== undefined) result = parseDraw(text)
      }
      if (!result.matched) {
        allMatched = false
        break
      }
      commands.push(...result.commands)
      prevWasDraw = result.commands[result.commands.length - 1]?.action === 'draw'
    }

    if (allMatched && commands.length > 0) return { matched: true, commands }
  }

  return parseSingle(raw)
}
