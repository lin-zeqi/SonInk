import { defineStore } from 'pinia'
import type { ShapeType } from '../dsl/types'

/**
 * 画布对象元数据登记表。
 * Konva 节点持有渲染状态，这里持有用于指令匹配的语义特征
 * （"选中那个红色的圆" → 按 shape + color 查找），id 与 Konva 节点 id 一致。
 */
export interface CanvasObject {
  id: string
  shape: ShapeType
  color: string
  /** 创建序号，"刚才那个"按此倒序解析 */
  seq: number
}

export const useObjectsStore = defineStore('objects', {
  state: () => ({
    objects: [] as CanvasObject[],
    selectedIds: [] as string[],
    nextSeq: 1,
  }),
  actions: {
    register(obj: Omit<CanvasObject, 'seq'>) {
      this.objects.push({ ...obj, seq: this.nextSeq++ })
    },
    remove(id: string) {
      this.objects = this.objects.filter((o) => o.id !== id)
      this.selectedIds = this.selectedIds.filter((sid) => sid !== id)
    },
    setSelection(ids: string[]) {
      this.selectedIds = ids
    },
    clear() {
      this.objects = []
      this.selectedIds = []
    },
    /** 整体恢复登记表（撤销/重做）。nextSeq 保持单调递增，避免新对象序号与历史冲突 */
    restore(objects: CanvasObject[], selectedIds: string[]) {
      this.objects = objects
      this.selectedIds = selectedIds
      this.nextSeq = Math.max(this.nextSeq, ...objects.map((o) => o.seq + 1), 1)
    },
  },
  getters: {
    selectedObjects: (s) => s.objects.filter((o) => s.selectedIds.includes(o.id)),
  },
})
