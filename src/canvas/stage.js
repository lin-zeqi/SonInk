import Konva from 'konva'

/**
 * Konva 舞台封装。
 * 双层结构：mainLayer 放用户绘制的图形，feedbackLayer 放选中高亮等反馈元素，
 * 反馈元素不进入对象列表与撤销历史。
 */
let stage = null
let mainLayer = null
let feedbackLayer = null

export function initStage(container) {
  stage = new Konva.Stage({
    container,
    width: container.clientWidth,
    height: container.clientHeight,
  })
  mainLayer = new Konva.Layer()
  feedbackLayer = new Konva.Layer({ listening: false })
  stage.add(mainLayer)
  stage.add(feedbackLayer)

  // 窗口缩放时同步画布尺寸，语义定位（九宫格）按比例重算依赖此尺寸
  const onResize = () => {
    stage.width(container.clientWidth)
    stage.height(container.clientHeight)
  }
  window.addEventListener('resize', onResize)

  return stage
}

export function getStage() {
  return stage
}

export function getMainLayer() {
  return mainLayer
}

export function getFeedbackLayer() {
  return feedbackLayer
}

/** 画布逻辑尺寸，执行层做语义位置换算时使用 */
export function getCanvasSize() {
  return { width: stage.width(), height: stage.height() }
}
