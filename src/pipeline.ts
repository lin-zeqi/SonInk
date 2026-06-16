import { watch } from 'vue'
import Konva from 'konva'
import { useCommandStore } from './store/command'
import { useAssistantStore } from './store/assistant'
import { useHistoryStore } from './store/history'
import { useObjectsStore } from './store/objects'
import { useSettingsStore } from './store/settings'
import { validateDsl } from './dsl/schema'
import { executeAll } from './dsl/executor'
import type { DslCommand, DrawCommand } from './dsl/types'
import { isShapeMissing, parseBrushStep, parseCommand } from './parser/rules'
import { getCanvasSize, getMainLayer } from './canvas/stage'
import { chat } from './llm/client'
import { buildSystemPrompt } from './llm/prompt'
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

/** LLM 追问轮数硬上限（兜底提示词约束，极端情况截断防无限追问） */
const MAX_ASK_ROUNDS = 2

const CANCEL_PATTERN = /取消|算了|不用了|不画了/

const CONFIRM_YES_PATTERN = /确认|确定|是的|没错|好/

/** 等待确认的指令序列（清空画布二次确认） */
let pendingCommands: DslCommand[] | null = null

// ─── 自由笔刷状态机 ───────────────────────────────────────────

/** 笔刷模式是否激活 */
let brushActive = false
/** 当前笔刷的临时 Konva.Line 节点（null = 未创建） */
let brushLine: Konva.Line | null = null
/** 已累积的路径点（比例坐标），首点为笔刷起点 */
let brushPoints: { fx: number; fy: number }[] = []
/** 笔刷描边色 */
let brushColor = '#212121'

function startBrush(): string {
  const { width, height } = getCanvasSize()
  // 起点：画布中心 + 微小随机偏移，避免与已有对象完全重叠
  const fx = 0.5 + (Math.random() - 0.5) * 0.08
  const fy = 0.5 + (Math.random() - 0.5) * 0.08

  brushPoints = [{ fx, fy }]
  brushColor = '#212121'

  // 创建临时 Konva.Line（初始为一点，几乎不可见；extend 后逐步显现）
  const line = new Konva.Line({
    points: [fx * width, fy * height, fx * width + 1, fy * height],
    stroke: brushColor,
    strokeWidth: 3,
    lineCap: 'round',
    lineJoin: 'round',
    tension: 0.3,
    draggable: false, // 绘制中不可拖拽
  })
  getMainLayer().add(line)
  brushLine = line
  brushActive = true

  return '笔刷就绪，请说方向（往右、往下、往左、往上），说完说"停"'
}

function stepBrush(dfx: number, dfy: number): string {
  if (!brushLine) return '笔刷未启动'

  const last = brushPoints[brushPoints.length - 1]
  const nfx = Math.max(0, Math.min(1, last.fx + dfx))
  const nfy = Math.max(0, Math.min(1, last.fy + dfy))

  brushPoints.push({ fx: nfx, fy: nfy })

  const { width, height } = getCanvasSize()
  const flat = brushPoints.flatMap((p) => [p.fx * width, p.fy * height])
  brushLine.points(flat)
  brushLine.getLayer()?.batchDraw()

  const parts: string[] = []
  if (dfx > 0) parts.push('右')
  else if (dfx < 0) parts.push('左')
  if (dfy > 0) parts.push('下')
  else if (dfy < 0) parts.push('上')
  return parts.length > 1 ? `往${parts.join('')}一步` : `往${parts[0]}一步`
}

function finishBrush(): string {
  if (!brushLine || brushPoints.length < 2) {
    cancelBrush()
    return '笔刷路径太短，已取消'
  }

  // 销毁临时线，走正常 executeAll 流程（含快照/历史/逐笔描画）
  brushLine.destroy()
  brushLine = null
  brushActive = false

  const cmd: DrawCommand = {
    action: 'draw',
    shape: 'path',
    props: { color: brushColor, points: [...brushPoints] },
  }
  const result = executeAll([cmd])

  brushPoints = []
  brushColor = '#212121'
  return result.ok ? '已画一笔自由线条' : result.message
}

function cancelBrush(): string {
  if (brushLine) {
    brushLine.destroy()
    brushLine = null
  }
  brushPoints = []
  brushColor = '#212121'
  brushActive = false
  return '笔刷已取消'
}

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

type ApplyOutcome =
  | { kind: 'done'; message: string }
  | { kind: 'retry'; error: string }

/**
 * LLM 回复（JSON 字符串）→ 执行/追问，或返回可重试的解析/校验错误。
 * retry 分支故意不 reset，以便保留会话上下文做带错误反馈的重试。
 */
