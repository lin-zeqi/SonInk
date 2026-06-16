<script setup lang="ts">
import { computed } from 'vue'
import { useCommandStore, type CommandSource } from '../store/command'

const store = useCommandStore()

// 最新的在最上面
const entries = computed(() => [...store.history].reverse())

const SOURCE_LABELS: Record<CommandSource, string> = {
  voice: '语音',
  debug: '调试',
  ui: '按钮',
}
</script>

<template>
  <div v-if="store.historyOpen" class="history-panel">
    <div class="history-title">指令历史</div>
    <div v-if="!entries.length" class="history-empty">还没有执行过指令</div>
    <ul v-else class="history-list">
      <li v-for="e in entries" :key="e.id" class="history-item">
        <div class="cmd">
          {{ e.text }}
          <em class="source">{{ SOURCE_LABELS[e.source] }}</em>
        </div>
        <div class="result">{{ e.result ?? '执行中…' }}</div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.history-panel {
  position: absolute;
  top: 52px;
  left: 16px;
  z-index: 10;
  width: 300px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(30, 30, 46, 0.95);
  color: #fff;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
}

.history-title {
  font-size: 13px;
  color: #8be9fd;
  margin-bottom: 8px;
}

.history-empty {
  font-size: 13px;
  color: #a0a0b8;
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.history-item {
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.history-item:last-child {
  border-bottom: none;
}

.cmd {
  font-size: 13px;
}

.source {
  margin-left: 6px;
  font-size: 11px;
  font-style: normal;
  color: #7c7c96;
}

.result {
  margin-top: 2px;
  font-size: 12px;
  color: #a0a0b8;
}
</style>
