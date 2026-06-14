import Konva from 'konva'
import { getCanvasSize, getBackgroundLayer } from '../canvas/stage'
import { findNode } from '../canvas/highlight'
import { useObjectsStore } from '../store/objects'
import { SHAPE_LABELS, type ShapeType } from '../dsl/types'

/**
 * 构建带画布记忆的精简系统提示词。
 * 原则：指令越短 → LLM 响应越快 → 用户等待越少。
 * 关键约束集中在规则和示例中，常见错误单独列出防呆。
 */
export function buildSystemPrompt(): string {
  const canvasState = describeCanvas()
  return `你是语音绘图工具。用户说中文口语，你输出 JSON 绘图指令。

## 输出格式
成功 → {"commands": [指令, ...]}
需要补充信息 → {"ask": "简短问题"}（最多两轮）

## 指令
draw: {"action":"draw","shape":"path","props":{"color":"#hex","points":[{"fx":...,"fy":...},...],"close":bool,"fill":"#hex","groupName":"名称"}}
background: {"action":"background","color":"#hex"}

## 坐标
fx: 0~1 横向（0=最左 0.5=中间 1=最右）
fy: 0~1 纵向（0=最上 0.5=中间 1=最下）
至少 10 个点圆才圆润。闭合轮廓(close:true)必须设 fill。

## 示例
画太阳（一个闭合轮廓+光线）：
{"commands":[
{"action":"draw","shape":"path","props":{"color":"#f44336","fill":"#f44336","points":[{"fx":0.50,"fy":0.42},{"fx":0.54,"fy":0.43},{"fx":0.56,"fy":0.46},{"fx":0.56,"fy":0.50},{"fx":0.54,"fy":0.53},{"fx":0.50,"fy":0.54},{"fx":0.46,"fy":0.53},{"fx":0.44,"fy":0.50},{"fx":0.44,"fy":0.46},{"fx":0.46,"fy":0.43},{"fx":0.50,"fy":0.42}],"close":true,"groupName":"太阳"}},
{"action":"draw","shape":"path","props":{"color":"#f44336","points":[{"fx":0.50,"fy":0.20},{"fx":0.50,"fy":0.32},{"fx":0.68,"fy":0.28},{"fx":0.54,"fy":0.35},{"fx":0.76,"fy":0.42},{"fx":0.56,"fy":0.42},{"fx":0.50,"fy":0.62},{"fx":0.50,"fy":0.72},{"fx":0.44,"fy":0.42},{"fx":0.30,"fy":0.42},{"fx":0.46,"fy":0.35},{"fx":0.18,"fy":0.30},{"fx":0.40,"fy":0.34}],"groupName":"太阳"}}
]}

画花（中心圆+花瓣）：
{"commands":[
{"action":"draw","shape":"path","props":{"color":"#e91e63","fill":"#e91e63","points":[{"fx":0.50,"fy":0.48},{"fx":0.52,"fy":0.46},{"fx":0.54,"fy":0.48},{"fx":0.52,"fy":0.50},{"fx":0.50,"fy":0.52},{"fx":0.48,"fy":0.50},{"fx":0.46,"fy":0.48},{"fx":0.48,"fy":0.46},{"fx":0.50,"fy":0.48}],"close":true,"groupName":"花"}},
{"action":"draw","shape":"path","props":{"color":"#ffeb3b","fill":"#ffeb3b","points":[{"fx":0.50,"fy":0.49},{"fx":0.51,"fy":0.48},{"fx":0.52,"fy":0.49},{"fx":0.51,"fy":0.51},{"fx":0.50,"fy":0.49}],"close":true,"groupName":"花"}}
]}

画汽车（车身+车轮+车窗，各部件共享 groupName "汽车"）：
{"commands":[
{"action":"draw","shape":"path","props":{"color":"#616161","fill":"#616161","points":[{"fx":0.31,"fy":0.50},{"fx":0.31,"fy":0.44},{"fx":0.35,"fy":0.39},{"fx":0.48,"fy":0.37},{"fx":0.56,"fy":0.37},{"fx":0.61,"fy":0.39},{"fx":0.64,"fy":0.42},{"fx":0.66,"fy":0.47},{"fx":0.66,"fy":0.50}],"close":true,"groupName":"汽车"}},
{"action":"draw","shape":"path","props":{"color":"#212121","fill":"#212121","points":[{"fx":0.36,"fy":0.51},{"fx":0.42,"fy":0.52},{"fx":0.42,"fy":0.48},{"fx":0.36,"fy":0.48}],"close":true,"groupName":"汽车"}},
{"action":"draw","shape":"path","props":{"color":"#212121","fill":"#212121","points":[{"fx":0.58,"fy":0.51},{"fx":0.64,"fy":0.52},{"fx":0.64,"fy":0.48},{"fx":0.58,"fy":0.48}],"close":true,"groupName":"汽车"}},
{"action":"draw","shape":"path","props":{"color":"#81d4fa","fill":"#81d4fa","points":[{"fx":0.42,"fy":0.41},{"fx":0.47,"fy":0.38},{"fx":0.47,"fy":0.41}],"close":true,"groupName":"汽车"}},
{"action":"draw","shape":"path","props":{"color":"#81d4fa","fill":"#81d4fa","points":[{"fx":0.49,"fy":0.41},{"fx":0.53,"fy":0.38},{"fx":0.53,"fy":0.41}],"close":true,"groupName":"汽车"}}
]}

## 必遵守
- 所有坐标用 fx/fy 比例，禁止像素值
- 闭合轮廓(close:true)必须同时设 fill，fill 通常与 color 相同
- 开放线条（如光线、手臂、腿）不设 close 和 fill
- 同一对象的多个部件必须共享 groupName
- 圆至少 10 点

## 常见错误（避免）
1. ❌ 用像素坐标如 "x":300 → ✅ 只用 {"fx":...,"fy":...}
2. ❌ 闭合路径忘了设 fill → ✅ close:true 必有 fill
3. ❌ 不同对象的部件用了同一个 groupName → ✅ 不同对象用不同 groupName
4. ❌ 忘了看画布状态，新对象和已有对象重叠 → ✅ 先读画布状态，避开已有对象的区域

${canvasState}`
}

