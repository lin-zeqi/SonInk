<script setup lang="ts">
import { useAssistantStore } from '../store/assistant'

const assistant = useAssistantStore()

function cancel() {
  assistant.reset()
}
</script>

<template>
  <div v-if="assistant.ask" class="ask-overlay">
    <div class="ask-panel">
      <div class="ask-title">AI 想确认一下</div>
      <div class="ask-question">{{ assistant.ask }}</div>
      <div class="ask-hint">直接说出（或在调试框输入）你的回答；说"取消"放弃</div>
      <button class="ask-cancel" @click="cancel">取消</button>
    </div>
  </div>
  <div v-else-if="assistant.thinking" class="thinking-tip">AI 思考中…</div>
</template>

<style scoped>
.ask-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  pointer-events: none;
}

.ask-panel {
  pointer-events: auto;
  min-width: 320px;
  max-width: 60%;
  padding: 18px 22px;
  border-radius: 12px;
  background: rgba(30, 30, 46, 0.92);
  color: #fff;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
}

.ask-title {
  font-size: 13px;
  color: #8be9fd;
  margin-bottom: 8px;
}

.ask-question {
  font-size: 17px;
  line-height: 1.5;
}

.ask-hint {
  margin-top: 10px;
  font-size: 12px;
  color: #a0a0b8;
}

.ask-cancel {
  margin-top: 12px;
  padding: 4px 14px;
  border: 1px solid #555;
  border-radius: 14px;
  background: transparent;
  color: #a0a0b8;
  font-size: 12px;
  cursor: pointer;
}

.thinking-tip {
  position: absolute;
  top: 12vh;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 18px;
  border-radius: 16px;
  background: rgba(30, 30, 46, 0.85);
  color: #8be9fd;
  font-size: 14px;
}
</style>
