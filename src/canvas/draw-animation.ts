import Konva from 'konva'

/**
 * 渐进绘制动画：新图形以"手绘描边"的方式逐笔出现，描边完成后填充淡入。
 * 实现原理是虚线偏移（dash offset）技巧——把整条轮廓设为一段与周长等长的虚线，
 * 再把偏移量从周长动画到 0，视觉上即"一笔画出轮廓"。
 *
 * 动画是纯视觉表现：节点几何在创建时即为最终状态，选中高亮、移动、删除
 * 等操作在动画进行中也能正确命中，不影响"语音到首笔反馈"的延迟指标。
 */

const OUTLINE_DURATION = 0.5
const FILL_DURATION = 0.25

/** 轮廓周长，决定虚线段长度 */
function outlineLength(node: Konva.Shape): number {
  if (node instanceof Konva.Circle) {
    return 2 * Math.PI * node.radius()
  }
  if (node instanceof Konva.Rect) {
    return 2 * (node.width() + node.height())
  }
  if (node instanceof Konva.RegularPolygon) {
    const side = 2 * node.radius() * Math.sin(Math.PI / node.sides())
    return node.sides() * side
  }
  if (node instanceof Konva.Line) {
    const p = node.points()
    let len = 0
    for (let i = 2; i < p.length; i += 2) {
      len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1])
    }
    return len
  }
  return 0
}

function hexToRgba(hex: string, alpha: number): string {
  const { r, g, b } = Konva.Util.getRGB(hex)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * 对刚加入画布的图形播放渐进绘制动画。
 * @param fill 最终填充色；直线等无填充图形传 null
 */
export function revealShape(node: Konva.Shape, fill: string | null): void {
  const length = outlineLength(node)
  if (length <= 0) return

  // 阶段一：描边。填充先隐藏，轮廓以虚线偏移方式逐笔画出
  if (fill) {
    node.fill(hexToRgba(fill, 0))
  }
  node.dash([length])
  node.dashOffset(length)

  new Konva.Tween({
    node,
    dashOffset: 0,
    duration: OUTLINE_DURATION,
    easing: Konva.Easings.EaseInOut,
    onFinish: () => {
      node.dash([])
      if (!fill) return
      // 阶段二：填充淡入
      new Konva.Tween({
        node,
        fill,
        duration: FILL_DURATION,
        easing: Konva.Easings.EaseIn,
      }).play()
    },
  }).play()
}
