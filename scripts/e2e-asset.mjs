/**
 * 部件目录 place 指令端到端验证（真浏览器，feat/17）。
 * 前置：npm run dev 已在 5173 端口运行。
 * 证明核心论点：LLM"下单"的部件展开成成组 path 后，依然能用语音整体编辑
 *（放大/移动/删除按 groupName 命中）——即"好看"与"可编辑"兼得。
 * place 指令经 JSON 通道注入（与 LLM 输出同一条校验+执行链路，不需要真 Key）。
 */
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

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

async function send(text, wait = 1100) {
  await page.type('.debug-input input', text)
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, wait))
}

// 主层节点数 + 合并包围盒（证明整体缩放/移动生效）
async function snap() {
  return page.evaluate(() => {
    const nodes = window.__sonink.mainLayer.getChildren()
    if (nodes.length === 0) return { n: 0, box: null }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const node of nodes) {
      const b = node.getClientRect()
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y)
      maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height)
    }
    return { n: nodes.length, box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } }
  })
}

// —— 1. place 下单：房子展开成 2 条 path ——
await send('{"action":"place","asset":"house","position":"center","size":"medium"}', 1600)
const s1 = await snap()
check('place 房子展开为 2 条 path', s1.n === 2, `节点 ${s1.n}`)
const area1 = s1.box ? s1.box.w * s1.box.h : 0

// —— 2. 整体放大：按 groupName 命中，节点数不变、包围盒变大 ——
await send('把房子放大')
const s2 = await snap()
const area2 = s2.box ? s2.box.w * s2.box.h : 0
check('整体放大：节点数仍为 2', s2.n === 2, `节点 ${s2.n}`)
check('整体放大：包围盒变大', area2 > area1 * 1.1, `面积 ${Math.round(area1)} -> ${Math.round(area2)}`)

// —— 3. 整体移动：按 groupName 命中，中心左移 ——
const cx2 = s2.box ? s2.box.x + s2.box.w / 2 : 0
await send('把房子移到左边')
const s3 = await snap()
const cx3 = s3.box ? s3.box.x + s3.box.w / 2 : 0
check('整体移动：节点数仍为 2', s3.n === 2, `节点 ${s3.n}`)
check('整体移动：中心左移', cx3 < cx2 - 20, `中心 x ${Math.round(cx2)} -> ${Math.round(cx3)}`)

// —— 4. 多对象组合场景：再下单一棵树，得到 2 组共 4 节点 ——
await send('{"action":"place","asset":"tree","position":"right","size":"medium"}', 1600)
const s4 = await snap()
check('追加树：共 4 条 path（房子 2 + 树 2）', s4.n === 4, `节点 ${s4.n}`)

// —— 5. 整组删除：只删房子，树保留 ——
await send('删掉房子')
const s5 = await snap()
check('删掉房子：剩树的 2 条 path', s5.n === 2, `节点 ${s5.n}`)

// —— 6. 着色 place：person 整体红 ——
await send('清空画布')
await send('确认')
await send('{"action":"place","asset":"person","position":"center","color":"#e53935"}', 1900)
const reds = await page.evaluate(() =>
  window.__sonink.mainLayer.getChildren().map((n) => n.stroke?.() ?? null)
)
check('着色 place：6 条笔画全红', reds.length === 6 && reds.every((c) => c === '#e53935'), JSON.stringify(reds))

await page.screenshot({ path: 'scripts/e2e-asset.png' })
await browser.close()

console.log(failures === 0 ? '\n全部断言通过 🎉' : `\n${failures} 个断言失败`)
process.exit(failures === 0 ? 0 : 1)
