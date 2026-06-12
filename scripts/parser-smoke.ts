/**
 * 规则解析引擎冒烟测试：node 环境直接跑，不依赖浏览器。
 * 用法：npx tsx scripts/parser-smoke.ts
 */
import { parseCommand } from '../src/parser/rules'

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
  ['今天天气不错', '应当不命中'],
  ['把它删掉', '应当不命中（删除是后续PR）'],
]

for (const [input, label] of cases) {
  const result = parseCommand(input)
  const output = result.matched ? JSON.stringify(result.commands) : 'MISS'
  console.log(`[${label}] "${input}"\n  -> ${output}`)
}
