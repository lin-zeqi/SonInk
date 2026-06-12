import { watch } from 'vue'
import { useCommandStore } from './store/command'
import { useAssistantStore } from './store/assistant'
import { useSettingsStore } from './store/settings'
import { validateDsl } from './dsl/schema'
import { executeAll } from './dsl/executor'
import { parseCommand } from './parser/rules'
import { chat } from './llm/client'

/**
 * 指令处理管道：订阅指令流中枢，把文本送往解析与执行。
 *
 * 双通道路由（docs/design.md §3.2）：
 * 1. 快路径：规则引擎本地解析，毫秒级；
 * 2. 慢路径：规则未命中转交 LLM 拆解；信息不足时 LLM 追问（追问面板），
 *    用户的下一条指令作为回答续入同一轮会话。
 * 另保留 DSL JSON 直通通道（调试用）。
 */

const CANCEL_PATTERN = /取消|算了|不用了|不画了/

/** LLM 回复（JSON 字符串）→ 执行或追问 */
function applyLlmReply(reply: string): string {
  const assistant = useAssistantStore()

  let parsed: unknown
  try {
    parsed = JSON.parse(reply)
  } catch {
    assistant.reset()
    return 'AI 返回了无法解析的内容，请换个说法再试'
  }

  const obj = parsed as { ask?: unknown; commands?: unknown }

  if (typeof obj.ask === 'string' && obj.ask) {
    assistant.finish(reply, obj.ask)
    return '我需要补充一点信息（见提问框）'
  }

  const validation = validateDsl(obj.commands ?? parsed)
  if (!validation.ok) {
    assistant.reset()
    return `AI 输出的指令未通过校验：${validation.error}`
  }

  assistant.finish(reply)
  assistant.reset()
  return executeAll(validation.commands).message
}

async function runSlowPath(text: string, continuation: boolean): Promise<string> {
  const settings = useSettingsStore()
  if (!settings.apiKey) {
    return '这条指令需要 AI 帮忙拆解，请先点击右上角"设置"填入 DeepSeek API Key'
  }

  const assistant = useAssistantStore()
  const command = useCommandStore()
  assistant.begin(text, continuation)
  command.setFeedback('AI 思考中…')

  try {
    const reply = await chat(assistant.messages, settings.apiKey)
    return applyLlmReply(reply)
  } catch (err) {
    assistant.reset()
    return `AI 调用失败：${err instanceof Error ? err.message : '未知错误'}`
  }
}

async function handleText(text: string): Promise<string> {
  // DSL JSON 直通（调试用）
  if (text.startsWith('{') || text.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return 'JSON 格式错误'
    }
    const validation = validateDsl(parsed)
    if (!validation.ok) return `指令无效：${validation.error}`
    return executeAll(validation.commands).message
  }

  const assistant = useAssistantStore()

  // 追问等待中：本次输入是对 AI 问题的回答（取消词除外）
  if (assistant.ask) {
    if (CANCEL_PATTERN.test(text)) {
      assistant.reset()
      return '好的，已取消'
    }
    return runSlowPath(text, true)
  }

  const ruleResult = parseCommand(text)
  if (ruleResult.matched) {
    return executeAll(ruleResult.commands).message
  }

  return runSlowPath(text, false)
}

export function setupPipeline(): void {
  const store = useCommandStore()
  watch(
    () => store.lastCommand,
    (cmd) => {
      if (!cmd) return
      void handleText(cmd.text).then((msg) => store.setFeedback(msg))
    }
  )
}
