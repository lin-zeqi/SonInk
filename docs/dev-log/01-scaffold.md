# 开发记录 #01 — 项目脚手架与画布初始化

- **日期**：2026-06-12
- **分支**：`feat/01-scaffold`
- **对应路线图**：PR #1（docs/design.md §7）

## 做了什么

1. **项目脚手架**：手动搭建 Vue 3 + Vite 工程（未用 create-vite 模板，避免引入演示用冗余代码），引入依赖：
   - `vue` / `vite` / `@vitejs/plugin-vue` — 框架与构建
   - `konva` — 画布渲染
   - `pinia` — 状态管理（本 PR 仅完成挂载，后续 PR 使用）
2. **画布模块 `src/canvas/stage.js`**：Konva 舞台封装，关键设计：
   - **双层结构**：`mainLayer`（用户图形）与 `feedbackLayer`（选中高亮等反馈元素，`listening: false`）分离，反馈元素不进入对象列表与撤销历史；
   - 暴露 `getCanvasSize()`，供后续执行层做九宫格语义定位的像素换算；
   - 监听窗口 resize 同步画布尺寸。
3. **应用骨架 `src/App.vue`**：顶栏（标题 + 状态提示）+ 全屏画布容器；挂载时在画布上绘制一个红色圆作为渲染链路验证图形（PR #3 执行引擎接入后移除）。
4. **初始 commit**（main 分支）：技术设计文档 `docs/design.md` 与 `.gitignore`。

## 验证方式

```
npm install
npm run dev    # Edge/Chrome 打开 http://localhost:5173
```

预期：页面显示深色顶栏与浅灰画布，画布左上区域有一个红色圆形。

已执行的验证：
- `npm run build` 构建通过（199 modules，无报错）；
- `npm run dev` 启动后 HTTP 200，页面含挂载点。

## 设计决策记录

- **不用 create-vite 模板**：模板自带 HelloWorld 组件、logo 等无关文件，手搭工程文件最少、依赖清单即 README 依赖声明。
- **双层画布**：选中高亮如果和用户图形混在一层，撤销重做和"按特征查找对象"都要过滤反馈元素，分层一次性消除这类问题。

## 下一步

PR #2：Web Speech API 接入 + 实时字幕 + 聆听状态指示。**同时完成设计文档 §6.1 要求的 Edge 真机验证**（中文流式识别连跑 10 分钟），决定是否触发备用方案 B。
