import { defineStore } from 'pinia'
import type { ExecResult } from '../dsl/types'
import { captureSnapshot, restoreSnapshot, type Snapshot } from '../history/snapshot'

/** 历史栈深度上限，防止长会话内存无限增长 */
const MAX_DEPTH = 50

/**
 * 撤销/重做历史栈。
 * undoStack 存放每次变更"执行前"的快照；撤销时当前状态入 redoStack 再恢复，
 * 重做反向。任何新变更提交后清空 redoStack（标准编辑器语义）。
 */
export const useHistoryStore = defineStore('history', {
  state: () => ({
    undoStack: [] as Snapshot[],
    redoStack: [] as Snapshot[],
  }),
  actions: {
    /** 一次成功的变更事务：传入执行前抓取的快照 */
    commit(before: Snapshot) {
      this.undoStack.push(before)
      if (this.undoStack.length > MAX_DEPTH) this.undoStack.shift()
      this.redoStack = []
    },
    undo(): ExecResult {
      const snap = this.undoStack.pop()
      if (!snap) return { ok: false, message: '没有可撤销的操作' }
      this.redoStack.push(captureSnapshot())
      restoreSnapshot(snap)
      return { ok: true, message: '已撤销' }
    },
    redo(): ExecResult {
      const snap = this.redoStack.pop()
      if (!snap) return { ok: false, message: '没有可重做的操作' }
      this.undoStack.push(captureSnapshot())
      restoreSnapshot(snap)
      return { ok: true, message: '已重做' }
    },
  },
  getters: {
    canUndo: (s) => s.undoStack.length > 0,
    canRedo: (s) => s.redoStack.length > 0,
  },
})
