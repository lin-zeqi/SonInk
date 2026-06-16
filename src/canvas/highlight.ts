import Konva from 'konva'
import { getMainLayer, getFeedbackLayer } from './stage'
import { useObjectsStore } from '../store/objects'

/**
 * 选中高亮（反馈层）。
 * 从执行引擎中独立出来：执行引擎与历史快照恢复都需要重绘高亮。
 *
 * 按 groupId 分组：同一逻辑对象（如"小人"的 34 条线段）共享一个闭合包围盒，
 * 避免每段各画一个高亮框导致视觉混乱。
 */

export function findNode(id: string): Konva.Shape | null {
  return (getMainLayer().findOne(`#${id}`) as Konva.Shape | undefined) ?? null
}

/** 按选中集合重绘高亮框（反馈层，不进入对象登记表） */
export function syncHighlight(): void {
  const layer = getFeedbackLayer()
  layer.destroyChildren()
  const store = useObjectsStore()

  // 按 groupId 分组：同组线段只画一个联合包围盒
  // 无 groupId 的对象（基础图形）各自独立成组
  const groups = new Map<string | undefined, string[]>()
  for (const id of store.selectedIds) {
    const obj = store.objects.find((o) => o.id === id)
    const key = obj?.groupId ?? undefined
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(id)
  }

  for (const [, ids] of groups) {
    if (ids.length === 0) continue

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const id of ids) {
      const node = findNode(id)
      if (!node) continue
      const box = node.getClientRect()
      minX = Math.min(minX, box.x)
      minY = Math.min(minY, box.y)
      maxX = Math.max(maxX, box.x + box.width)
      maxY = Math.max(maxY, box.y + box.height)
    }
    if (!isFinite(minX)) continue

    layer.add(
      new Konva.Rect({
        x: minX - 4,
        y: minY - 4,
        width: maxX - minX + 8,
        height: maxY - minY + 8,
        stroke: '#ff9800',
        strokeWidth: 2,
        dash: [6, 4],
      })
    )
  }
}
