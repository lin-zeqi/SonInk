/**
 * 撤销/重做端到端验证（真浏览器）。前置：npm run dev 已在 5173 端口运行。
 * 覆盖：单指令撤销/重做、复合指令整体撤销、清空撤销、删除撤销、
 * 新变更截断重做栈、空栈提示、顶栏按钮。
 */
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' })
const page = await browser.newPage()
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
await page.waitForSelector('.debug-input input')

let failures = 0

async function send(text) {
  await page.type('.debug-input input', text)
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, 900))
}

async function state() {
  return page.evaluate(() => ({
    feedback: document.querySelector('.feedback')?.textContent ?? '(无)',
    nodes: window.__sonink.mainLayer.getChildren().map((n) => ({
      cls: n.className,
      fill: n.fill?.() ?? null,
    })),
    highlights: window.__sonink.feedbackLayer.getChildren().length,
  }))
}

async function expect(label, predicate) {
  const s = await state()
  const pass = predicate(s)
  if (!pass) failures++
  console.log(`${pass ? '✅' : '❌'} ${label}`)
  console.log(`   反馈: ${s.feedback} | 节点: ${JSON.stringify(s.nodes)} | 高亮: ${s.highlights}`)
}

// —— 场景 1：单指令撤销/重做 ——
await send('画一个红色的圆')
await expect('画红圆', (s) => s.nodes.length === 1)

await send('撤销')
await expect('撤销后画布为空', (s) => s.nodes.length === 0 && s.feedback.includes('已撤销'))

await send('重做')
await expect('重做后红圆回来', (s) => s.nodes.length === 1 && s.nodes[0].fill === '#e53935')

// —— 场景 2：复合指令整体撤销 ——
await send('画一个蓝色的方块和一个绿色的三角')
await expect('复合绘制 +2', (s) => s.nodes.length === 3)

await send('撤销')
await expect('一次撤销整体回退复合指令', (s) => s.nodes.length === 1)

// —— 场景 3：删除与清空的撤销 ——
await send('删掉那个红色的圆')
await expect('删除红圆', (s) => s.nodes.length === 0)

await send('撤销')
await expect('撤销删除，红圆恢复', (s) => s.nodes.length === 1 && s.nodes[0].fill === '#e53935')

await send('清空画布') // PR #11 起需要二次确认
await send('确认')
await expect('清空（经确认）', (s) => s.nodes.length === 0)

await send('撤销')
await expect('撤销清空', (s) => s.nodes.length === 1)

// —— 场景 4：新变更截断重做栈 ——
await send('撤销') // 画布空，重做栈有内容
await send('画一个三角形') // 新变更应清空重做栈
await send('重做')
await expect('新变更后重做栈已清空', (s) => s.feedback.includes('没有可重做'))

// —— 场景 5：连续撤销到底的提示 ——
await send('撤销') // 撤掉三角
await send('撤销') // 撤掉场景3的清空撤销前状态……一路撤到底
await send('撤销')
await send('撤销')
await send('撤销')
await send('撤销')
await send('撤销')
await expect('撤销到底有提示', (s) => s.feedback.includes('没有可撤销') && s.nodes.length === 0)

// —— 场景 6：顶栏按钮（撤销按钮可用性与点击） ——
await send('画一个圆')
const btnState = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.history-btn')]
  return { undoDisabled: btns[0]?.disabled, redoDisabled: btns[1]?.disabled }
})
console.log(
  `${!btnState.undoDisabled && btnState.redoDisabled ? '✅' : '❌'} 按钮态：撤销可用、重做置灰 -> ${JSON.stringify(btnState)}`
)
if (btnState.undoDisabled || !btnState.redoDisabled) failures++

await page.click('.history-btn') // 点击撤销按钮
await new Promise((r) => setTimeout(r, 600))
await expect('点击撤销按钮生效', (s) => s.nodes.length === 0 && s.feedback.includes('已撤销'))

// —— 场景 7：复合指令中混入 undo（feat/16 隔离修复）——
// 经 JSON 通道注入 [画圆, 撤销, 画方]：撤销不再与绘制共用一次快照事务，
// 应按 undo 边界切段——画圆→撤销(回退空)→画方，最终只剩方块。
await send('清空画布')
await send('确认')
await send(
  '[{"action":"draw","shape":"circle","props":{"color":"#e53935"}},{"action":"undo"},{"action":"draw","shape":"rect","props":{"color":"#1e88e5"}}]'
)
await expect(
  '复合内 undo 隔离：最终只剩方块',
  (s) => s.nodes.length === 1 && s.nodes[0].cls === 'Rect' && s.nodes[0].fill === '#1e88e5'
)
await send('撤销')
await expect('撤销移除方块（栈顺序正确）', (s) => s.nodes.length === 0 && s.feedback.includes('已撤销'))

await page.screenshot({ path: 'scripts/e2e-undo.png' })
await browser.close()

console.log(failures === 0 ? '\n全部断言通过 🎉' : `\n${failures} 个断言失败`)
process.exit(failures === 0 ? 0 : 1)
