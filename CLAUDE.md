# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Run/Test

```bash
npm install          # Install dependencies (Node 18+)
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # Typecheck (vue-tsc --noEmit) + Vite production build
npm run typecheck    # Typecheck only (vue-tsc --noEmit)
npm run preview      # Preview production build locally
npm run smoke        # Parser smoke test (npx tsx scripts/parser-smoke.ts, no browser needed)
npm run e2e          # Run all self-asserting e2e scripts in sequence (needs `npm run dev` in another terminal)
```

`parser-smoke.ts` exercises the rule engine (`parseCommand`, `isShapeMissing`, `parseBrushStep`, `tryExpandTemplate`, advanced-reference target parsing, clause splitting) directly in Node.js — no browser, no Konva, no LLM. The `isShapeMissing` / `parseBrushStep` / advanced-reference / `relativeTo relation` / `tryExpandTemplate` groups carry OK/FAIL assertions; the main `parseCommand` group only prints output for eyeballing. Run it after any parser/lexicon/template change to catch regressions instantly. Requires `tsx` (TypeScript execute); available via `npx` without a local install.

E2E scripts use `puppeteer-core` driving local Edge. Run `npm run dev` first, then in another terminal:

```bash
node scripts/e2e-perf-stress.mjs     # PR #16: 60-object draw/undo/redo/replay stress
node scripts/e2e-multi-res.mjs       # PR #16: three viewports — fraction consistency / resize-keeps-center / export
node scripts/e2e-canvas-power.mjs    # PR #13: templates / text / style / export / replay / drag
node scripts/e2e-robust.mjs          # PR #12: relative positioning / shape-missing追问 / colloquial verbs
node scripts/e2e-tts.mjs             # PR #11: TTS feedback / clear confirmation
node scripts/e2e-resize-move.mjs     # PR #10: resize / move with animations
node scripts/e2e-undo.mjs            # PR #9: undo / redo transaction snapshots
node scripts/e2e-llm.mjs             # PR #8: LLM channel (mock)
node scripts/e2e-repro.mjs           # PR #6: select / move / delete / clause split
node scripts/e2e-anim.mjs            # PR #7: progressive draw animation
```

Each e2e script is self-asserting: it injects commands through the live app, then verifies Konva node count / object-registry state (and saves a screenshot) for the feature it targets — see "E2E Testing Pattern" below.

## Architecture Overview

**SonInk** is a voice-controlled drawing app: users speak, the system draws on a Konva.js canvas. Purely frontend — no backend. Vue 3 + TypeScript 6.0 + Pinia.

### Source Tree

```
src/
  main.ts                  # App entry: createApp + Pinia + mount
  App.vue                  # Root component: canvas init, pipeline, keyboard shortcuts, TTS/ASR coordination
  pipeline.ts              # Central orchestrator (see below)
  components/
    CaptionBar.vue         # Real-time subtitle bar (interim + final text + feedback)
    DebugInput.vue         # Text fallback input for dev/testing
    AskPanel.vue           # Unified overlay for LLM追问 / shape-missing / clear-confirmation
    HistoryPanel.vue       # Slide-out operation history list
    SettingsPanel.vue      # LLM provider + API key config
  parser/
    rules.ts               # Fast-path regex rule engine (~50 patterns)
    lexicon.ts             # Synonym tables (shape/color/position/size) + lookup/normalize helpers
    templates.ts           # Semantic templates (太阳/房子/树/雪人/小人/笑脸 → path commands)
  dsl/
    types.ts               # All command types, semantic value types, constant tables
    schema.ts              # Runtime validation of DSL (rejects pixel coords, enforces hex colors, etc.)
    executor.ts            # Semantic→pixel conversion, Konva node creation, executeAll transaction wrapper
  llm/
    client.ts              # OpenAI-compatible /chat/completions fetch wrapper
    prompt.ts              # System prompt builder with canvas memory injection
  canvas/
    stage.ts               # Three-layer Konva setup + window resize handler + debug hook
    draw-animation.ts      # revealShape (basic shapes) + revealStrokes (path stroke-by-stroke)
    highlight.ts           # Selection highlight management, grouped by groupId
    drag-history.ts        # Mouse drag → undo history entries
  history/
    snapshot.ts            # Whole-state snapshot capture/restore + pendingAttrs for mid-animation safety
  speech/
    recognizer.ts          # Web Speech API wrapper (onInterim/onFinal callbacks)
    tts.ts                 # TTS broadcast with ASR pause coordination
  store/
    command.ts             # Command stream hub: interim/final text, feedback, listen state
    objects.ts             # Canvas object registry (id, shape, color, seq, groupId/groupName/part)
    assistant.ts           # LLM conversation state: thinking, ask/clarify/confirm dialogs
    history.ts             # Undo/redo stack of snapshots, replay state
    settings.ts            # LLM provider presets (DeepSeek/Kimi/GLM/Qwen/custom) persisted to localStorage
  types/
    env.d.ts               # Vite client type declarations
    speech.d.ts            # Web Speech API type declarations
```

