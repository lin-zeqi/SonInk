<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { initStage } from './canvas/stage'
import { createRecognizer, isSpeechSupported, type Recognizer } from './speech/recognizer'
import { onSpeakStateChange } from './speech/tts'
import { useCommandStore } from './store/command'
import { useHistoryStore } from './store/history'
import { useSettingsStore } from './store/settings'
import { setupPipeline } from './pipeline'
import CaptionBar from './components/CaptionBar.vue'
import DebugInput from './components/DebugInput.vue'
import AskPanel from './components/AskPanel.vue'
import HistoryPanel from './components/HistoryPanel.vue'
import SettingsPanel from './components/SettingsPanel.vue'

const canvasContainer = ref<HTMLDivElement | null>(null)
const store = useCommandStore()
const history = useHistoryStore()
const settings = useSettingsStore()
let recognizer: Recognizer | null = null

// 快捷键与语音同管道：提交"撤销/重做"文本，反馈、TTS 等行为完全一致
function onKeydown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey)) return
  const target = e.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
  const key = e.key.toLowerCase()
  if (key === 'z' && e.shiftKey) {
    e.preventDefault()
    store.submit('重做', 'ui')
  } else if (key === 'z') {
    e.preventDefault()
    store.submit('撤销', 'ui')
  } else if (key === 'y') {
    e.preventDefault()
    store.submit('重做', 'ui')
  }
}

onMounted(() => {
  initStage(canvasContainer.value!)
  setupPipeline()
  window.addEventListener('keydown', onKeydown)

  store.speechSupported = isSpeechSupported()
  if (store.speechSupported) {
    recognizer = createRecognizer({
      onInterim: (t) => store.setInterim(t),
      onFinal: (t) => store.submit(t, 'voice'),
      onStateChange: (s) => (store.listenState = s),
      onError: (err) => console.warn('[speech]', err),
    })
  }

  // TTS 播报期间暂停识别，避免系统把自己的播报当成指令（自听回环）
  let resumeAfterTts = false
  onSpeakStateChange((speaking) => {
    if (!recognizer) return
    if (speaking && recognizer.isRunning()) {
      resumeAfterTts = true
      recognizer.stop()
    } else if (!speaking && resumeAfterTts) {
      resumeAfterTts = false
      recognizer.start()
    }
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})

// 麦克风权限需要用户手势触发，因此保留这一个点击入口；
// 授权并开启后即进入纯语音操作
function toggleListen() {
  if (!recognizer) return
  if (recognizer.isRunning()) recognizer.stop()
  else recognizer.start()
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <h1>SonInk · AI 语音绘图</h1>
      <button
        v-if="store.speechSupported"
        class="mic-btn"
        :class="{ active: store.listenState === 'listening' }"
        @click="toggleListen"
      >
        {{ store.listenState === 'listening' ? '● 聆听中（点击停止）' : '○ 开始聆听' }}
      </button>
      <span v-else class="status warn">当前浏览器不支持语音识别，请使用 Edge，或用右下角调试输入</span>
      <button
        class="history-btn push-right"
        :disabled="!history.canUndo"
        title="Ctrl+Z"
        @click="store.submit('撤销', 'ui')"
      >
        ↩ 撤销
      </button>
      <button
        class="history-btn"
        :disabled="!history.canRedo"
        title="Ctrl+Y"
        @click="store.submit('重做', 'ui')"
      >
        ↪ 重做
      </button>
      <button class="settings-btn" :class="{ on: store.historyOpen }" @click="store.toggleHistory()">
        历史
      </button>
      <button class="settings-btn" @click="store.toggleTts()">
        {{ store.ttsEnabled ? '🔊 播报开' : '🔇 播报关' }}
      </button>
      <button class="settings-btn" @click="settings.togglePanel()">设置</button>
    </header>
    <main ref="canvasContainer" class="canvas-container"></main>
    <HistoryPanel />
    <SettingsPanel />
    <AskPanel />
    <CaptionBar />
    <DebugInput />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  background: #1e1e2e;
  color: #fff;
}

.topbar h1 {
  font-size: 18px;
  font-weight: 600;
}

.mic-btn {
  padding: 6px 14px;
  border: 1px solid #555;
  border-radius: 16px;
  background: transparent;
  color: #a0a0b8;
  font-size: 13px;
  cursor: pointer;
}

.mic-btn.active {
  border-color: #50fa7b;
  color: #50fa7b;
}

.history-btn {
  padding: 6px 12px;
  border: 1px solid #555;
  border-radius: 16px;
  background: transparent;
  color: #a0a0b8;
  font-size: 13px;
  cursor: pointer;
}

.push-right {
  margin-left: auto;
}

.history-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.settings-btn {
  padding: 6px 14px;
  border: 1px solid #555;
  border-radius: 16px;
  background: transparent;
  color: #a0a0b8;
  font-size: 13px;
  cursor: pointer;
}

.settings-btn.on {
  border-color: #8be9fd;
  color: #8be9fd;
}

.status {
  font-size: 13px;
  color: #a0a0b8;
}

.status.warn {
  color: #ffb86c;
}

.canvas-container {
  flex: 1;
  background: #fafafa;
}
</style>
