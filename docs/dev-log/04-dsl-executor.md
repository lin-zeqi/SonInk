# 开发记录 #04 — 绘图 DSL 定义与执行引擎

- **日期**：2026-06-12
- **分支**：`feat/04-dsl-executor`
- **对应路线图**：PR #3（编号顺延为 PR #4，因中途插入 TypeScript 迁移）

## 做了什么

1. **`src/dsl/types.ts`** — DSL 类型契约：
   - 本 PR 覆盖 `draw`（circle/rect/triangle/line，含 color/size/position 属性）与
     `clear` 两个 action；select/move/undo 等随对应功能 PR 增量加入；
   - `size` 支持语义值（small/medium/large）或绝对像素；`position` 为九宫格语义值；
     **DSL 层不存在绝对坐标字段**，从类型上杜绝解析层输出坐标。
2. **`src/dsl/schema.ts`** — 运行时校验：
   - TS 类型只约束项目内部代码，LLM 输出与调试 JSON 来自运行时边界之外，必须经
     `validateDsl()` 校验才能进入执行引擎；
   - 支持单条指令或指令数组（复合指令拆解结果），逐字段校验并返回中文错误信息
     （后续直接用于 TTS 反馈）。
3. **`src/dsl/executor.ts`** — 执行引擎：
   - 语义 → 像素的全部换算集中于此：九宫格 → 画布比例坐标；语义大小 → 相对画布
     短边的比例（外接半径统一度量）；
   - 未指定位置时在画布中心附近随机偏移，避免连续绘制完全重叠；
   - 每条指令返回 `ExecResult { ok, message }`，message 为中文反馈语
     （"已画一个圆形"），供字幕与后续 TTS 复用；
   - `executeAll()` 顺序执行指令序列，为 LLM 拆解结果预留。
4. **`src/store/objects.ts`** — 画布对象元数据登记表：id 与 Konva 节点一致，记录
   shape/color/创建序号，供后续"按特征选中"与"刚才那个"指代解析使用。
5. **`src/pipeline.ts`** — 指令处理管道：订阅指令流中枢；当前支持直接输入 DSL JSON
   （调试通道），规则解析在 PR #5 接入同一管道。执行反馈显示在字幕条下方的绿色气泡。
6. 移除 PR #1 的红色验证圆形。

## 验证方式

`npm run dev`，调试输入框粘贴以下 JSON 回车：

```json
{"action":"draw","shape":"circle","props":{"color":"#e53935","size":"large","position":"top-left"}}
```

预期：左上角出现红色大圆，字幕下方反馈"已画一个圆形"。

指令序列（模拟复合指令拆解结果）：

```json
[{"action":"draw","shape":"rect","props":{"color":"#8d6e63","position":"bottom"}},{"action":"draw","shape":"triangle","props":{"color":"#e53935","position":"center"}}]
```

预期：底部棕色方块 + 中部红色三角（"房子"雏形），反馈合并为一条。

异常路径：粘贴 `{"action":"draw","shape":"star"}` → 反馈"指令无效：不支持的图形: star"；
粘贴坏 JSON → "JSON 格式错误"。

`npm run build`（含类型检查）通过。

## 设计决策记录

- **双重校验**：TS 类型管编译期（项目内部），`validateDsl` 管运行时（LLM/外部输入），
  两者共享同一组常量表（SHAPE_TYPES 等），不会漂移。
- **统一外接半径度量**：圆的半径、方的半边长、三角的外接半径用同一个数值语义，
  "大小"在不同图形间感知一致，解析层无需区分。
- **对象元数据与渲染分离**：Konva 节点管渲染，objects store 管语义特征，
  指代消解只查 store，不遍历画布节点。

## 下一步

PR #5：规则解析引擎（快路径）——"画一个红色的圆"这样的自然语言真正生效。