### Key Design Documents

- `docs/design.md` — authoritative architecture spec: every module, its rationale, the capability roadmap (P0/P1/P2), test coverage mapping, risk analysis, and PR plan. Read this first when picking up the project.
- `docs/TODO.md` — active incomplete-items and known-defects tracker. Covers remaining features, verified real-hardware/real-AI test results, and known small defects that don't block demo.

### Central Data Flow

```
Microphone → recognizer.ts → pipeline.ts → parser/rules.ts (fast, ~50ms)
                                     ↘ llm/client.ts (slow, ~1-2s)
                                              ↓
                                         dsl/schema.ts (validate)
                                              ↓
                                         dsl/executor.ts → Konva canvas
```

`pipeline.ts` is the **orchestrator**: it subscribes to the Pinia command store, routes each utterance through the dual-path parser, validates DSL output, handles confirmation/clarify/ask state machines, and feeds results to the executor and TTS.

### Dual-Path Parsing (the most important architectural decision)

1. **Fast path** (`parser/rules.ts`): Regex-based intent matching powered by synonym tables in `parser/lexicon.ts` (SHAPE_SYNONYMS, COLOR_SYNONYMS, POSITION_SYNONYMS, SIZE_SYNONYMS — each maps multiple Chinese terms to canonical values via `lookup()` and `normalize()`). Handles ~50 simple command patterns: draw, select, move, resize, delete, undo, style, clear, export, replay, text, background ("天空背景变为蓝色" → `background` DSL command), and free-brush direction steps (`parseBrushStep` — start/step/stop/cancel). Also handles clause splitting (逗号/然后/接着/还有) for compound commands that don't need an LLM. The rule engine is purely functional (`ParseResult` return type) — it doesn't touch the canvas or stores directly.

2. **Slow path** (`llm/client.ts` + `llm/prompt.ts`): OpenAI-compatible chat/completions call. Used when the rule engine misses or detects it can't handle the utterance. The prompt teaches the LLM to output `path`-based draw commands with `groupName` for multi-part objects — not discrete shapes.

The rule engine has one local fallback _before_ hitting LLM:
- **Shape-missing追问** (`isShapeMissing()`): "画一个" with no shape word → asks "想画什么图形?" locally, saving an LLM call.

**Drawing routing — basic shapes local, everything else LLM** (current behavior): Only the basic shapes the rule engine matches directly (圆/矩形/三角/直线/文字, plus free-brush paths) are drawn locally. **Every other draw intent — 太阳/房子/汽车 and any complex/semantic object — goes to the LLM.** If no API key is configured, those utterances return a "请先配置 AI" message instead of drawing (no offline template fallback). `parseCommand` itself returns MISS for template words like "太阳", so they flow straight to `runSlowPath`.

> The local template engine (`parser/templates.ts` `expandTemplate` / `tryExpandTemplate`) is **no longer wired into the pipeline** — it lingers only as a library function (still exercised by `parser-smoke.ts`). `lookupTemplate` is still used by `rules.ts` to recognize template words as a `groupName` for editing existing objects ("把太阳移到左边").

#### Pipeline State Machine (the most complex orchestration)

