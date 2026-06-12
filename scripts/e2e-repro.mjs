/**
 * 端到端复现脚本：驱动本机 Edge 走调试输入链路，检视画布内部状态。
 * 前置：npm run dev 已在 5173 端口运行。
 * 用法：node scripts/e2e-repro.mjs "画一个红色的圆" "画一个蓝色的圆" "选中红色的"
 */
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const commands = process.argv.slice(2)

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' })
const page = await browser.newPage()
page.on('console', (msg) => console.log(`[browser:${msg.type()}]`, msg.text()))
page.on('pageerror', (err) => console.log('[pageerror]', err.message))

await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
await page.waitForSelector('.debug-input input')

async function dumpState(label) {
  const state = await page.evaluate(() => {
    const s = window.__sonink
    const nodes = s.mainLayer.getChildren().map((n) => ({
      id: n.id(),
      class: n.className,
      fill: typeof n.fill === 'function' ? n.fill() : undefined,
      stroke: typeof n.stroke === 'function' ? n.stroke() : undefined,
      x: Math.round(n.x()),
      y: Math.round(n.y()),
    }))
    const highlights = s.feedbackLayer.getChildren().map((n) => ({
      class: n.className,
      x: Math.round(n.x()),
      y: Math.round(n.y()),
      w: Math.round(n.width()),
      h: Math.round(n.height()),
      visible: n.isVisible(),
    }))
    const feedback = document.querySelector('.feedback')?.textContent ?? '(无反馈)'
    return { nodes, highlights, feedback }
  })
  console.log(`\n=== ${label} ===`)
  console.log('反馈:', state.feedback)
  console.log('主层节点:', JSON.stringify(state.nodes))
  console.log('反馈层(高亮):', JSON.stringify(state.highlights))
}

for (const cmd of commands) {
  await page.type('.debug-input input', cmd)
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, 400))
  await dumpState(`输入: ${cmd}`)
}

await page.screenshot({ path: 'scripts/e2e-repro.png' })
await browser.close()
console.log('\n截图: scripts/e2e-repro.png')
