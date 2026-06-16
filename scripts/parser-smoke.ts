/**
 * 规则解析引擎冒烟测试：node 环境直接跑，不依赖浏览器。
 * 用法：npx tsx scripts/parser-smoke.ts
 */
import { isShapeMissing, parseBrushStep, parseCommand, tryExpandTemplate } from '../src/parser/rules'

const cases: Array<[string, string]> = [
  ['画一个圆', '基础'],
  ['画一个红色的圆', '颜色'],
  ['帮我画个大大的蓝色正方形', '语气词+大小+颜色'],
  ['在左上角画一个三角形', '位置'],
  ['来个圈圈', '同义词'],
  ['画一条线', '直线'],
  ['画一个半径五十的绿色圆形', '中文数字绝对大小'],
  ['画个大小80的方块', '阿拉伯数字绝对大小'],
  ['整一个紫色的三角，放在右下角', '口语动词+标点'],
  ['清空画布', '清空'],
  ['嗯，那个，画一个黄色的小圆', '犹豫词'],
  // —— 选中 / 移动 / 删除（PR #6）——
  ['选中那个红色的圆', '特征选中'],
  ['选中刚才那个', '指代last'],
  ['选中', '无修饰默认last'],
  ['往右移一点', '相对移动+小步长'],
  ['向上挪五十', '中文数字步长'],
  ['把它放到中间', '代词+绝对位置'],
  ['把三角移到左上角', '特征+绝对位置'],
  ['把它删掉', '代词删除'],
  ['删掉那个蓝色的方块', '特征删除'],
  ['画一个圆放在左上角', '绘制优先于移动'],
  // —— 连接词拆分 ——
  ['画一个红色的圆和一个蓝色的圆', '"和"拆分+动词承接'],
  ['画一个圆，然后在右下角画一个红色的方块', '"然后"拆分'],
  ['清空画布然后画一个三角形', '清空+绘制'],
  ['生成一个绿色的圆', '生成动词'],
  // —— 容错强化（PR #12）——
  ['搞个三角形', '口语动词-搞'],
  ['弄一个紫色的球', '口语动词-弄+球'],
  ['在圆的右边画一个方形', '相对定位'],
  ['在红色的圆左边画个蓝色三角', '带颜色锚点的相对定位'],
  ['在方块上面加一条线', '相对定位-上方'],
  // —— 缩放（PR #10）——
  ['把它放大', '代词缩放'],
  ['放大一倍', '倍数'],
  ['把那个红色的圆缩小一点', '特征+小幅缩小'],
  ['缩小一半', '一半'],
  ['大一点', '裸语义缩放'],
  ['放大到半径五十', '绝对大小'],
  ['画一个大一点的圆', '绘制优先于缩放'],
  ['把它放到中间', '移动不被缩放误中'],
  // —— 文本 / 改色 / 导出 / 回放（PR #13；语义模板由下方 tryExpandTemplate 组覆盖，
  //     parseCommand 本身不接管模板，故此处不列）——
  ['写上你好', '文本标注'],
  ['在中间写上完成', '文本+位置'],
  ['把这个圆变成蓝色', '改色-代词'],
  ['把红色的圆涂成绿色', '改色-前后颜色区分'],
  ['保存图片', '导出'],
  ['回放操作', '回放'],
  // —— 撤销 / 重做（PR #9）——
  ['撤销', '撤销'],
  ['撤回刚才的操作', '撤销同义词'],
  ['回到上一步', '撤销-上一步'],
  ['重做', '重做'],
  ['取消撤销', '重做先于撤销判定'],
  ['今天天气不错', '应当不命中'],
]

for (const [input, label] of cases) {
  const result = parseCommand(input)
  const output = result.matched ? JSON.stringify(result.commands) : 'MISS'
  console.log(`[${label}] "${input}"\n  -> ${output}`)
}

