export type ListenState = 'idle' | 'listening'

export interface RecognizerCallbacks {
  /** 流式中间结果 */
  onInterim?: (text: string) => void
  /** 一条完整指令 */
  onFinal?: (text: string) => void
  onStateChange?: (state: ListenState) => void
  onError?: (error: string) => void
}

export interface Recognizer {
  start(): void
  stop(): void
  isRunning(): boolean
}

const SR = window.SpeechRecognition || window.webkitSpeechRecognition

export function isSpeechSupported(): boolean {
  return Boolean(SR)
}

/**
 * Web Speech API 封装。
 * 对外契约仅 RecognizerCallbacks 两个文本回调，
 * 备用方案 B（七牛云 ASR）如启用，将实现同一契约替换本模块。
 */
export function createRecognizer(callbacks: RecognizerCallbacks = {}): Recognizer | null {
  if (!SR) return null
  const { onInterim, onFinal, onStateChange, onError } = callbacks

  const rec = new SR()
  rec.lang = 'zh-CN'
  rec.continuous = true
  rec.interimResults = true

  let running = false

  rec.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i]
      if (result.isFinal) {
        onFinal?.(result[0].transcript.trim())
      } else {
        interim += result[0].transcript
      }
    }
    if (interim) onInterim?.(interim)
  }

  rec.onstart = () => onStateChange?.('listening')

  rec.onerror = (e) => {
    // no-speech 是静音超时的常态错误，交给 onend 重启，不上报
    if (e.error !== 'no-speech') onError?.(e.error)
  }

  // 浏览器会因静音超时自动停止；用户未主动关闭时自动重启，维持持续监听
  rec.onend = () => {
    if (running) {
      try {
        rec.start()
      } catch {
        running = false
        onStateChange?.('idle')
      }
    } else {
      onStateChange?.('idle')
    }
  }

  return {
    start() {
      running = true
      rec.start()
    },
    stop() {
      running = false
      rec.stop()
    },
    isRunning: () => running,
  }
}
