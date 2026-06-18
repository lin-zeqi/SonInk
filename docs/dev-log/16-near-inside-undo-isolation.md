# 开发记录 #16 — relativeTo near/inside、undo 隔离、压测脚本与文档收尾

- **日期**：2026-06-18
- **分支**：`feat/16-near-inside-undo-isolation`
- **背景**：PR #1–#15 已全部合并到 main，核心功能完成。本轮做收尾：补 TODO 列为
  「未做」的 relativeTo 增量、修一个用户可见的历史栈缺陷、补两项缺失的验证脚本、
  同步过时文档。范围经与维护者确认（跳过两个明确「设计取舍/死代码」的低 ROI 缺陷）。

## 做了什么

1. **relativeTo 新增 near / inside**（能力 #15a 扩展，TODO 列为未做）：
   - 类型：`RelativeRelation` 与 `RELATIVE_RELATIONS` 加 `near`/`inside`（`dsl/types.ts`）。
     schema 校验基于 `RELATIVE_RELATIONS.includes()`，新关系自动获准，无需改 `schema.ts`。
   - 解析：`RELATIVE_PATTERN` 与 `RELATION_MAP` 加后置方位词——旁边/附近→near，
     里面/里头/内部→inside（`parser/rules.ts`）；走与 left/right 同一条单锚点链路。
   - 执行：`resolveRelativePosition` 加两分支（`dsl/executor.ts`）——near 紧邻锚点右侧、
     不重叠；inside 取锚点包围盒中心，容器放不下新对象则报「目标容器太小，放不下」。
   - **关键决策**：两者均用**固定方位**而非随机坐标。executor 在快照/回放路径上，
     随机会让同一指令两次结果不同，破坏 undo/回放可复现性。
2. **修复：LLM 复合指令中 undo/redo 历史栈隔离**（TODO 已知缺陷）：
   `executeAll` 改为按 undo/redo 边界**切段**，每段（连续的非 undo/redo 指令）独立成
   一次快照事务走抽出的 `runSegment()`，undo/redo 在段间单独 `execute`、不进任何事务。
   原缺陷是整批共用一次 `before` 快照、`commit` 在循环末尾，导致 undo 在快照入栈前
   就操作了栈，顺序错乱。**整批无 undo/redo 时只产生一段，行为与改前完全一致。**
3. **新增两个 e2e 脚本**（补 TODO 缺的收尾验证）：
   - `scripts/e2e-perf-stress.mjs`：注入 60 个基础图形，断言全部落地，再连续撤销 50 次/
     重做/回放不崩溃且节点数自洽，附耗时采样（阈值宽松，只防崩溃与数量丢失）。
   - `scripts/e2e-multi-res.mjs`：三档视口（1920×1080 / 1366×768 / 768×1024）下断言
     九宫格落点 fx/fy 比例跨分辨率一致、缩放保持中心比例、各分辨率导出有效 PNG。
   - `e2e-undo.mjs` 加场景 7：经 JSON 通道注入 `[画圆, 撤销, 画方]`，断言最终只剩方块、
     再撤销移除方块——验证隔离修复。
4. **文档同步**：`docs/TODO.md` 更正过时的「工程收尾」段（分支早已合并）、标注两个
   不修缺陷的评审决议、勾掉 undo 隔离；`CLAUDE.md` 补 near/inside 说明与新脚本/npm 命令；
   `package.json` 加 `npm run smoke` 与 `npm run e2e` 串跑脚本。

## 验证方式

```
npm run typecheck                      # 通过（strict + noUnusedLocals）
npm run smoke                          # parser-smoke 0 FAIL，含新增 relativeTo relation 断言组
node --check scripts/e2e-*.mjs         # 新/改脚本语法通过
```

`parser-smoke.ts` 新增「relativeTo relation」断言组 6 例（right-of/between/near×2/inside×2）
全 OK，原有用例零回归。新两个 e2e 与 `e2e-undo` 场景 7 依赖真实 Edge + dev server，
需本机 `npm run dev` 后 `npm run e2e` 实跑确认（本环境无法驱动浏览器）。

## 遗留事项

- [ ] `e2e-perf-stress.mjs` / `e2e-multi-res.mjs` / `e2e-undo` 场景 7 待本机实跑。
- [~] 连续移动合并撤销、模板非 3:2 变形：**经评审决定不修**（设计取舍 / 死代码）。

## 下一步

本机跑通新 e2e 后手动建 PR #16（四段描述），合并到 main。