// 缺图形追问判定（PR #12）：true=应追问，false=交给 LLM 或正常解析
const clarifyCases: Array<[string, boolean]> = [
  ['画一个', true],
  ['画那个那个那个', true],
  ['帮我画个东西', true],
  ['画一个人', false], // 有语义内容，应交给 LLM
  ['画一个圆', false], // 正常命中
  ['今天天气不错', false],
]
console.log('\n—— isShapeMissing ——')
for (const [input, expected] of clarifyCases) {
  const actual = isShapeMissing(input)
  console.log(`${actual === expected ? 'OK ' : 'FAIL'} "${input}" -> ${actual}（预期 ${expected}）`)
}

// 笔刷方向解析
const brushCases: Array<[string, string]> = [
  ['开始画线', 'start'],
  ['开始画', 'start'],
  ['自由画', 'start'],
  ['停', 'stop'],
  ['结束', 'stop'],
  ['画完了', 'stop'],
  ['好了', 'stop'],
  ['算了', 'cancel'],
  ['取消', 'cancel'],
  ['不要了', 'cancel'],
  ['往右', 'move'],
  ['往左', 'move'],
  ['往上', 'move'],
  ['往下', 'move'],
  ['往右移一点', 'move'],
  ['往下移很多', 'move'],
  ['往右上', 'move'],
  ['往左下移', 'move'],
  ['今天天气不错', 'null'],
]
console.log('\n—— parseBrushStep ——')
for (const [input, expected] of brushCases) {
  const result = parseBrushStep(input)
  const actual = result?.kind ?? 'null'
  const ok = actual === expected
  console.log(`${ok ? 'OK ' : 'FAIL'} "${input}" -> ${actual}${!ok ? `（预期 ${expected}）` : ''}${result && result.kind === 'move' ? ` dfx=${result.dfx.toFixed(3)} dfy=${result.dfy.toFixed(3)}` : ''}`)
}

// 指代消解 target 解析（feat/15）：空间/序数/比较限定词应被解析进 target，
// 且与特征（shape/color）并存。过滤逻辑（executor.applyPostFilter）需画布，由 e2e 覆盖。
const refCases: Array<[string, Record<string, unknown>]> = [
  ['选中左边那个', { spatial: 'leftmost' }],
  ['把最右边的变成蓝色', { spatial: 'rightmost' }],
  ['放大第二个', { ordinal: 2 }],
  ['删掉最大的', { comparison: 'largest' }],
  ['选中最小的圆', { shape: 'circle', comparison: 'smallest' }],
  ['选中第二个圆', { shape: 'circle', ordinal: 2 }],
]
console.log('\n—— 指代消解 target ——')
for (const [input, expected] of refCases) {
  const r = parseCommand(input)
  const target = (r.matched && r.commands[0] ? (r.commands[0] as { target?: Record<string, unknown> }).target : undefined) ?? {}
  const ok = Object.entries(expected).every(([k, v]) => target[k] === v)
  console.log(`${ok ? 'OK ' : 'FAIL'} "${input}" -> ${JSON.stringify(target)}${ok ? '' : `（预期含 ${JSON.stringify(expected)}）`}`)
}

// 语义模板展开（feat/14 起为多 path 组合，非单 path）：仅 pipeline 在无 LLM 时调用。
// 锁定命令数与"全部为 path draw"，模板改动需同步更新预期值。
const tplCases: Array<[string, number | null]> = [
  ['画一个太阳', 9], // 圆轮廓 1 + 光线 8
  ['在左上角画一棵树', 2],
  ['画一个小人', 6], // 头 + 身 + 四肢
  ['画一个大大的笑脸', 4],
  ['画一个房子，左边加一棵树，右上角有太阳', 12], // 复合：3 模板拆分承接
  ['画一个圆', null], // 基础图形不应被模板接管
]
console.log('\n—— tryExpandTemplate ——')
for (const [input, expected] of tplCases) {
  const r = tryExpandTemplate(input)
  const count = r.matched ? r.commands.length : null
  const allPath = r.matched && r.commands.every((c) => {
    const cmd = c as { action?: string; shape?: string }
    return cmd.action === 'draw' && cmd.shape === 'path'
  })
  const ok = count === expected && (expected === null || allPath)
  console.log(`${ok ? 'OK ' : 'FAIL'} "${input}" -> ${count === null ? 'MISS' : `${count} path`}${ok ? '' : `（预期 ${expected === null ? 'MISS' : expected + ' path'}）`}`)
}
