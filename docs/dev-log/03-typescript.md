# 开发记录 #03 — 迁移到 TypeScript

- **日期**：2026-06-12
- **分支**：`feat/03-typescript`
- **对应路线图**：计划外追加（在 PR #3 DSL 开发前完成，时机最优）

## 为什么现在迁移

- 下一步的绘图 DSL 是解析器与执行引擎之间的唯一契约，用 TS 类型定义后两端获得
  编译期约束，schema 不一致直接编不过，而不是运行时静默出错；
- 当前仅 6 个源文件，迁移成本接近零；再晚成本随代码量线性上涨。

## 做了什么

1. 引入 `typescript` + `vue-tsc`，新增 `tsconfig.json`（strict 模式，含
   `noUnusedLocals` / `noUnusedParameters`）；
2. 全部源文件 `.js → .ts`，三个 `.vue` 组件改为 `<script setup lang="ts">`，
   `vite.config.js → vite.config.ts`；
3. 关键类型补充：
   - `src/types/speech.d.ts`：SpeechRecognition 尚未进入 TS 内置 DOM 类型，
     按 W3C 规范手动声明项目用到的最小子集；
   - `recognizer.ts` 导出 `Recognizer` / `RecognizerCallbacks` / `ListenState`
     接口——这就是备用方案 B 的替换契约，从"文档约定"升级为"编译期约束"；
   - `command.ts` 导出 `CommandEntry` / `CommandSource`；
   - `stage.ts` 增加 `assertInited` 守卫，未初始化调用直接抛错而非返回 null；
4. `npm run build` 改为 `vue-tsc --noEmit && vite build`，类型错误会使构建失败；
   另增 `npm run typecheck` 单独命令。

## 验证方式

- `npm run build`：类型检查 + 构建一次通过（208 modules）；
- `npm run dev`：功能与 PR #2 完全一致（纯迁移，无行为变更）——调试输入框回车后
  字幕条显示文本。

## 下一步

PR #4（原 #3 顺延编号）：绘图 DSL 类型定义 + 执行引擎骨架。
