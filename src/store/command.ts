import { defineStore } from 'pinia'
import type { ListenState } from '../speech/recognizer'

export type CommandSource = 'voice' | 'debug' | 'ui'

export interface CommandEntry {
  id: number
  text: string
  source: CommandSource
  /** 执行结果反馈，管道执行完成后回填（历史面板展示） */
  result?: string
}

/**
 * 指令流中枢：语音识别与调试输入统一汇入 submit()，
 * 解析层（PR #4）从这里订阅最终文本，不感知输入来源。
 */
export const useCommandStore = defineStore('command', {
  state: () => ({
    /** 流式识别的中间文本 */
    interim: '',
    /** 最近一次执行结果反馈（后续 PR 同时接 TTS 播报） */
    feedback: '',
    history: [] as CommandEntry[],
    listenState: 'idle' as ListenState,
    speechSupported: true,
    ttsEnabled: true,
    historyOpen: false,
  }),
  actions: {
    setResult(id: number, result: string) {
      const entry = this.history.find((e) => e.id === id)
      if (entry) entry.result = result
    },
    toggleTts() {
      this.ttsEnabled = !this.ttsEnabled
    },
    toggleHistory() {
      this.historyOpen = !this.historyOpen
    },
    setInterim(text: string) {
      this.interim = text
    },
    setFeedback(text: string) {
      this.feedback = text
    },
    submit(text: string, source: CommandSource) {
      const t = text.trim()
      if (!t) return
      this.interim = ''
      this.history.push({ id: this.history.length + 1, text: t, source })
    },
  },
  getters: {
    lastCommand: (s): CommandEntry | null => s.history[s.history.length - 1] ?? null,
  },
})