function applyLlmReply(reply: string): ApplyOutcome {
  const assistant = useAssistantStore()

  let parsed: unknown
  try {
    parsed = JSON.parse(reply)
  } catch {
    return { kind: 'retry', error: '返回内容不是合法 JSON' }
  }

  const obj = parsed as { ask?: unknown; commands?: unknown }

  if (typeof obj.ask === 'string' && obj.ask) {
    if (assistant.askCount >= MAX_ASK_ROUNDS) {
      assistant.reset()
      return { kind: 'done', message: 'AI 已追问多次仍无法确定指令，请换个简短说法再试' }
    }
    assistant.finish(reply, obj.ask)
    return { kind: 'done', message: '我需要补充一点信息（见提问框）' }
  }

  const validation = validateDsl(obj.commands ?? parsed)
  if (!validation.ok) {
    return { kind: 'retry', error: validation.error }
  }

  assistant.finish(reply)
  assistant.reset()
  return { kind: 'done', message: runCommands(validation.commands) }
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
  // 每次 LLM 调用前刷新系统提示词中的画布状态，使 LLM 具备空间记忆
  assistant.messages[0] = { role: 'system', content: buildSystemPrompt() }
  command.setFeedback('AI 思考中…')

  try {
    let reply = await chat(assistant.messages, cfg)
    let outcome = applyLlmReply(reply)

    // 解析/校验失败：把模型上次输出与具体错误反馈回去，要求修正后重试一次。
    // 较高温度（0.45）偶发格式抖动，这一步把"直接失败"变成"自我修正"。
    if (outcome.kind === 'retry') {
      assistant.messages.push({ role: 'assistant', content: reply })
      assistant.messages.push({
        role: 'user',
        content: `你上一次的输出未通过校验：${outcome.error}。请严格修正后只输出合法 JSON：坐标一律用 {"fx":0~1,"fy":0~1} 比例值，闭合路径(close:true)必须带 fill，不同对象用不同 groupName。`,
      })
      command.setFeedback('AI 修正中…')
      reply = await chat(assistant.messages, cfg)
      outcome = applyLlmReply(reply)
    }

    if (outcome.kind === 'retry') {
      assistant.reset()
      return `AI 输出的指令未通过校验：${outcome.error}`
    }
    return outcome.message
  } catch (err) {
    assistant.reset()
    return `AI 调用失败：${err instanceof Error ? err.message : '未知错误'}`
  }
}

async function handleText(text: string): Promise<string> {
  // 回放是只读演示过程，期间不接收新指令
  if (useHistoryStore().replaying) {
    return '回放进行中，请稍候'
  }

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
    // 安全兜底：追问轮数超限（正常路径由 applyLlmReply 截断，此处防极端时序）
    if (assistant.askCount > MAX_ASK_ROUNDS) {
      assistant.reset()
      // 落到下方规则引擎解析
    } else if (CANCEL_PATTERN.test(text)) {
      assistant.reset()
      return '好的，已取消'
    } else {
      return runSlowPath(text, true)
    }
  }

  // 自由笔刷模式：方向/启停控制，阻断其他指令（撤销除外）
  if (brushActive) {
    const step = parseBrushStep(text)
    if (!step || step.kind === 'start') return '笔刷模式中，请说方向（往右/往下/往左/往上）或说"停"'
    if (step.kind === 'stop') return finishBrush()
    if (step.kind === 'cancel') return cancelBrush()
    return stepBrush(step.dfx, step.dfy)
  }

  // 笔刷启动词："开始画线"（未进入笔刷模式时匹配）
  const brushStart = parseBrushStep(text)
  if (brushStart?.kind === 'start') return startBrush()

  const ruleResult = parseCommand(text)
  if (ruleResult.matched) {
    return runCommands(ruleResult.commands)
  }

  // 想画但说不出图形：规则级追问，不浪费 LLM 调用（无 Key 也可用）
  if (isShapeMissing(text)) {
    assistant.setClarify('想画什么图形呢？比如圆形、方形、三角形或直线')
    return '请补充想画的图形（见提问框）'
  }

  // 基础形状（圆/方/三角/直线/文字/笔刷）已在上方规则引擎本地命中；
  // 其余一切（太阳/房子/汽车等语义对象、任意复杂物体）一律交给 LLM 绘制。
  // 未配置 Key 时本地无法绘制非基础形状，提示用户配置。
  if (!useSettingsStore().activeConfig.ready) {
    return '这条指令需要 AI 辅助，请先点击右上角"设置"选择大模型服务商并填入 API Key'
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