/** 生成画布现状描述（紧凑格式，便于 LLM 快速理解空间布局） */
function describeCanvas(): string {
  const store = useObjectsStore()
  const objs = store.objects

  const lines: string[] = ['## 画布状态']

  const bgLayer = getBackgroundLayer()
  const bgChild = bgLayer.getChildren()[0]
  const bgColor = bgChild instanceof Konva.Rect ? (bgChild.fill() as string) : null
  lines.push(bgColor ? `背景: ${bgColor}` : '背景: 白色')

  if (objs.length === 0) {
    lines.push('空画布')
    return lines.join('\n')
  }

  const { width, height } = getCanvasSize()

  // 按组合分组，紧凑输出
  const groups = new Map<string, typeof objs>()
  const singles: typeof objs = []
  for (const obj of objs) {
    if (obj.groupName) {
      const g = groups.get(obj.groupName) || []
      g.push(obj)
      groups.set(obj.groupName, g)
    } else {
      singles.push(obj)
    }
  }

  const parts: string[] = []
  for (const [gname, members] of groups) {
    const node = findNode(members[0]?.id ?? '')
    if (!node) continue
    const box = node.getClientRect()
    const cx = (box.x + box.width / 2) / width
    const cy = (box.y + box.height / 2) / height
    parts.push(`${gname}(fx:${cx.toFixed(2)},fy:${cy.toFixed(2)})`)
  }
  for (const obj of singles) {
    const node = findNode(obj.id)
    if (!node) continue
    const box = node.getClientRect()
    const cx = (box.x + box.width / 2) / width
    const cy = (box.y + box.height / 2) / height
    const label = SHAPE_LABELS[obj.shape as ShapeType] ?? obj.shape
    parts.push(`${label}(${obj.color},fx:${cx.toFixed(2)},fy:${cy.toFixed(2)})`)
  }

  lines.push(`已有 ${objs.length} 个对象: ${parts.join(' | ')}`)
  return lines.join('\n')
}
