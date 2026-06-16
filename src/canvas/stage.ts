import Konva from 'konva'

/**
 * Konva 舞台封装。
 * 双层结构：mainLayer 放用户绘制的图形，feedbackLayer 放选中高亮等反馈元素，
 * 反馈元素不进入对象列表与撤销历史。
 */
let stage: Konva.Stage | null = null
let backgroundLayer: Konva.Layer | null = null
let mainLayer: Konva.Layer | null = null
let feedbackLayer: Konva.Layer | null = null

export function initStage(container: HTMLDivElement): Konva.Stage {
  stage = new Konva.Stage({
    container,
    width: container.clientWidth,
    height: container.clientHeight,
  })
  backgroundLayer = new Konva.Layer({ listening: false })
  mainLayer = new Konva.Layer()
  feedbackLayer = new Konva.Layer({ listening: false })
  stage.add(backgroundLayer)
  stage.add(mainLayer)
  stage.add(feedbackLayer)

  if (import.meta.env.DEV) {
    // 开发态调试钩子，供 e2e 脚本检视画布内部状态
    ;(window as unknown as Record<string, unknown>).__sonink = { stage, backgroundLayer, mainLayer, feedbackLayer }
  }

  // 窗口缩放时同步画布尺寸，语义定位（九宫格）按比例重算依赖此尺寸
  window.addEventListener('resize', () => {
    stage!.width(container.clientWidth)
    stage!.height(container.clientHeight)
  })

  return stage
}

function assertInited<T>(value: T | null): T {
  if (value === null) throw new Error('Stage 尚未初始化，请先调用 initStage()')
  return value
}

export function getStage(): Konva.Stage {
  return assertInited(stage)
}

export function getBackgroundLayer(): Konva.Layer {
  return assertInited(backgroundLayer)
}

export function getMainLayer(): Konva.Layer {
  return assertInited(mainLayer)
}

export function getFeedbackLayer(): Konva.Layer {
  return assertInited(feedbackLayer)
}

/** 画布逻辑尺寸，执行层做语义位置换算时使用 */
export function getCanvasSize(): { width: number; height: number } {
  const s = assertInited(stage)
  return { width: s.width(), height: s.height() }
}
