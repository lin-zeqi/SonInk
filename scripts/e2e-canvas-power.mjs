/**
 * 语义模板 / 文本标注 / 改色 / 导出 / 回放 / 拖拽端到端验证。
 * 前置：npm run dev 已在 5173 端口运行。
 */
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' })
const page = await browser.newPage()
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
await page.waitForSelector('.debug-input input')

let failures = 0

function check(label, pass, detail) {
  if (!pass) failures++
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? ` | ${detail}` : ''}`)
}

async function send(text, settle = 900) {
  await page.type('.debug-input input', text)
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, settle))
}

async function state() {
  return page.evaluate(() => ({
    nodes: window.__sonink.mainLayer.getChildren().map((n) => {
      const box = n.getClientRect()
      return {
        cls: n.className,
        cx: Math.round(box.x + box.width / 2),
        cy: Math.round(box.y + box.height / 2),
        fill: typeof n.fill === 'function' ? n.fill() : null,
        text: typeof n.text === 'function' ? n.text() : null,
      }
    }),
    feedback: document.querySelector('.feedback')?.textContent ?? '',
  }))
}

// —— 1. 语义模板：太阳 = 1 圆 + 8 光线 ——
await send('画一个太阳')
let s = await state()
check(
  '太阳 = 圆 + 8 条光线',
  s.nodes.length === 9 &&
    s.nodes[0].cls === 'Circle' &&
    s.nodes.filter((n) => n.cls === 'Line').length === 8,
  `${s.nodes.length} 个节点`
)

// —— 2. TC-P1-01 复合语义对象 ——
await send('清空画布')
await send('确认')
await send('画一个房子，左边加一棵树，右上角有太阳', 1500)
s = await state()
const house = s.nodes.slice(0, 2)
const tree = s.nodes.slice(2, 4)
const sun = s.nodes.slice(4)
check(
  '房子+树+太阳：13 个图形',
  s.nodes.length === 13,
  `${s.nodes.length} 个节点`
)
check('树在房子左边', tree[0].cx < house[0].cx)
check('太阳在右上角区域', sun[0].cx > house[0].cx && sun[0].cy < house[0].cy)

// —— 3. 文本标注 ——
await send('在下面写上你好')
s = await state()
const textNode = s.nodes.find((n) => n.cls === 'Text')
check('文字节点生成', textNode?.text === '你好' && s.feedback.includes('你好'), JSON.stringify(textNode))

// —— 4. 改色（TC-P2-03） ——
await send('清空画布')
await send('确认')
await send('画一个红色的圆')
await send('把这个圆变成蓝色')
s = await state()
// 颜色 tween 结束后 fill 为 rgba 形式，按通道值断言
check(
  '改色生效',
  ['#1e88e5', 'rgba(30,136,229,1)'].includes(s.nodes[0].fill?.replace(/\s/g, '')),
  `fill=${s.nodes[0].fill}`
)

await send('删掉蓝色的圆')
s = await state()
check('改色同步语义特征（按新颜色删除）', s.nodes.length === 0)

await send('撤销') // 恢复（蓝色的）圆
await send('撤销') // 撤销改色 → 红色
s = await state()
check('改色可撤销', s.nodes[0]?.fill === '#e53935', `fill=${s.nodes[0]?.fill}`)

// —— 5. 导出（TC-P2-05） ——
await send('保存图片')
const lastExport = await page.evaluate(() => window.__sonink.lastExport ?? null)
check('导出 PNG dataURL', typeof lastExport === 'string' && lastExport.startsWith('data:image/png'), lastExport?.slice(0, 30))

// —— 6. 回放（TC-P2-06） ——
await send('画一个三角形')
const beforeReplay = (await state()).nodes.length
await send('回放操作', 100)
const during = await page.evaluate(() => ({
  nodes: window.__sonink.mainLayer.getChildren().length,
  feedback: document.querySelector('.feedback')?.textContent ?? '',
}))
// 回放刚开始：回到时间线起点（空画布或更少图形）
await send('画一个圆', 200) // 回放中输入应被拒绝
const rejected = await page.evaluate(() => document.querySelector('.feedback')?.textContent ?? '')
await new Promise((r) => setTimeout(r, 700 * 12)) // 等回放结束
s = await state()
check('回放回到时间线起点', during.nodes < beforeReplay, `回放初 ${during.nodes} 个节点`)
check('回放中拒绝新指令', rejected.includes('回放'), rejected)
check('回放结束恢复当前状态', s.nodes.length === beforeReplay, `${s.nodes.length}/${beforeReplay}`)

// —— 7. 拖拽 + 撤销（TC-P2-04 前置） ——
await send('清空画布')
await send('确认')
await send('画一个圆')
s = await state()
const { cx, cy } = s.nodes[0]
await page.mouse.move(cx, cy + 60) // 画布相对页面有顶栏偏移，用 stage 容器坐标修正
const offset = await page.evaluate(() => {
  const el = document.querySelector('.canvas-container')
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y }
})
await page.mouse.move(offset.x + cx, offset.y + cy)
await page.mouse.down()
await page.mouse.move(offset.x + cx + 80, offset.y + cy, { steps: 8 })
await page.mouse.up()
await new Promise((r) => setTimeout(r, 400))
s = await state()
check('鼠标拖拽移动图形', Math.abs(s.nodes[0].cx - (cx + 80)) < 3, `cx ${cx} -> ${s.nodes[0].cx}`)

await send('撤销')
s = await state()
check('拖拽可撤销', Math.abs(s.nodes[0].cx - cx) < 3, `cx=${s.nodes[0].cx}`)

await page.screenshot({ path: 'scripts/e2e-canvas-power.png' })
await browser.close()
console.log(failures === 0 ? '\n全部断言通过 🎉' : `\n${failures} 个断言失败`)
process.exit(failures === 0 ? 0 : 1)
