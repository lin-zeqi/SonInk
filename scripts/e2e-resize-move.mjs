/**
 * 缩放指令 + 移动/缩放过渡动画端到端验证。前置：npm run dev 已在 5173 端口运行。
 * 覆盖：矩形无 API 可画（用户问题复核）、移动有过渡动画（中间态≠终态）、
 * 圆/矩形/直线缩放、缩放与移动可撤销（待定终态机制）、多匹配拒绝缩放。
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

async function type(text) {
  await page.type('.debug-input input', text)
  await page.keyboard.press('Enter')
}

async function send(text, settle = 900) {
  await type(text)
  await new Promise((r) => setTimeout(r, settle))
}

async function node(i = 0) {
  return page.evaluate((idx) => {
    const n = window.__sonink.mainLayer.getChildren()[idx]
    if (!n) return null
    return {
      cls: n.className,
      x: n.x(),
      y: n.y(),
      radius: typeof n.radius === 'function' ? n.radius() : null,
      width: typeof n.width === 'function' ? n.width() : null,
      scaleX: n.scaleX(),
    }
  }, i)
}

async function feedback() {
  return page.evaluate(() => document.querySelector('.feedback')?.textContent ?? '')
}

// —— 0. 用户问题复核：不接 API 画矩形 ——
await send('画一个矩形')
let s = await node()
check('无 API 画矩形', s?.cls === 'Rect', JSON.stringify(s))

// —— 1. 移动有过渡动画：中间态 ≠ 终态 ——
const x0 = s.x
await type('往右移五十')
await new Promise((r) => setTimeout(r, 120)) // 动画进行中（总时长 350ms）
const mid = await node()
await new Promise((r) => setTimeout(r, 700))
const fin = await node()
check(
  '移动是渐进的（120ms 时未到位）',
  mid.x > x0 && mid.x < x0 + 49,
  `x: ${x0.toFixed(0)} -> ${mid.x.toFixed(0)} -> ${fin.x.toFixed(0)}`
)
check('移动终点准确（+50px）', Math.abs(fin.x - (x0 + 50)) < 1, `终点 ${fin.x.toFixed(1)}`)

// —— 2. 移动可撤销（待定终态：撤销应回到移动前坐标） ——
await send('撤销')
s = await node()
check('撤销移动回到原位', Math.abs(s.x - x0) < 1, `x=${s.x.toFixed(1)}`)

// —— 3. 矩形缩放保持中心 ——
const before = await node()
const cx = before.x + before.width / 2
await send('放大一倍')
s = await node()
check('矩形放大一倍', Math.abs(s.width - before.width * 2) < 1, `宽 ${before.width} -> ${s.width}`)
check('缩放保持中心不动', Math.abs(s.x + s.width / 2 - cx) < 1)

// —— 4. 缩放可撤销 ——
await send('撤销')
s = await node()
check('撤销缩放恢复原宽', Math.abs(s.width - before.width) < 1, `宽=${s.width}`)

// —— 5. 圆形缩放（按半径） ——
await send('清空画布')
await send('画一个半径五十的红色圆')
await send('缩小一半')
s = await node()
check('圆缩小一半（半径 50→25）', Math.abs(s.radius - 25) < 1, `半径=${s.radius}`)

await send('放大到半径八十')
s = await node()
check('绝对大小（半径 80）', Math.abs(s.radius - 80) < 1, `半径=${s.radius}`)

// —— 6. 直线倍数缩放 ——
await send('画一条线')
await send('把那条线放大一倍')
s = await node(1)
check('直线 scale 缩放', s?.cls === 'Line' && Math.abs(s.scaleX - 2) < 0.01, `scaleX=${s?.scaleX}`)

// —— 7. 多匹配拒绝缩放 ——
await send('清空画布')
await send('画一个红色的圆和一个蓝色的圆')
await send('把圆放大')
const fb = await feedback()
check('多匹配时拒绝并提示', fb.includes('多个'), fb)

await page.screenshot({ path: 'scripts/e2e-resize-move.png' })
await browser.close()
console.log(failures === 0 ? '\n全部断言通过 🎉' : `\n${failures} 个断言失败`)
process.exit(failures === 0 ? 0 : 1)
