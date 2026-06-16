import { defineStore } from 'pinia'

/**
 * 用户设置：大模型服务商选择与各家 API Key。
 * 全部只存浏览器 localStorage，不进代码仓库、不上传到所选大模型以外的任何服务。
 */

export interface ProviderPreset {
  id: string
  label: string
  /** OpenAI 兼容端点前缀，请求时追加 /chat/completions */
  baseUrl: string
  defaultModel: string
  /** 是否随请求发送 response_format: json_object */
  jsonMode: boolean
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat', jsonMode: true },
  { id: 'moonshot', label: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k', jsonMode: true },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-flash', jsonMode: true },
  { id: 'qwen', label: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', jsonMode: true },
  { id: 'custom', label: '自定义（OpenAI 兼容）', baseUrl: '', defaultModel: '', jsonMode: true },
]

export interface LlmConfig {
  baseUrl: string
  model: string
  apiKey: string
  jsonMode: boolean
  /** 配置是否完整可用 */
  ready: boolean
}

interface PersistedSettings {
  provider: string
  /** 各服务商的 Key 分开保存，切换服务商不丢 */
  keys: Record<string, string>
  /** 各服务商的模型名覆盖（空用预设默认值） */
  models: Record<string, string>
  customBaseUrl: string
}

const STORAGE_KEY = 'sonink.settings'
const LEGACY_KEY = 'sonink.deepseek_key'

function load(): PersistedSettings {
  const defaults: PersistedSettings = { provider: 'deepseek', keys: {}, models: {}, customBaseUrl: '' }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaults, ...(JSON.parse(raw) as Partial<PersistedSettings>) }
  } catch {
    /* 损坏的配置按空处理 */
  }
  // 迁移旧版本单一 DeepSeek Key
  const legacy = localStorage.getItem(LEGACY_KEY)
  if (legacy) defaults.keys = { deepseek: legacy }
  return defaults
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    ...load(),
    panelOpen: false,
  }),
  getters: {
    activePreset(s): ProviderPreset {
      return PROVIDER_PRESETS.find((p) => p.id === s.provider) ?? PROVIDER_PRESETS[0]
    },
    activeConfig(): LlmConfig {
      const preset = this.activePreset
      const baseUrl = (preset.id === 'custom' ? this.customBaseUrl : preset.baseUrl).trim().replace(/\/+$/, '')
      const model = (this.models[preset.id] ?? '').trim() || preset.defaultModel
      const apiKey = (this.keys[preset.id] ?? '').trim()
      return { baseUrl, model, apiKey, jsonMode: preset.jsonMode, ready: Boolean(baseUrl && model && apiKey) }
    },
  },
  actions: {
    update(patch: { provider?: string; apiKey?: string; model?: string; customBaseUrl?: string }) {
      if (patch.provider !== undefined) this.provider = patch.provider
      if (patch.apiKey !== undefined) this.keys = { ...this.keys, [this.provider]: patch.apiKey.trim() }
      if (patch.model !== undefined) this.models = { ...this.models, [this.provider]: patch.model.trim() }
      if (patch.customBaseUrl !== undefined) this.customBaseUrl = patch.customBaseUrl.trim()
      const persisted: PersistedSettings = {
        provider: this.provider,
        keys: this.keys,
        models: this.models,
        customBaseUrl: this.customBaseUrl,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    },
    togglePanel() {
      this.panelOpen = !this.panelOpen
    },
  },
})
