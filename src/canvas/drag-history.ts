import { getMainLayer } from './stage'
import { syncHighlight } from './highlight'
import { captureSnapshot, type Snapshot } from '../history/snapshot'
import { useHistoryStore } from '../store/history'

/**
 * 鼠标拖拽图形 → 撤销历史。
 * 事件挂在主图层（Konva 事件冒泡），快照恢复重建的节点无需重新绑定；
 * 节点的 draggable 属性在创建时设置并随快照序列化保留。
 */
export function setupDragHistory(): void {
  const layer = getMainLayer()
  let before: Snapshot | null = null

  layer.on('dragstart', () => {
    before = captureSnapshot()
  })

  layer.on('dragend', () => {
    if (before) {
      useHistoryStore().commit(before)
      before = null
    }
    syncHighlight()
  })
}
