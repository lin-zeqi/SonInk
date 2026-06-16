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
/** 回放步进间隔（毫秒） */
const REPLAY_STEP_MS = 700

export const useHistoryStore = defineStore('history', {
  state: () => ({
    undoStack: [] as Snapshot[],
    redoStack: [] as Snapshot[],
    /** 回放进行中：管道暂停接收新指令 */
    replaying: false,
  }),
  actions: {
    /**
     * 历史回放：undoStack 即按时间排列的"每次变更前"状态序列，
     * 依次恢复（最早的通常是空画布）最后回到当前状态——
     * 观感为从头重演整个绘图过程，结束后画布与历史栈均与回放前一致。
     */
    replay(): ExecResult {
      if (this.replaying) return { ok: false, message: '回放进行中' }
      if (!this.undoStack.length) return { ok: false, message: '还没有可回放的操作' }

      const timeline: Snapshot[] = [...this.undoStack, captureSnapshot()]
      this.replaying = true
      let i = 0
      const step = () => {
        restoreSnapshot(timeline[i])
        i++
        if (i < timeline.length) {
          setTimeout(step, REPLAY_STEP_MS)
        } else {
          this.replaying = false
        }
      }
      step()
      return { ok: true, message: `开始回放 ${timeline.length} 个步骤` }
    },
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
