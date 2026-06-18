# 开发记录 #17 — 部件目录 + LLM 排版器（阶段 1 最小闭环）

- **日期**：2026-06-18
- **分支**：`feat/17-asset-composer`（从 main 切出，独立于未合并的 feat/16）
- **背景**：探索"让 AI 画得更好看"的架构。结论是不走"生图→勾勒"运行时路径
  （会丢掉语义可编辑性，与"语音可编辑画布"定位冲突），改为
  **矢量部件库 + LLM 当排版师**：LLM 对已知对象只"下单"（挑部件 + 摆放 + 缩放 + 配色），
  画面质量由预制美术兜底，且展开后天然可整体编辑。本 PR 是验证该架构核心假设的最小闭环。

## 做了什么

1. **DSL 新增 `place` 指令**（`dsl/types.ts`）：`{action:'place', asset, position?, size?, color?}`。
   asset 引用部件目录 id，position 支持九宫格或比例坐标。
2. **部件目录**（复活 `parser/templates.ts`）：原本脱钩的 6 个模板（人/房子/树/太阳/雪人/笑脸）
   重做为目录资产——给每条笔画补 `part` 标签（头/屋顶/树冠…），导出 `ASSETS` 元数据、
   `isAssetId`、`expandAsset(id, center, scale, color?)`（纯函数，不接触画布）。房子拆成
   墙身 + 屋顶 2 笔以支持部件级编辑。
3. **执行展开**（`dsl/executor.ts`）：`executeAll` 入口先跑 `expandPlaceCommands`，把 place
   展开成成组 path draw，再走原有 groupId 分配 / 快照 / 逐笔描画——与 LLM 直出 path、
   规则引擎基础图形**完全同构**，`resolveTarget`/`execMove`/`execResize`/`execDelete` 一行不改即可整体编辑。
4. **schema 校验**（`dsl/schema.ts`）：`place` 校验 asset 必须是已知 id、position/size/color 合法。
5. **提示词**（`llm/prompt.ts`）：置顶"部件目录（优先使用）"段，列出 id/标签/部件 + place 格式，
   指示"目录内对象直接下单、目录外才回退 path 手绘"。DSL 变更已同步提示词。

## 验证方式

```
npm run typecheck                  # 通过
npx tsx scripts/parser-smoke.ts    # 53 OK / 0 FAIL
```

parser-smoke 新增两组断言（纯函数，无需浏览器）：
- **expandAsset 部件展开**：6 个资产展开数正确、全部为 path、groupName=label、每条带 part；
  未知 id 返回 null；整体着色生效。
- **place schema 校验**：合法 place 接受，未知 asset / 非法九宫格 / 非 hex 颜色 / 非法大小被拒。

新增 `scripts/e2e-asset.mjs`（**待本机真实 Edge 实跑**）：经 JSON 通道注入 place（与 LLM 输出同链路），
证明展开后整体可编辑——放大 / 移到左边 / 删除均按 groupName 命中、节点数自洽，
多对象组合（房子 + 树）各自独立 group，着色 place 6 笔全红。

## 遗留事项 / 下一步（验证通过后再定）

- [ ] `e2e-asset.mjs` 本机实跑确认整体编辑闭环。
- [ ] 真实 LLM 实测：模型是否稳定选对 asset id、目录外对象正确回退 path。
- [ ] 阶段 2：部件检索层（embedding/标签）、离线"生图→矢量化"资产管线扩库、多套笔法/配色。
- [ ] 决策：种子库视觉质量是否够说服力，要不要正式投入扩库。
