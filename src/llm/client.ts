import type { LlmConfig } from '../store/settings'

/**
 * 大模型客户端（慢路径）：OpenAI 兼容 chat/completions 协议，
 * 服务商（DeepSeek/Kimi/GLM/Qwen/自定义）由用户在设置面板选择。
 * JSON 模式输出。温度取 0.45——在构图丰富度与坐标稳定性之间折中；
 * 偶发的格式/校验失败由 pipeline 的"带错误反馈重试"兜底。
 * API Key 由用户填入，仅存 localStorage，永不进入代码仓库。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** LLM 请求超时（毫秒），超过此值放弃等待 */
const REQUEST_TIMEOUT_MS = 30_000

export async function chat(messages: ChatMessage[], cfg: LlmConfig): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.45,
        ...(cfg.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      if (res.status === 401) throw new Error('API Key 无效，请在设置中检查')
      if (res.status === 429) throw new Error('API 请求过于频繁，请稍后再试')
      throw new Error(`API 请求失败（${res.status}）`)
    }

    const data: unknown = await res.json()
    const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })
      ?.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Error('API 响应格式异常')
    return content
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('AI 响应超时（30s），请换个简短说法再试')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
