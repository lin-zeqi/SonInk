<script setup>
import { onMounted, ref } from 'vue'
import Konva from 'konva'
import { initStage, getMainLayer } from './canvas/stage'

const canvasContainer = ref(null)

onMounted(() => {
  initStage(canvasContainer.value)

  // 临时验证图形：确认 Konva 渲染链路可用，PR #3 接入执行引擎后移除
  getMainLayer().add(
    new Konva.Circle({
      x: 200,
      y: 200,
      radius: 60,
      fill: '#e53935',
    })
  )
})
</script>

<template>
  <div class="app">
    <header class="topbar">
      <h1>SonInk · AI 语音绘图</h1>
      <span class="status">画布就绪（语音模块将在 PR #2 接入）</span>
    </header>
    <main ref="canvasContainer" class="canvas-container"></main>
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

.status {
  font-size: 13px;
  color: #a0a0b8;
}

.canvas-container {
  flex: 1;
  background: #fafafa;
}
</style>
