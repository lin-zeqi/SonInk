/**
 * TTS 播报封装（Web Speech SpeechSynthesis）。
 * 播报开始/结束状态回调用于暂停/恢复语音识别，避免自听回环
 * （系统把自己的播报当成用户指令）。
 */

export type SpeakStateListener = (speaking: boolean) => void

let listener: SpeakStateListener | null = null

export function onSpeakStateChange(l: SpeakStateListener): void {
  listener = l
}

export function isTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function speak(text: string): void {
  if (!isTtsSupported() || !text) return
  const synth = window.speechSynthesis
  // 新播报打断旧播报：反馈始终跟随最新指令
  synth.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = 'zh-CN'
  utter.rate = 1.1
  utter.onstart = () => listener?.(true)
  utter.onend = () => listener?.(false)
  utter.onerror = () => listener?.(false)
  synth.speak(utter)
}
