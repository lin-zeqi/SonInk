<script setup lang="ts">
import { ref, watch } from 'vue'
import { PROVIDER_PRESETS, useSettingsStore } from '../store/settings'

const settings = useSettingsStore()

const provider = ref(settings.provider)
const apiKey = ref(settings.keys[settings.provider] ?? '')
const model = ref(settings.models[settings.provider] ?? '')
const customBaseUrl = ref(settings.customBaseUrl)
const saved = ref(false)

// 切换服务商时带出该服务商已保存的 Key 与模型名
watch(provider, (id) => {
  apiKey.value = settings.keys[id] ?? ''
  model.value = settings.models[id] ?? ''
})

function preset(id: string) {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[0]
}

function save() {
  settings.update({ provider: provider.value })
  settings.update({
    apiKey: apiKey.value,
    model: model.value,
    customBaseUrl: customBaseUrl.value,
  })
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}
</script>

<template>
  <div v-if="settings.panelOpen" class="settings-panel">
    <div class="row">
      <label>大模型服务商</label>
      <select v-model="provider">
        <option v-for="p in PROVIDER_PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
      </select>
    </div>
    <div v-if="provider === 'custom'" class="row">
      <label>接口地址</label>
      <input v-model="customBaseUrl" placeholder="https://example.com/v1（OpenAI 兼容）" />
    </div>
    <div class="row">
      <label>模型名称</label>
      <input v-model="model" :placeholder="preset(provider).defaultModel || '如 gpt-4o-mini'" />
    </div>
    <div class="row">
      <label>API Key</label>
      <input v-model="apiKey" type="password" placeholder="sk-..." @keydown.enter="save" />
    </div>
    <div class="actions">
      <button @click="save">{{ saved ? '已保存' : '保存' }}</button>
    </div>
    <div class="hint">
      各服务商的 Key 分开保存、切换不丢，仅存本机浏览器（localStorage），
      只用于向所选服务商发起复杂指令拆解请求，不会上传到其他任何地方。
    </div>
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
  margin-bottom: 8px;
}

label {
  width: 92px;
  font-size: 13px;
  white-space: nowrap;
}

input,
select {
  width: 280px;
  padding: 6px 10px;
  border: none;
  border-radius: 6px;
  outline: none;
  font-size: 13px;
}

.actions {
  display: flex;
  justify-content: flex-end;
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
  max-width: 390px;
  font-size: 12px;
  color: #a0a0b8;
}
</style>
