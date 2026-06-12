/**
 * 容错强化端到端验证：相对定位、缺图形追问、口语动词。
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

async function send(text, settle = 800) {
  await page.type('.debug-input input', text)
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, settle))
}

async function state() {
  return page.evaluate(() => ({
    nodes: window.__sonink.mainLayer.getChildren().map((n) => {
      const box = n.getClientRect()
      return { cls: n.className, cx: box.x + box.width / 2, cy: box.y + box.height / 2 }
    }),
    clarify: document.querySelector('.clarify-question')?.textContent ?? null,
    feedback: document.querySelector('.feedback')?.textContent ?? '',
  }))
}

// —— 1. 相对定位 ——
await send('画一个红色的圆')
await send('在圆的右边画一个蓝色方形')
let s = await state()
check(
  '方形画在圆的右边',
  s.nodes.length === 2 &&
    s.nodes[1].cls === 'Rect' &&
    s.nodes[1].cx > s.nodes[0].cx &&
    Math.abs(s.nodes[1].cy - s.nodes[0].cy) < 2,
  JSON.stringify(s.nodes)
)

await send('在方块上面加一条线')
s = await state()
check('线画在方块上方', s.nodes.length === 3 && s.nodes[2].cy < s.nodes[1].cy, JSON.stringify(s.nodes.at(-1)))

// —— 2. 锚点不存在时明确报错 ——
await send('在三角形的右边画一个圆')
s = await state()
check('锚点缺失报错', s.nodes.length === 3 && s.feedback.includes('没找到'), s.feedback)

// —— 3. 缺图形追问（含 SYS-05"画那个那个那个"） ——
await send('画一个')
s = await state()
check('缺图形时追问', s.clarify !== null, s.clarify ?? '')

await send('红色的三角形')
s = await state()
check('回答后补全绘制', s.nodes.length === 4 && s.clarify === null && s.feedback.includes('三角'), s.feedback)

await send('画那个那个那个')
s = await state()
check('"画那个那个那个"触发追问', s.clarify !== null)

await send('算了')
s = await state()
check('追问可取消', s.clarify === null && s.feedback.includes('已取消') && s.nodes.length === 4)

// —— 4. 追问时输入无关指令按新指令处理 ——
await send('画一个')
await send('撤销')
s = await state()
check('追问中无关输入按新指令执行', s.clarify === null && s.nodes.length === 3, `节点 ${s.nodes.length}`)

// —— 5. 口语动词 ——
await send('搞个绿色的三角形')
s = await state()
check('口语动词"搞"', s.nodes.at(-1)?.cls === 'RegularPolygon')

await page.screenshot({ path: 'scripts/e2e-robust.png' })
await browser.close()
console.log(failures === 0 ? '\n全部断言通过 🎉' : `\n${failures} 个断言失败`)
process.exit(failures === 0 ? 0 : 1)
