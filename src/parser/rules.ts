import type { DrawProps, DslCommand } from '../dsl/types'
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
 * 解析一条自然语言指令。
 * 注意：先做归一化（语气词/标点清洗），所有匹配基于归一化文本。
 */
export function parseCommand(raw: string): ParseResult {
  const text = normalize(raw)
  if (!text) return MISS

  if (CLEAR_PATTERN.test(text)) {
    return { matched: true, commands: [{ action: 'clear' }] }
  }

  if (DRAW_VERB_PATTERN.test(text)) {
    return parseDraw(text)
  }

  return MISS
}
