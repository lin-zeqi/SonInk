import Konva from 'konva'
import { getMainLayer } from '../canvas/stage'
import { syncHighlight } from '../canvas/highlight'
import { useObjectsStore, type CanvasObject } from '../store/objects'

/**
 * 画布状态快照：撤销/重做的存储单元。
 *
 * 采用"事务快照"而非逐指令逆操作：executeAll 执行前抓取整体状态，
 * 撤销即整体恢复——删除/清空的逆操作本来就需要保存完整节点，
 * 快照统一了所有指令的回滚路径，且复合指令天然作为一个事务整体回滚。
 */

export interface SnapshotNode {
  className: string
  attrs: Record<string, unknown>
}

export interface Snapshot {
  nodes: SnapshotNode[]
  objects: CanvasObject[]
  selectedIds: string[]
}

export function captureSnapshot(): Snapshot {
  const store = useObjectsStore()
  const metaById = new Map(store.objects.map((o) => [o.id, o] as const))

  const nodes = getMainLayer()
    .getChildren()
    .map((node) => {
      const serialized = node.toObject() as SnapshotNode
      const attrs = { ...serialized.attrs }
      // 渐进绘制动画进行中可能留下 dash 描边与半透明填充，
      // 按登记表中的颜色还原为绘制完成后的最终态
      delete attrs.dash
      delete attrs.dashOffset
      const meta = metaById.get(String(attrs.id))
      if (meta && meta.shape !== 'line') attrs.fill = meta.color
      return { className: serialized.className, attrs }
    })

  return {
    nodes,
    objects: store.objects.map((o) => ({ ...o })),
    selectedIds: [...store.selectedIds],
  }
}

export function restoreSnapshot(snapshot: Snapshot): void {
  // 深拷贝去除 pinia 响应式代理，避免 Konva 持有 store 内部对象
  const plain: Snapshot = JSON.parse(JSON.stringify(snapshot))

  const layer = getMainLayer()
  layer.destroyChildren()
  for (const n of plain.nodes) {
    layer.add(Konva.Node.create({ className: n.className, attrs: n.attrs }) as Konva.Shape)
  }

  useObjectsStore().restore(plain.objects, plain.selectedIds)
  syncHighlight()
}

/** 当前画布状态是否与快照不同（仅比较图形与登记表，选中态变化不入历史） */
export function snapshotChanged(before: Snapshot): boolean {
  const now = captureSnapshot()
  return (
    JSON.stringify({ n: now.nodes, o: now.objects }) !==
    JSON.stringify({ n: before.nodes, o: before.objects })
  )
}
