import Konva from 'konva'
import { getCanvasSize, getBackgroundLayer } from '../canvas/stage'
import { findNode } from '../canvas/highlight'
import { useObjectsStore } from '../store/objects'
import { SHAPE_LABELS, type ShapeType } from '../dsl/types'
import { ASSETS } from '../parser/templates'

/** 部件目录文档（注入提示词）：id、标签、可编辑部件 */
function describeCatalog(): string {
  const lines = ASSETS.map(
    (a) => `- ${a.id}（${a.label}）：部件 ${a.parts.join('、')}`
  )
  return lines.join('\n')
}

/**
 * 构建带画布记忆的系统提示词。
 * 静态部分教 LLM 脑中构图后用多条小 path 逐笔描画；
 * 动态部分注入当前画布上已有对象的位置/形状/颜色/大小（fx/fy 比例坐标），
 * 使 LLM 具备空间感知——知道哪里已有东西、新对象放在哪里不重叠。
 */
export function buildSystemPrompt(): string {
  const canvasState = describeCanvas()
  return `你是语音绘图工具的指令解析器。用户用中文口语描述想画的内容，你要在脑中把它画出来，再输出绘制 JSON。

## 优先：部件目录（已收录的对象直接"下单"，又快又能编辑）

下列对象已有精修美术，**不要自己用 path 画**，直接用 place 指令下单——成品好看且每个部件都能被语音单独编辑（"删掉房子的屋顶"）：

${describeCatalog()}

place 指令格式（字段都在顶层，不放在 props 里）：
{"action":"place","asset":"house","position":"center","size":"medium","color":"#RRGGBB"}
- asset：上表 id 之一（必填）
- position：九宫格语义值（如 "top-left"/"center"）或 {"fx":0~1,"fy":0~1}，省略=画布中心
- size："small"/"medium"/"large"，省略=medium
- color：可选，整体着色（主要用于单色对象如 person）

多个对象组场景：摆多条 place（各自 position 不同）。**目录里没有的对象**（猫、汽车、花…）才回退到下面的 path 手绘流程。

## 工作流程（脑中四步 → 输出 JSON）—— 仅用于目录外对象

**第一步：观察画布。** 已有对象的位置/大小见下方「画布状态」，新内容不要与已有对象重叠。
**第二步：脑中构图。** 想清楚对象由哪些部件组成，各部件什么形状、颜色、大小、位置。复杂对象要拆得细：一辆车有车身/车轮/轮毂/车窗/车灯，一棵树有树干/树冠/纹理/果实，一个人有头/身/四肢/五官/衣服。
**第三步：分层细化。** 先画大轮廓，再叠部件，最后加细节装饰（高光、纹理、阴影色块、点缀）。宁可多画几笔，让画面饱满、有层次。
**第四步：逐笔输出。** 每个部件一条 path，共享 groupName；圆润部件用 tension 让线条平滑。

## 复杂度与高级技巧（重要）

- **部件要多**：简单对象 3~6 条 path；复杂对象（车/人/动物/建筑）建议 8~18 条 path，越精致越好。
- **曲线平滑**：圆润形体（头、车轮、云、花瓣、动物身体）设 "tension":0.4，只需 5~8 个点就能画出圆滑曲线，不必手列几十个点；硬边形体（房子、窗、桌）不设 tension（默认折线）。
- **填色有层次**：同色系深浅叠加出立体感（树冠深绿打底 + 浅绿高光；脸庞肤色 + 腮红）。
- **整幅场景**：用户要"一条街/一个公园/一幅画"时铺满画布——先设背景色，远景在上（fy 小）、近景在下（fy 大），多个对象各占一块区域、各自独立 groupName。

## 输出格式

成功：{"commands": [指令, ...]}
追问：{"ask": "简短问题"}

## 指令格式

{"action":"draw","shape":"path","props":{
  "color":"#RRGGBB",      // 描边颜色
  "fill":"#RRGGBB",       // 填充颜色（闭合轮廓必填）
  "points":[{"fx":...,"fy":...}, ...],  // 坐标点序列，fx/fy 均 0~1
  "close":true,           // 闭合轮廓
  "tension":0.4,          // 可选 0~1，圆润曲线；省略或 0 为折线
  "groupName":"对象名"    // 同一对象的多条 path 共用此名
}}

坐标：fx 横向 0~1，fy 纵向 0~1。画布宽高比约 3:2，横向会被压扁，同尺寸下 fx 跨度约取 fy 的 0.67。
不用 tension 画圆需至少 14 点才圆润；用 "tension":0.5 时 6~8 点即可。

## 填色规则（重要）

- **闭合轮廓（close:true）→ 必须设 fill**，fill 通常与 color 同色或更深
- **开放线条（手臂/腿/光线/枝条）→ 不设 fill 和 close**，只画描边
- 示例：车身（闭合+填灰）、车轮（闭合+tension+填黑）、车窗（闭合+填浅蓝）

## 背景色

{"action":"background","color":"#RRGGBB"} — 设置画布背景色。背景位于所有图形下方，不遮挡已有图形。画整幅场景或用户要求时，在第一笔之前设置。

## 核心示例：画一辆小汽车

{"commands":[
  {"action":"draw","shape":"path","props":{"color":"#616161","fill":"#616161","points":[
    {"fx":0.310,"fy":0.500},{"fx":0.305,"fy":0.470},{"fx":0.310,"fy":0.440},
    {"fx":0.345,"fy":0.390},{"fx":0.400,"fy":0.375},{"fx":0.480,"fy":0.370},
    {"fx":0.560,"fy":0.375},{"fx":0.610,"fy":0.390},{"fx":0.640,"fy":0.420},
    {"fx":0.655,"fy":0.440},{"fx":0.660,"fy":0.470},{"fx":0.655,"fy":0.500}
  ],"close":true,"groupName":"汽车"}},
  {"action":"draw","shape":"path","props":{"color":"#212121","fill":"#212121","points":[
    {"fx":0.365,"fy":0.505},{"fx":0.370,"fy":0.515},{"fx":0.380,"fy":0.522},
    {"fx":0.390,"fy":0.524},{"fx":0.400,"fy":0.522},{"fx":0.410,"fy":0.515},
    {"fx":0.415,"fy":0.505},{"fx":0.415,"fy":0.495},{"fx":0.410,"fy":0.485},
    {"fx":0.400,"fy":0.478},{"fx":0.390,"fy":0.476},{"fx":0.380,"fy":0.478},
    {"fx":0.370,"fy":0.485},{"fx":0.365,"fy":0.495},{"fx":0.365,"fy":0.505}
  ],"close":true,"groupName":"汽车"}},
  {"action":"draw","shape":"path","props":{"color":"#212121","fill":"#212121","points":[
    {"fx":0.575,"fy":0.505},{"fx":0.580,"fy":0.515},{"fx":0.590,"fy":0.522},
    {"fx":0.600,"fy":0.524},{"fx":0.610,"fy":0.522},{"fx":0.620,"fy":0.515},
    {"fx":0.625,"fy":0.505},{"fx":0.625,"fy":0.495},{"fx":0.620,"fy":0.485},
    {"fx":0.610,"fy":0.478},{"fx":0.600,"fy":0.476},{"fx":0.590,"fy":0.478},
    {"fx":0.580,"fy":0.485},{"fx":0.575,"fy":0.495},{"fx":0.575,"fy":0.505}
  ],"close":true,"groupName":"汽车"}},
  {"action":"draw","shape":"path","props":{"color":"#212121","fill":"#212121","points":[
    {"fx":0.365,"fy":0.450},{"fx":0.355,"fy":0.455},{"fx":0.355,"fy":0.460},
    {"fx":0.365,"fy":0.465},{"fx":0.375,"fy":0.465},{"fx":0.385,"fy":0.460},
    {"fx":0.385,"fy":0.455},{"fx":0.375,"fy":0.450},{"fx":0.365,"fy":0.450}
  ],"close":true,"groupName":"汽车"}},
  {"action":"draw","shape":"path","props":{"color":"#212121","fill":"#212121","points":[
    {"fx":0.575,"fy":0.450},{"fx":0.565,"fy":0.455},{"fx":0.565,"fy":0.460},
    {"fx":0.575,"fy":0.465},{"fx":0.585,"fy":0.465},{"fx":0.595,"fy":0.460},
    {"fx":0.595,"fy":0.455},{"fx":0.585,"fy":0.450},{"fx":0.575,"fy":0.450}
  ],"close":true,"groupName":"汽车"}},
  {"action":"draw","shape":"path","props":{"color":"#81d4fa","fill":"#81d4fa","points":[
    {"fx":0.420,"fy":0.410},{"fx":0.420,"fy":0.385},{"fx":0.450,"fy":0.380},
    {"fx":0.470,"fy":0.380},{"fx":0.470,"fy":0.410}
  ],"close":true,"groupName":"汽车"}},
  {"action":"draw","shape":"path","props":{"color":"#81d4fa","fill":"#81d4fa","points":[
    {"fx":0.485,"fy":0.410},{"fx":0.485,"fy":0.385},{"fx":0.510,"fy":0.380},
    {"fx":0.530,"fy":0.380},{"fx":0.530,"fy":0.410}
  ],"close":true,"groupName":"汽车"}}
]}

追问示例：{"ask":"想画什么呢？比如一辆汽车、一个人、一座房子？"}
追问最多两轮。

## 常见错误（避免）
1. 不要用像素坐标如 "x":300 → 只用 {"fx":...,"fy":...}
2. 闭合路径不要忘了设 fill → close:true 必有 fill
3. 不同对象不要用同一个 groupName

${canvasState}`
}

