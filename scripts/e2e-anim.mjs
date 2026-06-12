/**
 * 渐进绘制动画验证：绘制后立即采样 dashOffset 与填充状态，
 * 证明轮廓在逐笔推进、填充随后淡入。
 * 前置：npm run dev 已在 5173 端口运行。
 */
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' })
const page = await browser.newPage()
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
await page.waitForSelector('.debug-input input')

await page.type('.debug-input input', '画一个红色的大圆')
await page.keyboard.press('Enter')

const sample = () =>
  page.evaluate(() => {
    const n = window.__sonink.mainLayer.getChildren()[0]
    return n
      ? { dashOffset: Math.round(n.dashOffset()), dash: n.dash(), fill: n.fill() }
      : null
  })

for (const delay of [60, 200, 400, 1000]) {
  await new Promise((r) => setTimeout(r, delay === 60 ? 60 : delay - 60))
  console.log(`t≈${delay}ms:`, JSON.stringify(await sample()))
}

await page.screenshot({ path: 'scripts/e2e-anim-final.png' })
await browser.close()
