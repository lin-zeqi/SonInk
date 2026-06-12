/**
 * DeepSeek Chat API 客户端（慢路径）。
 * JSON 模式输出，温度调低保证指令稳定性。
 * API Key 由用户在设置面板填入，仅存 localStorage，永不进入代码仓库。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const ENDPOINT = 'https://api.deepseek.com/chat/completions'

export async function chat(messages: ChatMessage[], apiKey: string): Promise<string> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.2,
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