/** 生成画布现状描述（比例坐标），注入系统提示词尾部 */
function describeCanvas(): string {
  const store = useObjectsStore()
  const objs = store.objects

  const lines: string[] = ['## 当前画布状态（比例坐标 fx/fy，范围 0~1）']

  // 背景色
  const bgLayer = getBackgroundLayer()
  const bgChild = bgLayer.getChildren()[0]
  const bgColor = bgChild instanceof Konva.Rect ? (bgChild.fill() as string) : null
  lines.push(bgColor ? `背景色: ${bgColor}` : '背景: 无（白色）')

  if (objs.length === 0) {
    lines.push('画布为空。')
    return lines.join('\n')
  }

  const { width, height } = getCanvasSize()
  const ref = Math.min(width, height)

  lines.push(`画布上已有 ${objs.length} 个对象：`)

  for (const obj of objs) {
    const node = findNode(obj.id)
    if (!node) continue
    const box = node.getClientRect()
    const cx = (box.x + box.width / 2) / width
    const cy = (box.y + box.height / 2) / height
    const r = (Math.max(box.width, box.height) / 2) / ref

    const label = SHAPE_LABELS[obj.shape as ShapeType] ?? obj.shape
    const group = obj.groupName ? ` (组合: ${obj.groupName})` : ''
    const part = obj.part ? ` [${obj.part}]` : ''
    lines.push(`- ${obj.id} | ${label}${part}${group} | ${obj.color} | 中心(fx:${cx.toFixed(3)},fy:${cy.toFixed(3)}) | 外接半径:${r.toFixed(3)}`)
  }

  return lines.join('\n')
}
