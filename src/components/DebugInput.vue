<script setup lang="ts">
import { ref } from 'vue'
import { useCommandStore } from '../store/command'

const store = useCommandStore()
const text = ref('')

function send(event: KeyboardEvent) {
  // 中文输入法用回车确认候选词时不应触发提交
  if (event.isComposing) return
  store.submit(text.value, 'debug')
  text.value = ''
}
</script>

<template>
  <div class="debug-input">
    <span class="tag">调试输入</span>
    <input
      v-model="text"
      placeholder="无麦克风时输入指令文本，回车提交"
      @keydown.enter="send"
    />
  </div>
</template>

<style scoped>
.debug-input {
  position: absolute;
  right: 16px;
  bottom: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(30, 30, 46, 0.6);
}

.tag {
  font-size: 12px;
  color: #ffb86c;
}

input {
  width: 240px;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  outline: none;
  font-size: 13px;
}
</style>
