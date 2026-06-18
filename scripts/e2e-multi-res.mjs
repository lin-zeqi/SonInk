/**
 * 多分辨率适配端到端（真浏览器）。前置：npm run dev 已在 5173 端口运行。
 * 目标：比例坐标系应与分辨率无关——同一九宫格指令在不同视口下，对象中心
 * 的 fx/fy 比例应一致；导出在各分辨率下均产出有效 PNG。
 * 用法：node scripts/e2e-multi-res.mjs
 */
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 768, height: 1024 }, // 竖屏
]
const TOL = 0.04 // fx/fy 比例容差（描边/包围盒带来的微小偏移）

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' })
const page = await browser.newPage()
page.on('pageerror', (err) => console.log('[pageerror]', err.message))

let failures = 0
function check(label, pass, detail = '') {
  if (!pass) failures++
  console.log(`${pass ? '✅' : '❌'} ${label}${detail ? ` -> ${detail}` : ''}`)
}

async function send(text, wait = 500) {
  await page.type('.debug-input input', text)
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, wait))
}

// 读取右上角圆的中心比例 + 画布尺寸
async function probe() {
  return page.evaluate(() => {
    const s = window.__sonink
    const w = s.stage.width()
    const h = s.stage.height()
    const circle = s.mainLayer.getChildren().find((n) => n.className === 'Circle')
    if (!circle) return null
    return { fx: circle.x() / w, fy: circle.y() / h, w, h }
  })
}

const results = []
for (const vp of VIEWPORTS) {
  await page.setViewport(vp)
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
  await page.waitForSelector('.debug-input input')
  // 等画布按视口完成 resize
  await new Promise((r) => setTimeout(r, 300))

  await send('在右上角画一个红色的圆')
  const p = await probe()
  check(
    `${vp.width}x${vp.height} 画布尺寸跟随视口`,
    p !== null && p.w > 0 && p.h > 0,
    p ? `stage ${p.w}x${p.h}` : 'null'
  )
  if (p) {
    results.push({ vp, ...p })
    check(
      `${vp.width}x${vp.height} 右上角落点比例合理`,
      Math.abs(p.fx - 0.67) < TOL && Math.abs(p.fy - 0.28) < TOL,
      `fx=${p.fx.toFixed(3)} fy=${p.fy.toFixed(3)}（期望 ~0.67/0.28）`
    )
  }

  // 缩放保心：放大后中心比例应基本不变
  const before = p
  await send('把它放大')
  const after = await probe()
  if (before && after) {
    check(
      `${vp.width}x${vp.height} 缩放保持中心比例`,
      Math.abs(after.fx - before.fx) < TOL && Math.abs(after.fy - before.fy) < TOL,
      `Δfx=${(after.fx - before.fx).toFixed(3)} Δfy=${(after.fy - before.fy).toFixed(3)}`
    )
  }

  // 导出在该分辨率下产出有效 PNG
  await send('保存图片')
  const lastExport = await page.evaluate(() => window.__sonink.lastExport ?? null)
  check(
    `${vp.width}x${vp.height} 导出有效 PNG`,
    typeof lastExport === 'string' && lastExport.startsWith('data:image/png'),
    lastExport?.slice(0, 24)
  )
}

// 跨分辨率比例一致性：三档下右上角圆的 fx/fy 应彼此接近
if (results.length === VIEWPORTS.length) {
  const fxs = results.map((r) => r.fx)
  const fys = results.map((r) => r.fy)
  const spread = (arr) => Math.max(...arr) - Math.min(...arr)
  check(
    '跨分辨率 fx 一致',
    spread(fxs) < TOL,
    `fx 跨度 ${spread(fxs).toFixed(3)}`
  )
  check(
    '跨分辨率 fy 一致',
    spread(fys) < TOL,
    `fy 跨度 ${spread(fys).toFixed(3)}`
  )
}

await page.screenshot({ path: 'scripts/e2e-multi-res.png' })
await browser.close()

console.log(failures === 0 ? '\n全部断言通过 🎉' : `\n${failures} 个断言失败`)
process.exit(failures === 0 ? 0 : 1)
