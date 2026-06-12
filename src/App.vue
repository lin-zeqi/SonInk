<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { initStage } from './canvas/stage'
import { createRecognizer, isSpeechSupported, type Recognizer } from './speech/recognizer'
import { useCommandStore } from './store/command'
import { setupPipeline } from './pipeline'
import CaptionBar from './components/CaptionBar.vue'
import DebugInput from './components/DebugInput.vue'

const canvasContainer = ref<HTMLDivElement | null>(null)
const store = useCommandStore()
let recognizer: Recognizer | null = null

onMounted(() => {
  initStage(canvasContainer.value!)
  setupPipeline()

  store.speechSupported = isSpeechSupported()
  if (store.speechSupported) {
    recognizer = createRecognizer({
      onInterim: (t) => store.setInterim(t),
      onFinal: (t) => store.submit(t, 'voice'),
      onStateChange: (s) => (store.listenState = s),
      onError: (err) => console.warn('[speech]', err),
    })
  }
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
    </header>
    <main ref="canvasContainer" class="canvas-container"></main>
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