`pipeline.ts` `handleText()` checks these states in priority order on every input:

1. **Replay guard**: If `history.replaying`, all input is rejected ("回放进行中").
2. **JSON passthrough**: If text starts with `{` or `[`, parse as raw DSL JSON (debug channel).
3. **Confirm wait**: If `assistant.confirm` is set (clear-canvas confirmation pending), the input is tested against CONFIRM_YES/CANCEL patterns (cancel also fires on any text containing 不). If neither matches, it falls through as a new command (abandoning the pending clear).
4. **Clarify wait**: If `assistant.clarify` is set (shape-missing追问), the input is prepended with "画" and re-parsed as a draw command. Cancel works too.
5. **Ask wait**: If `assistant.ask` is set (LLM asked a follow-up question), the input is treated as a continuation of the LLM conversation (`runSlowPath(text, true)`).
6. **Brush active**: If `brushActive` (free-brush mode entered), input is parsed by `parseBrushStep()` only — direction words (`往右/往下/往左/往上` and diagonals/step-size) extend the live stroke, `停` finalizes via `finishBrush()` → `executeAll`, `取消` aborts. All other commands are blocked while brushing.
7. **Brush start**: `parseBrushStep(text)` with `kind:'start'` (e.g. "开始画线") enters brush mode via `startBrush()`.
8. **Rule match**: Try `parseCommand(text)`. If matched, execute directly.
9. **Shape-missing check**: If the text looks like a draw intent without a shape word, enter the clarify state.
10. **No-LLM guard**: If no API key is configured, return a "请先配置 AI" message (basic shapes already matched at step 8; anything reaching here needs the LLM).
11. **LLM slow path**: Call `runSlowPath(text, false)` — all non-basic draw intents (太阳/房子/汽车/…) land here.

The free-brush state machine lives entirely in `pipeline.ts` module-scope (`brushActive`, `brushLine`, `brushPoints`, `brushColor`): a temporary `Konva.Line` is mutated in real time on each direction step for live preview, then on `停` it is destroyed and re-created as a normal `path` draw command through `executeAll` so it gets the full snapshot/history/stroke-animation treatment.

This state-machine ordering means a single utterance can trigger confirmation, clarification, rule execution, or LLM delegation — and the user never explicitly "switches modes."

### DSL — the Contract Between Parser and Executor

`dsl/types.ts` defines every command type (`DrawCommand`, `MoveCommand`, `ResizeCommand`, `StyleCommand`, etc.) and semantic value types (`SemanticPosition`, `SemanticSize`, `PositionFraction`, `RelativeTo`).

