import { defineStore } from 'pinia'

const STORAGE_KEY = 'sonink.deepseek_key'

/**
 * 用户设置。API Key 只存浏览器 localStorage，
 * 不进代码仓库、不上传到本项目以外的任何服务。
 */
export const useSettingsStore = defineStore('settings', {
  state: () => ({
    apiKey: localStorage.getItem(STORAGE_KEY) ?? '',
    panelOpen: false,
  }),
  actions: {
    setApiKey(key: string) {
      this.apiKey = key.trim()
      localStorage.setItem(STORAGE_KEY, this.apiKey)
    },
    togglePanel() {
      this.panelOpen = !this.panelOpen
    },
  },
})
