import { defineStore } from 'pinia'
import type { ChatMessage } from '../llm/client'
import { SYSTEM_PROMPT } from '../llm/prompt'

/**
 * 慢路径（LLM）会话状态。
 * ask 非空表示 AI 正在等待用户补充信息（追问面板显示中），
 * 此时下一条用户指令作为回答续入同一轮会话。
 */
export const useAssistantStore = defineStore('assistant', {
  state: () => ({
    thinking: false,
    ask: '',
    messages: [] as ChatMessage[],
  }),
  actions: {
    /** 开始一次慢路径调用；continuation=true 表示是追问的回答，沿用上下文 */
    begin(userText: string, continuation: boolean) {
      if (!continuation || this.messages.length === 0) {
        this.messages = [{ role: 'system', content: SYSTEM_PROMPT }]
      }
      this.messages.push({ role: 'user', content: userText })
      this.thinking = true
      this.ask = ''
    },
    /** LLM 返回后登记回复；ask 非空则进入追问等待 */
    finish(reply: string, ask = '') {
      this.messages.push({ role: 'assistant', content: reply })
      this.thinking = false
      this.ask = ask
    },
    reset() {
      this.thinking = false
      this.ask = ''
      this.messages = []
    },
  },
})
