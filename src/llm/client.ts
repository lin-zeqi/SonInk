import type { LlmConfig } from '../store/settings'

/**
 * 大模型客户端（慢路径）：OpenAI 兼容 chat/completions 协议，
 * 服务商（DeepSeek/Kimi/GLM/Qwen/自定义）由用户在设置面板选择。
 * JSON 模式输出，温度调低保证指令稳定性。
 * API Key 由用户填入，仅存 localStorage，永不进入代码仓库。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function chat(messages: ChatMessage[], cfg: LlmConfig): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.2,
      ...(cfg.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  })

  if (!res.ok) {
    throw new Error(res.status === 401 ? 'API Key 无效' : `API 请求失败（${res.status}）`)
  }

  const data: unknown = await res.json()
  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('API 响应格式异常')
  return content
}
