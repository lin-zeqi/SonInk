/**
 * TTS 播报封装（Web Speech SpeechSynthesis）。
 * 播报开始/结束状态回调用于暂停/恢复语音识别，避免自听回环
 * （系统把自己的播报当成用户指令）。
 */

export type SpeakStateListener = (speaking: boolean) => void

let listener: SpeakStateListener | null = null
let watchdog: ReturnType<typeof setTimeout> | null = null

export function onSpeakStateChange(l: SpeakStateListener): void {
  listener = l
}

function clearWatchdog(): void {
  if (watchdog !== null) {
    clearTimeout(watchdog)
    watchdog = null
  }
}

/** 通知识别恢复（speaking=false），并清除看门狗，保证只触发一次 */
function finishSpeaking(): void {
  clearWatchdog()
  listener?.(false)
}

export function isTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function speak(text: string): void {
  if (!isTtsSupported() || !text) return
  const synth = window.speechSynthesis
  // 新播报打断旧播报：反馈始终跟随最新指令
  clearWatchdog()
  synth.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'zh-CN'
  utter.rate = 1.1
  utter.onstart = () => listener?.(true)
  utter.onend = finishSpeaking
  utter.onerror = finishSpeaking
  synth.speak(utter)
  // 看门狗：个别浏览器不触发 onend/onerror 时，按估算时长强制恢复识别，
  // 否则识别会被永久暂停。估算 ≈ 每字 0.22s / rate + 2s 余量。
  const estimateMs = (text.length * 220) / utter.rate + 2000
  watchdog = setTimeout(finishSpeaking, estimateMs)
}
