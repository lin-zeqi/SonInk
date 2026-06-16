# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build/Run/Test

```bash
npm run dev          # Start Vite dev server
npm run build        # Typecheck (vue-tsc --noEmit) + Vite production build
npm run typecheck    # Typecheck only
npm run preview      # Preview production build locally
npx tsx scripts/parser-smoke.ts          # Parser smoke test (no browser needed)
```

E2E scripts use `puppeteer-core` driving local Edge. Run `npm run dev` first, then in another terminal:

```bash
node scripts/e2e-canvas-power.mjs    # PR #13: templates / text / style / export / replay / drag
node scripts/e2e-robust.mjs          # PR #12: relative positioning / shape-missing追问 / colloquial verbs
node scripts/e2e-tts.mjs             # PR #11: TTS feedback / clear confirmation
node scripts/e2e-resize-move.mjs     # PR #10: resize / move with animations
node scripts/e2e-undo.mjs            # PR #9: undo / redo transaction snapshots
node scripts/e2e-llm.mjs             # PR #8: LLM channel (mock)
node scripts/e2e-repro.mjs           # PR #6: select / move / delete / clause split
node scripts/e2e-anim.mjs            # PR #7: progressive draw animation
```

All E2E scripts pass against the current working tree.

## Architecture Overview

**SonInk** is a voice-controlled drawing app: users speak, the system draws on a Konva.js canvas. Purely frontend — no backend. Vue 3 + TypeScript + Pinia.

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

1. **Fast path** (`parser/rules.ts`): Regex-based intent matching with synonym tables (`parser/lexicon.ts`). Handles ~50 simple command patterns: draw, select, move, resize, delete, undo, style, clear, export, replay, text. Also handles clause splitting (逗号/然后/接着/还有) for compound commands that don't need an LLM.

2. **Slow path** (`llm/client.ts` + `llm/prompt.ts`): OpenAI-compatible chat/completions call. Used when the rule engine misses or detects it can't handle the utterance. The prompt teaches the LLM to output `path`-based draw commands with `groupName` for multi-part objects — not discrete shapes.

The rule engine also has two local fallbacks _before_ hitting LLM:
- **Shape-missing追问** (`isShapeMissing()`): "画一个" with no shape word → asks "想画什么图形?" locally, saving an LLM call.
- **Semantic templates** (`parser/templates.ts`): 太阳/房子/树/雪人/小人/笑脸 are expanded to `path` commands locally without LLM.

### DSL — the Contract Between Parser and Executor

`dsl/types.ts` defines every command type (`DrawCommand`, `MoveCommand`, `ResizeCommand`, `StyleCommand`, etc.) and semantic value types (`SemanticPosition`, `SemanticSize`, `PositionFraction`, `RelativeTo`).

Key constraints enforced by `dsl/schema.ts` (runtime validation):
- LLM output MUST be validated through `validateDsl()` before execution — never trust it.
- Positions are **0–1 proportional coordinates** (`fx`, `fy`) or nine-grid semantic labels. Absolute pixel coordinates are rejected. This prevents LLM hallucination of pixel values.
- All semantic→pixel conversion happens in `dsl/executor.ts` only.

### Path-Based Composition (feat/13-canvas-power — current working tree)

The most significant architectural shift: **semantic objects are no longer assembled from discrete shapes** (circle + triangle + line). Instead, a single `path` shape draws an entire silhouette as one continuous polyline via `Konva.Line`, using proportional coordinate points `[{fx, fy}, ...]`.

This applies to both:
- **Local templates** (`parser/templates.ts`): 太阳/房子/树/雪人/小人/笑脸 are each a single path draw command (e.g., stickman is 34 points drawn in one stroke).
- **LLM output** (`llm/prompt.ts`): The prompt teaches the model to compose complex objects as **multiple paths sharing a `groupName`** — one path per part (car body, wheels, windows), all bound by the same `groupName`.

