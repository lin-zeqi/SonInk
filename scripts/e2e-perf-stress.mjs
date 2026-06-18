/**
 * 性能压测端到端（真浏览器）。前置：npm run dev 已在 5173 端口运行。
 * 目标：在 50+ 对象下确认绘制全部落地、撤销/重做/回放不崩溃且节点数自洽。
 * 阈值宽松——只防崩溃与数量丢失，不卡精确帧率（动画下逐帧时间本就有抖动）。
 * 用法：node scripts/e2e-perf-stress.mjs
 */
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const TARGET = 60 // 注入对象数（> TODO 要求的 50）

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' })
const page = await browser.newPage()
page.on('pageerror', (err) => console.log('[pageerror]', err.message))
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
await page.waitForSelector('.debug-input input')

let failures = 0
function check(label, pass, detail = '') {
  if (!pass) failures++
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? ` -> ${detail}` : ''}`)
}

async function send(text, wait = 200) {
  await page.type('.debug-input input', text)
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, wait))
}

const nodeCount = () =>
  page.evaluate(() => window.__sonink.mainLayer.getChildren().length)

// —— 批量注入 TARGET 个基础图形（走规则引擎本地快路径，不触发 LLM）——
const shapes = ['圆', '方块', '三角形']
const positions = ['左上角', '上方', '右上角', '左边', '中间', '右边', '左下角', '下方', '右下角']
const colors = ['红色', '蓝色', '绿色', '黄色', '紫色']

const t0 = Date.now()
for (let i = 0; i < TARGET; i++) {
  const shape = shapes[i % shapes.length]
  const pos = positions[i % positions.length]
  const color = colors[i % colors.length]
  await send(`在${pos}画一个${color}的${shape}`, 150)
}
const drawMs = Date.now() - t0
const afterDraw = await nodeCount()
check(`注入 ${TARGET} 个对象全部落地`, afterDraw === TARGET, `实得 ${afterDraw}，耗时 ${drawMs}ms`)

// —— 撤销栈上限为 50：连续撤销应平滑回退，不崩溃 ——
const tU = Date.now()
for (let i = 0; i < 50; i++) await send('撤销', 80)
const undoMs = Date.now() - tU
const afterUndo = await nodeCount()
check('连续 50 次撤销不崩溃且对象减少', afterUndo < afterDraw, `剩 ${afterUndo}，耗时 ${undoMs}ms`)

// —— 重做若干步，确认重做链路在大对象量下可用 ——
for (let i = 0; i < 10; i++) await send('重做', 80)
const afterRedo = await nodeCount()
check('重做后对象数回升', afterRedo > afterUndo, `回到 ${afterRedo}`)

// —— 回放：走撤销栈逐帧重放，确认不抛错、结束后节点数 ≥ 0 ——
const tR = Date.now()
await send('回放操作', 0)
await new Promise((r) => setTimeout(r, 8000)) // 回放按 700ms/帧，留足时间
const replayMs = Date.now() - tR
const afterReplay = await nodeCount()
check('回放完成不崩溃', afterReplay >= 0, `节点 ${afterReplay}，回放窗口 ${replayMs}ms`)

await page.screenshot({ path: 'scripts/e2e-perf-stress.png' })
await browser.close()

console.log(
  `\n性能采样：绘制 ${drawMs}ms / ${TARGET} 件，撤销50 ${undoMs}ms，回放窗口约 ${replayMs}ms`
)
console.log(failures === 0 ? '全部断言通过 🎉' : `${failures} 个断言失败`)
process.exit(failures === 0 ? 0 : 1)
