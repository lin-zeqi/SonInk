import Konva from 'konva'
import { getMainLayer, getFeedbackLayer } from './stage'
import { useObjectsStore } from '../store/objects'

/**
 * 选中高亮（反馈层）。
 * 从执行引擎中独立出来：执行引擎与历史快照恢复都需要重绘高亮。
 */

export function findNode(id: string): Konva.Shape | null {
  return (getMainLayer().findOne(`#${id}`) as Konva.Shape | undefined) ?? null
}

/** 按选中集合重绘高亮框（反馈层，不进入对象登记表） */
export function syncHighlight(): void {
  const layer = getFeedbackLayer()
  layer.destroyChildren()
  const store = useObjectsStore()
  for (const id of store.selectedIds) {
    const node = findNode(id)
    if (!node) continue
    const box = node.getClientRect()
    layer.add(
      new Konva.Rect({
        x: box.x - 4,
        y: box.y - 4,
        width: box.width + 8,
        height: box.height + 8,
        stroke: '#ff9800',
        strokeWidth: 2,
        dash: [6, 4],
      })
    )
  }
}
