import { defineStore } from 'pinia'

/**
 * 指令流中枢：语音识别与调试输入统一汇入 submit()，
 * 解析层（PR #4）从这里订阅最终文本，不感知输入来源。
 */
export const useCommandStore = defineStore('command', {
  state: () => ({
    interim: '', // 流式识别的中间文本
    history: [], // { id, text, source: 'voice' | 'debug' }
    listenState: 'idle', // idle | listening
    speechSupported: true,
  }),
  actions: {
    setInterim(text) {
      this.interim = text
    },
    submit(text, source) {
      const t = text.trim()
      if (!t) return
      this.interim = ''
      this.history.push({ id: this.history.length + 1, text: t, source })
    },
  },
  getters: {
    lastCommand: (s) => s.history[s.history.length - 1] ?? null,
  },
})