`RelativeTo.relation` supports `left-of`/`right-of`/`above`/`below` (single anchor), `between` (two anchors → midpoint), and (feat/16) `near` (placed adjacent to the right of the anchor) / `inside` (centered within the anchor's bounding box, errors if the anchor is too small to hold the new object). Relation→pixel resolution lives in `resolveRelativePosition` (`dsl/executor.ts`); it uses **fixed** placement (no `Math.random()`) so snapshots/replay stay reproducible. Chinese triggers are post-anchor words in `RELATION_MAP` (`rules.ts`): 旁边/附近→near, 里面/里头/内部→inside. `dsl/schema.ts` validates `relation` against `RELATIVE_RELATIONS`, so new relations are accepted automatically once added to that constant.

Key constraints enforced by `dsl/schema.ts` (runtime validation):
- LLM output MUST be validated through `validateDsl()` before execution — never trust it.
- Positions are **0–1 proportional coordinates** (`fx`, `fy`) or nine-grid semantic labels. Absolute pixel coordinates are rejected. This prevents LLM hallucination of pixel values.
- Colors must be `#hex` format (3–8 hex digits, `/^#[0-9a-fA-F]{3,8}$/`). Named colors like "red" are rejected — the rule engine's `lexicon.ts` converts Chinese color names to hex before they become DSL.
- Every action has required fields enforced: `draw` requires valid `shape` (and `text` for text shapes, `points` for path shapes); `move` requires `direction`/`position`/`relativeTo`; `resize` requires `scale` or `size`; `style` requires `color`.
- Path `points` arrays must have at least 2 entries; each point must be a valid `{fx, fy}` fraction. Optional `tension` (0–1) renders the path as a smoothed curve instead of straight segments (used for round forms with few points).
- All semantic→pixel conversion happens in `dsl/executor.ts` only.

### Path-Based Composition (feat/14)

The most significant architectural shift: **semantic objects are no longer assembled from discrete primitives** (circle + triangle + line). Instead they are drawn as `path` shapes — each a `Konva.Line` over proportional coordinate points `[{fx, fy}, ...]`. A composite object is **several paths sharing one `groupName`** (see the group model below), one stroke per meaningful part.

This applies to both:
- **Local templates** (`parser/templates.ts`): 太阳/房子/树/雪人/小人/笑脸 are each expanded to **several `path` draws sharing one `groupName`**, one stroke per meaningful part (stickman = head + body + 4 limbs = 6 strokes; 太阳 = circle outline + 8 rays = 9).
- **LLM output** (`llm/prompt.ts`): The prompt teaches the model to compose complex objects as **multiple paths sharing a `groupName`** — one path per part (car body, wheels, windows), all bound by the same `groupName`. Closed paths should include `fill` for proper coloring; the fill fades in after the stroke animation completes.

**groupName / groupId / part model**:
- `groupName`: A semantic label like "汽车", "房子", "人". Multiple paths with the same `groupName` in one batch get the same `groupId` (auto-assigned by `executeAll`).
- `groupId`: System-generated unique ID linking all parts of a composite object. Used for group-level operations (move, resize, delete the whole group).
- `part`: Optional role label like "屋顶", "车轮" — enables fine-grained targeting ("删掉房子的屋顶" → `groupName:"房子"` + `part:"屋顶"`).
- `resolveTarget()` handles `groupName`/`part` lookups before individual feature matching.

**Advanced reference resolution** (feat/15, in `dsl/executor.ts`): When a `target` carries a `spatial`, `ordinal`, or `comparison` qualifier (parsed in `rules.ts` from SPATIAL_QUALIFIERS / ORDINAL_PATTERN / comparison terms), `resolveTarget` widens the candidate set to *all* objects, then filters down to one:
- `spatial` ("左边那个" → `leftmost`/`rightmost`/`topmost`/`bottommost`/`center`): scores each node's bounding-box center and keeps the extreme.
- `ordinal` ("第二个"): sorts by `seq` (creation order, 1-based) and picks the nth.
- `comparison` ("最大的"/"最小的" → `largest`/`smallest`): sorts by bounding-box area.

These run in `applyPostFilter` after feature matching (shape/color). **Caveat**: if feature matching already narrowed to ≤1 object, the filter *discards* that match set and widens back to all objects (so "选中左边那个" works with no shape word). Consequence: "最大的红色的圆" only respects the color/shape constraint when ≥2 red circles exist — with a single red circle, the constraint is dropped and the largest object overall is chosen. A `ref` pronoun (它/这个/那个) skips post-filtering entirely.

**Group-level operations**: `execMove` and `execResize` no longer block on multi-match — they compute the bounding box of all matched nodes and transform the entire group. "把太阳移到左边" moves all paths sharing `groupName:"太阳"` together.

**autoCompact** (`executor.ts`): LLM-generated coordinates often spread too wide. Before execution, `autoCompact` measures the horizontal span of all draw commands in a batch — if spread > 35% of canvas width, it compresses toward center to 30%, preserving relative proportions.

**Coordinate system**: Nine-grid X coordinates are [0.33, 0.5, 0.67]; Y coordinates are [0.28, 0.5, 0.72] (asymmetric — top/bottom rows sit slightly closer to center than the left/right columns; see `POSITION_FRACTIONS` in `dsl/types.ts`). Widened from an earlier symmetric [0.2, 0.5, 0.8]. Size fractions are small 0.07 / medium 0.13 / large 0.20, tuned up for better visual weight.

### executeAll Transaction Flow

`executeAll()` in `dsl/executor.ts` wraps every command sequence in a transaction with these steps:

1. **groupId assignment**: Scan all draw commands in the batch — commands sharing the same `groupName` get the same auto-generated `groupId`. Different batches get independent `groupId`s.
2. **autoCompact**: Measure horizontal spread of all draw `fx` coordinates. If spread > 35% of canvas width, compress toward center to 30% while preserving relative proportions. Only applies to explicit `{fx, fy}` positions, not nine-grid labels.
3. **Snapshot capture**: If any command in the batch is mutating (draw/move/resize/style/delete/clear/background), capture full canvas state before execution.
4. **Sequential execution**: Run each command through `execute()`. Any failure triggers full rollback via `restoreSnapshot()` (compound commands never leave the canvas in a half-done state).
5. **Path animation**: Collect all newly-created path nodes and feed them to `revealStrokes()` for stroke-by-stroke drawing animation.
6. **History commit**: If state changed and no rollback occurred, push the snapshot to the undo stack.

Basic shapes (circle/rect/triangle/line/text) animate immediately inside `execDraw()` via `revealShape()`. Path nodes defer animation to this post-execution phase so all strokes draw sequentially.

### Canvas Layer

`canvas/stage.ts`: **Three-layer** Konva setup (feat/14 added background layer):
- `backgroundLayer` — bottom layer for background color, drawn once via `execBackground`. Included in snapshots (undo/redo) and export.
- `mainLayer` — all user drawings.
- `feedbackLayer` — selection highlights (not saved, not undoable, not exported).

`canvas/draw-animation.ts`: Two animation modes:
- `revealShape()`: "Hand-drawn" reveal for single shapes (Circle/Rect/Triangle/Text) using dash-offset trick. Pure visual — node geometry is final from the start.
- `revealStrokes()`: **Stroke-by-stroke animation for path nodes** (feat/14). After `executeAll`, all new path nodes in the batch are collected and drawn sequentially with randomized inter-stroke delays (400ms ± 80ms jitter), simulating hand-drawing. Each stroke uses the dash-offset trick; fill fades in after the stroke completes.

`canvas/highlight.ts`: Selection highlight management. Highlights are grouped by `groupId` — all parts of a composite object share one unified bounding box. Also used by snapshot restore.

`canvas/drag-history.ts`: Mouse drag events on the layer → undo history entries.

### Undo/Redo: Transaction Snapshots

Unlike a traditional command pattern, undo uses **whole-state snapshots** (`history/snapshot.ts`). Before any mutating `executeAll()`, `captureSnapshot()` serializes all Konva nodes + object registry. Undo restores the snapshot wholesale. This means:
- Compound command sequences (from LLM or clause splitting) are one undo transaction.
- If a compound sequence fails mid-way, the snapshot is restored (full rollback).
- Max 50 undo entries. Replay walks the undo stack at 700ms intervals.

`pendingAttrs` (`history/snapshot.ts`) is a registry of animation end-states. When `animateTo()` starts a move/resize transition (0.35s), it registers the final geometry in `pendingAttrs`. If a snapshot is captured mid-animation, `captureSnapshot()` reads `pendingAttrs` to get the correct final geometry instead of the current in-between values. After the animation completes, entries are cleared. This means undo always restores the intended end state, never a mid-transition frame.

`captureSnapshot()` also scrubs **draw-animation artifacts** (`revealShape`/`revealStrokes` leave a dash stroke + semi-transparent fill mid-draw): it deletes `dash`/`dashOffset` and restores each non-line node's `fill` to its registered final color (from the object registry) before serializing. So a snapshot taken while a stroke is still drawing still records the completed visual.

### Stores (Pinia)

| Store | Purpose |
|---|---|
| `command` | Command stream hub: interim/final text, feedback, history entries, listen state |
| `objects` | Canvas object registry (id, shape, color, seq, groupId/groupName/part) for semantic lookup |
| `assistant` | LLM conversation state: thinking, ask/clarify/confirm dialogs, message history |
| `history` | Undo/redo stack of snapshots, replay state |
| `settings` | LLM provider presets (DeepSeek/Kimi/GLM/Qwen/custom), API keys per provider, custom model override. `activeConfig` getter resolves the selected preset + key into a ready-to-use `LlmConfig` (with `ready: boolean`). Persisted to localStorage; includes legacy key migration from single DeepSeek-key era. |

### Component Tree

| Component | Role |
|---|---|
| `App.vue` | Root: initializes canvas, recognizer, drag history, pipeline; manages keyboard shortcuts and TTS/ASR coordination |
| `CaptionBar.vue` | Real-time subtitle bar showing interim (gray) and final (black) recognized text + execution feedback |
| `DebugInput.vue` | Text input fallback when ASR is unavailable or for dev testing — submits text through the same `commandStore.submit()` pipeline |
| `AskPanel.vue` | Overlay panel for LLM追问 / rule-level图形追问 / clear-confirmation — all three share this panel, gated by `assistant.ask`/`clarify`/`confirm` |
| `HistoryPanel.vue` | Slide-out operation history list showing each command with its execution result |
| `SettingsPanel.vue` | LLM provider selection + API key input + model override fields |

### Keyboard Shortcuts

Handled in `App.vue` `onKeydown` — all go through the same `commandStore.submit()` pipeline as voice:

| Shortcut | Action |
|---|---|
| Ctrl+Z | Undo (`store.submit('撤销', 'ui')`) |
| Ctrl+Shift+Z / Ctrl+Y | Redo (`store.submit('重做', 'ui')`) |

Shortcuts are suppressed when focus is in an `<input>` or `<textarea>`.

### Speech

`speech/recognizer.ts`: Web Speech API wrapper. The public API is just `onInterim`/`onFinal` callbacks — designed so a backup ASR (e.g., Qiniu cloud) could implement the same interface. Auto-restarts on silence timeout.

`speech/tts.ts`: TTS broadcasts execution results/confirmations/questions. During playback, ASR is paused to prevent feedback loops (`App.vue` manages this via `onSpeakStateChange`). A **watchdog timer** (estimated duration `text.length * 220ms / rate + 2000ms`) force-resumes ASR if the utterance finishes without firing `onend`/`onerror` — some browsers never signal completion, which would otherwise freeze recognition permanently.

### LLM Configuration

Users configure their own API key per provider in the Settings panel (stored in `localStorage`, never in code). Presets for DeepSeek, Kimi, GLM, Qwen, plus a custom OpenAI-compatible endpoint. All use the same `/chat/completions` protocol with `response_format: json_object`.

**Canvas memory** (feat/14): Before every LLM call, `pipeline.ts` refreshes the system prompt (`buildSystemPrompt()`) with the current canvas state — every object's shape, color, fx/fy coordinates, groupName, and part. This gives the LLM spatial awareness of what's already drawn, enabling it to place new objects relative to existing ones and understand "把那个人放大" correctly.

**Output richness & robustness**: The system prompt pushes for *detailed* output — a four-step "observe → compose → layer details → stroke" flow, an explicit budget of 8–18 paths for complex objects, layered same-hue fills for depth, and full-canvas scene layout (background first, far objects high / near low). Paths support optional `tension` so round forms (heads, wheels, clouds) need only 5–8 points. `temperature` is 0.45 (client.ts) for variety; to absorb the extra format jitter, `runSlowPath` does **one feedback retry** — on a JSON-parse or `validateDsl` failure it appends the bad reply + the exact error back into the conversation and asks the model to self-correct before giving up.

### E2E Testing Pattern

Each `scripts/e2e-*.mjs` script:
1. Launches local Edge via puppeteer
2. Uses `__sonink` debug hook (exposed on `window` in dev mode) to inspect canvas state
3. Uses `debugInput` text box or direct store manipulation to inject commands
4. Takes screenshots for visual verification
5. Checks Konva node count, object registry state, etc.

The debug hook is set in `canvas/stage.ts`:
```js
window.__sonink = { stage, backgroundLayer, mainLayer, feedbackLayer }
```
In dev mode, `execExport()` also sets `__sonink.lastExport` with the data URL for E2E verification.

### TypeScript Strictness

`tsconfig.json` has `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`. The build step (`vue-tsc --noEmit`) enforces this.
