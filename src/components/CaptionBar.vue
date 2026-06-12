<script setup>
import { useCommandStore } from '../store/command'

const store = useCommandStore()
</script>

<template>
  <div class="caption-bar">
    <span v-if="store.interim" class="interim">{{ store.interim }}</span>
    <span v-else-if="store.lastCommand" class="final">
      {{ store.lastCommand.text }}
      <em class="source">{{ store.lastCommand.source === 'voice' ? '语音' : '调试' }}</em>
    </span>
    <span v-else class="placeholder">说出指令，例如："画一个红色的圆"</span>
  </div>
</template>

<style scoped>
.caption-bar {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  max-width: 70%;
  padding: 10px 24px;
  border-radius: 24px;
  background: rgba(30, 30, 46, 0.85);
  color: #fff;
  font-size: 16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.interim {
  color: #a0a0b8;
}

.final {
  color: #fff;
}

.source {
  margin-left: 8px;
  font-size: 12px;
  font-style: normal;
  color: #7c7c96;
}

.placeholder {
  color: #7c7c96;
}
</style>