**groupName / groupId / part model**:
- `groupName`: A semantic label like "汽车", "房子", "人". Multiple paths with the same `groupName` in one batch get the same `groupId` (auto-assigned by `executeAll`).
- `groupId`: System-generated unique ID linking all parts of a composite object. Used for group-level operations (move, resize, delete the whole group).
- `part`: Optional role label like "屋顶", "车轮" — enables fine-grained targeting ("删掉房子的屋顶" → `groupName:"房子"` + `part:"屋顶"`).
- `resolveTarget()` handles `groupName`/`part` lookups before individual feature matching.

**Group-level operations** (new in working tree): `execMove` and `execResize` no longer block on multi-match — they compute the bounding box of all matched nodes and transform the entire group. "把太阳移到左边" moves all paths sharing `groupName:"太阳"` together.

**autoCompact** (`executor.ts`): LLM-generated coordinates often spread too wide. Before execution, `autoCompact` measures the horizontal span of all draw commands in a batch — if spread > 35% of canvas width, it compresses toward center to 30%, preserving relative proportions.

**Coordinate system change** (working tree): Nine-grid positions widened from [0.2, 0.5, 0.8] to [0.33, 0.5, 0.67], and size fractions increased (small 0.05→0.07, medium 0.09→0.13, large 0.15→0.20) for better visual weight.

### Canvas Layer

`canvas/stage.ts`: Two-layer Konva setup — `mainLayer` for user drawings, `feedbackLayer` for selection highlights (not saved or undoable).

`canvas/draw-animation.ts`: "Hand-drawn" reveal using dash-offset trick. Pure visual — node geometry is final from the start.

`canvas/highlight.ts`: Selection highlight management. Also used by snapshot restore.

`canvas/drag-history.ts`: Mouse drag events on the layer → undo history entries.

### Undo/Redo: Transaction Snapshots

Unlike a traditional command pattern, undo uses **whole-state snapshots** (`history/snapshot.ts`). Before any mutating `executeAll()`, `captureSnapshot()` serializes all Konva nodes + object registry. Undo restores the snapshot wholesale. This means:
- Compound command sequences (from LLM or clause splitting) are one undo transaction.
- If a compound sequence fails mid-way, the snapshot is restored (full rollback).
- Max 50 undo entries. Replay walks the undo stack at 700ms intervals.

`pendingAttrs` tracks animation end-states so snapshots taken mid-animation capture the correct final geometry.

### Stores (Pinia)

| Store | Purpose |
|---|---|
| `command` | Command stream hub: interim/final text, feedback, history entries, listen state |
| `objects` | Canvas object registry (id, shape, color, seq, groupId/groupName/part) for semantic lookup |
| `assistant` | LLM conversation state: thinking, ask/clarify/confirm dialogs, message history |
| `history` | Undo/redo stack of snapshots, replay state |
| `settings` | LLM provider config (DeepSeek/Kimi/GLM/Qwen/custom), persisted to localStorage |

### Speech

`speech/recognizer.ts`: Web Speech API wrapper. The public API is just `onInterim`/`onFinal` callbacks — designed so a backup ASR (e.g., Qiniu cloud) could implement the same interface. Auto-restarts on silence timeout.

`speech/tts.ts`: TTS broadcasts execution results/confirmations/questions. During playback, ASR is paused to prevent feedback loops (`App.vue` manages this via `onSpeakStateChange`).

### LLM Configuration

Users configure their own API key per provider in the Settings panel (stored in `localStorage`, never in code). Presets for DeepSeek, Kimi, GLM, Qwen, plus a custom OpenAI-compatible endpoint. All use the same `/chat/completions` protocol with `response_format: json_object`.

### E2E Testing Pattern

Each `scripts/e2e-*.mjs` script:
1. Launches local Edge via puppeteer
2. Uses `__sonink` debug hook (exposed on `window` in dev mode) to inspect canvas state
3. Uses `debugInput` text box or direct store manipulation to inject commands
4. Takes screenshots for visual verification
5. Checks Konva node count, object registry state, etc.

The debug hook is set in `canvas/stage.ts`:
```js
window.__sonink = { stage, mainLayer, feedbackLayer }
```

### TypeScript Strictness

`tsconfig.json` has `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`. The build step (`vue-tsc --noEmit`) enforces this.
