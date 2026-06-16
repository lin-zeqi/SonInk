import { watch } from 'vue'
import { useCommandStore } from './store/command'
import { validateDsl } from './dsl/schema'
import { executeAll } from './dsl/executor'
import { parseCommand } from './parser/rules'

/**
 * 指令处理管道：订阅指令流中枢，把文本送往解析与执行。
 *
 * 双通道路由（docs/design.md §3.2）：
 * 1. 快路径：规则引擎本地解析，毫秒级；
 * 2. 慢路径：规则未命中时转交 LLM 拆解（后续 PR 接入）。
 * 另保留 DSL JSON 直通通道（调试用）。
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

  const ruleResult = parseCommand(text)
  if (ruleResult.matched) {
    return executeAll(ruleResult.commands).message
  }

  return '没听懂这条指令（复杂指令拆解将在后续版本接入）'
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
