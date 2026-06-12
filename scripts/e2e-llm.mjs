/**
 * 慢路径（LLM 通道）端到端验证：拦截 DeepSeek API 请求并返回模拟响应，
 * 验证「规则未命中 → LLM → 追问面板 → 回答续话 → 拆解执行」完整闭环。
 * 不需要真实 API Key。前置：npm run dev 已在 5173 端口运行。
 */
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const ASK_REPLY = { ask: '想画多大的小人？画在画布中间可以吗？' }
const COMMANDS_REPLY = {
  commands: [
    { action: 'draw', shape: 'circle', props: { color: '#212121', size: 25, position: { fx: 0.5, fy: 0.28 } } },
    { action: 'draw', shape: 'line', props: { color: '#212121', from: { fx: 0.5, fy: 0.33 }, to: { fx: 0.5, fy: 0.55 } } },
    { action: 'draw', shape: 'line', props: { color: '#212121', from: { fx: 0.42, fy: 0.42 }, to: { fx: 0.58, fy: 0.42 } } },
    { action: 'draw', shape: 'line', props: { color: '#212121', from: { fx: 0.5, fy: 0.55 }, to: { fx: 0.44, fy: 0.7 } } },
    { action: 'draw', shape: 'line', props: { color: '#212121', from: { fx: 0.5, fy: 0.55 }, to: { fx: 0.56, fy: 0.7 } } },
  ],
}

let llmCalls = 0

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new' })
const page = await browser.newPage()
await page.evaluateOnNewDocument(() => localStorage.setItem('sonink.deepseek_key', 'sk-e2e-mock'))
await page.setRequestInterception(true)
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
}

page.on('request', (req) => {
  if (req.url().includes('api.deepseek.com')) {
    if (req.method() === 'OPTIONS') {
      req.respond({ status: 204, headers: CORS_HEADERS })
      return
    }
    llmCalls++
    const body = JSON.parse(req.postData() ?? '{}')
    const hasContext = body.messages?.some((m) => m.role === 'assistant')
    const reply = hasContext ? COMMANDS_REPLY : ASK_REPLY
    console.log(`[mock-llm] 第 ${llmCalls} 次调用，消息数 ${body.messages?.length}，返回 ${hasContext ? 'commands' : 'ask'}`)
    req.respond({
      status: 200,
      headers: CORS_HEADERS,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }),
    })
    return
  }
  req.continue()
})

await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
await page.waitForSelector('.debug-input input')

async function send(text) {
  await page.type('.debug-input input', text)
  await page.keyboard.press('Enter')
  await new Promise((r) => setTimeout(r, 600))
}

async function dump(label) {
  const state = await page.evaluate(() => ({
    ask: document.querySelector('.ask-question')?.textContent ?? null,
    feedback: document.querySelector('.feedback')?.textContent ?? '(无)',
    nodes: window.__sonink.mainLayer.getChildren().map((n) => n.className),
  }))
  console.log(`\n=== ${label} ===`)
  console.log('追问面板:', state.ask)
  console.log('反馈:', state.feedback)
  console.log('主层节点:', JSON.stringify(state.nodes))
}

await send('画一个人')
await dump('输入: 画一个人（规则必然未命中 → LLM → 应弹出追问）')

await send('中等大小，画中间就行')
await new Promise((r) => setTimeout(r, 800))
await dump('回答追问后（应画出 1 圆 + 4 线的火柴人）')

await page.screenshot({ path: 'scripts/e2e-llm.png' })
await browser.close()
console.log(`\nLLM 共调用 ${llmCalls} 次（预期 2）；截图 scripts/e2e-llm.png`)
