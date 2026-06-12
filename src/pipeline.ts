import { watch } from 'vue'
import { useCommandStore } from './store/command'
import { validateDsl } from './dsl/schema'
import { executeAll } from './dsl/executor'

/**
 * 指令处理管道：订阅指令流中枢，把文本送往解析与执行。
 *
 * 当前阶段：仅支持直接输入 DSL JSON（调试用），
 * 自然语言规则解析（快路径）在 PR #5 接入本管道，LLM 通道（慢路径）在后续 PR 接入。
 */
function handleText(text: string): string {
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
  return '自然语言解析将在下个版本接入，当前请输入 DSL JSON'
}

export function setupPipeline(): void {
  const store = useCommandStore()
  watch(
    () => store.lastCommand,
    (cmd) => {
      if (!cmd) return
      store.setFeedback(handleText(cmd.text))
    }
  )
}
