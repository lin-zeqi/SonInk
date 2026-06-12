import { watch } from 'vue'
import { useCommandStore } from './store/command'
import { useAssistantStore } from './store/assistant'
import { useObjectsStore } from './store/objects'
import { useSettingsStore } from './store/settings'
import { validateDsl } from './dsl/schema'
import { executeAll } from './dsl/executor'
import type { DslCommand } from './dsl/types'
import { isShapeMissing, parseCommand } from './parser/rules'
import { chat } from './llm/client'
import { speak } from './speech/tts'

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

const CONFIRM_YES_PATTERN = /确认|确定|是的|没错|好/

/** 等待确认的指令序列（清空画布二次确认） */
let pendingCommands: DslCommand[] | null = null

/**
 * 执行指令序列入口：破坏性操作（画布非空时的清空）先二次确认，
 * 其余直接执行。复合指令含清空时整个序列一起暂存、确认后一起执行。
 */
function runCommands(commands: DslCommand[]): string {
  const hasClear = commands.some((c) => c.action === 'clear')
  if (hasClear && useObjectsStore().objects.length > 0) {
    pendingCommands = commands
    useAssistantStore().setConfirm('确定要清空画布吗？说"确认"继续，说"取消"放弃')
    return '清空画布需要确认（见提示框）'
  }
  return executeAll(commands).message
}

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
  return runCommands(validation.commands)
}

async function runSlowPath(text: string, continuation: boolean): Promise<string> {
  const settings = useSettingsStore()
  const cfg = settings.activeConfig
  if (!cfg.ready) {
    return '这条指令需要 AI 帮忙拆解，请先点击右上角"设置"选择大模型服务商并填入 API Key'
  }

  const assistant = useAssistantStore()
  const command = useCommandStore()
  assistant.begin(text, continuation)
  command.setFeedback('AI 思考中…')

  try {
    const reply = await chat(assistant.messages, cfg)
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
    return runCommands(validation.commands)
  }

  const assistant = useAssistantStore()

  // 清空确认等待中：确认词执行暂存指令，取消词放弃，其他输入视为新指令
  if (assistant.confirm) {
    assistant.setConfirm('')
    const stash = pendingCommands
    pendingCommands = null
    if (CANCEL_PATTERN.test(text) || /不/.test(text)) {
      return '好的，已取消'
    }
    if (CONFIRM_YES_PATTERN.test(text) && stash) {
      return executeAll(stash).message
    }
    // 落到下方按普通指令处理
  }

  // 图形追问等待中：回答补上绘制动词重新解析（"红色的圆"→"画红色的圆"）
  if (assistant.clarify) {
    assistant.setClarify('')
    if (CANCEL_PATTERN.test(text)) {
      return '好的，已取消'
    }
    const completed = parseCommand(`画${text}`)
    if (completed.matched) {
      return runCommands(completed.commands)
    }
    // 不是图形回答：按普通指令继续
  }

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
    return runCommands(ruleResult.commands)
  }

  // 想画但说不出图形：规则级追问，不浪费 LLM 调用（无 Key 也可用）
  if (isShapeMissing(text)) {
    assistant.setClarify('想画什么图形呢？比如圆形、方形、三角形或直线')
    return '请补充想画的图形（见提问框）'
  }

  return runSlowPath(text, false)
}

export function setupPipeline(): void {
  const store = useCommandStore()
  watch(
    () => store.lastCommand,
    (cmd) => {
      if (!cmd) return
      void handleText(cmd.text).then((msg) => {
        store.setFeedback(msg)
        store.setResult(cmd.id, msg)
        if (store.ttsEnabled) {
          // 追问/确认时播报问题本身，比"见提示框"对纯语音交互更有用
          const assistant = useAssistantStore()
          speak(assistant.ask || assistant.confirm || assistant.clarify || msg)
        }
      })
    }
  )
}
