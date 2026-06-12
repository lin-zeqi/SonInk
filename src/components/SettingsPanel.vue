<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '../store/settings'

const settings = useSettingsStore()
const draft = ref(settings.apiKey)
const saved = ref(false)

function save() {
  settings.setApiKey(draft.value)
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}
</script>

<template>
  <div v-if="settings.panelOpen" class="settings-panel">
    <div class="row">
      <label>DeepSeek API Key</label>
      <input v-model="draft" type="password" placeholder="sk-..." @keydown.enter="save" />
      <button @click="save">{{ saved ? '已保存' : '保存' }}</button>
    </div>
    <div class="hint">仅保存在本机浏览器（localStorage），用于复杂指令的 AI 拆解，不会上传到其他任何地方。</div>
  </div>
</template>

<style scoped>
.settings-panel {
  position: absolute;
  top: 52px;
  right: 16px;
  z-index: 10;
  padding: 14px 16px;
  border-radius: 10px;
  background: rgba(30, 30, 46, 0.95);
  color: #fff;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

label {
  font-size: 13px;
  white-space: nowrap;
}

input {
  width: 260px;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  outline: none;
  font-size: 13px;
}

button {
  padding: 6px 14px;
  border: 1px solid #555;
  border-radius: 6px;
  background: transparent;
  color: #8be9fd;
  font-size: 13px;
  cursor: pointer;
}

.hint {
  margin-top: 8px;
  max-width: 380px;
  font-size: 12px;
  color: #a0a0b8;
}
</style>
