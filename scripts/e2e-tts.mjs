/**
 * TTS 播报 + 清空二次确认 + 历史面板端到端验证。
 * speechSynthesis.speak 被替换为记录器（window.__spoken），不实际发声。
 * 前置：npm run dev 已在 5173 端口运行。
 */
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' })
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => {
  window.__spoken = []
  window.speechSynthesis.cancel = () => {}
  window.speechSynthesis.speak = (u) => {
    window.__spoken.push(u.text)
  }
})
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
    nodes: window.__sonink.mainLayer.getChildren().map((n) => n.className),
    spoken: window.__spoken,
    confirm: document.querySelector('.confirm-question')?.textContent ?? null,
    feedback: document.querySelector('.feedback')?.textContent ?? '',
  }))
}

async function clickButton(text) {
  await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t))
    btn?.click()
  }, text)
  await new Promise((r) => setTimeout(r, 600))
}

// —— 0. 空画布清空不需要确认 ——
await send('清空画布')
let s = await state()
check('空画布清空免确认', s.confirm === null && s.feedback.includes('已清空'), s.feedback)

// —— 1. 执行结果有 TTS 播报 ——
await send('画一个红色的圆')
s = await state()
check('绘制结果被播报', s.spoken.at(-1) === '已画一个圆形', JSON.stringify(s.spoken))

// —— 2. 非空画布清空触发二次确认 ——
await send('清空画布')
s = await state()
check('确认面板弹出', s.confirm !== null && s.nodes.length === 1, s.confirm ?? '')
check('播报的是确认问题', s.spoken.at(-1)?.includes('确定要清空'), s.spoken.at(-1))

await send('确认')
s = await state()
check('确认后清空执行', s.nodes.length === 0 && s.spoken.at(-1) === '已清空画布')

await send('撤销')
s = await state()
check('确认后的清空可撤销', s.nodes.length === 1)

// —— 3. 取消放弃清空 ——
await send('清空画布')
await send('算了')
s = await state()
check('取消后画布保留', s.nodes.length === 1 && s.confirm === null && s.spoken.at(-1).includes('已取消'))

// —— 4. 等确认时输入无关指令 → 当新指令执行 ——
await send('清空画布')
await send('画一个三角形')
s = await state()
check('无关输入按新指令处理', s.nodes.length === 2 && s.confirm === null, JSON.stringify(s.nodes))

// —— 5. 复合指令含清空：整体暂存、确认后整体执行 ——
await send('清空画布然后画一个方块')
s = await state()
check('复合清空也要确认', s.confirm !== null && s.nodes.length === 2)
await send('确认')
s = await state()
check('确认后复合整体执行', s.nodes.length === 1 && s.nodes[0] === 'Rect', JSON.stringify(s.nodes))

// —— 6. 确认面板按钮与语音同管道 ——
await send('清空画布')
await clickButton('取消')
s = await state()
check('确认面板取消按钮生效', s.confirm === null && s.nodes.length === 1)

// —— 7. 历史面板 ——
await clickButton('历史')
const history = await page.evaluate(() =>
  [...document.querySelectorAll('.history-item')].map((li) => ({
    cmd: li.querySelector('.cmd')?.textContent.trim(),
    result: li.querySelector('.result')?.textContent.trim(),
  }))
)
check('历史面板有完整记录', history.length >= 10, `${history.length} 条`)
check(
  '记录含指令与执行结果',
  history.some((h) => h.cmd?.includes('画一个红色的圆') && h.result === '已画一个圆形'),
  JSON.stringify(history.slice(0, 3))
)

// —— 8. 播报开关 ——
await clickButton('播报开')
const before = (await state()).spoken.length
await send('画一个圆')
s = await state()
check('关闭播报后不再发声', s.spoken.length === before && s.nodes.length === 2)

await page.screenshot({ path: 'scripts/e2e-tts.png' })
await browser.close()
console.log(failures === 0 ? '\n全部断言通过 🎉' : `\n${failures} 个断言失败`)
process.exit(failures === 0 ? 0 : 1)
