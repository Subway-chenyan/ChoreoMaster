<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# CosStage — Agent Guide

Desktop choreography editor. React + Vite frontend, Python FastAPI + LangGraph backend, Electron wrapper.

## Commands

| What | Command |
|---|---|
| Full dev (frontend + backend) | `npm start` (or `start.bat`) |
| Full dev with dependency reinstall | `npm run start:setup` |
| Frontend only | `npm run dev` (Vite on :5173) |
| Backend only | `npm run dev:backend` (uvicorn on :8000) |
| Backend tests | `npm run test:backend` (pytest) |
| Project service tests | `npm run test:project` (needs `npm run build:main` first) |
| Desktop regression tests | `npm run test:desktop` |
| Full test suite | `npm test` (backend + project + desktop + build) |
| Vite production build | `npm run build` |
| Full Electron desktop build | `npm run build:electron` |
| Electron dev (concurrent) | `npm run dev:electron` |

**Order matters**: `test:project` requires `build:main` to run first (compiles `electron/` → `dist-electron/`). The full `npm test` handles this automatically.

## Architecture

- **Entrypoints**: `index.html` → `index.tsx` → `App.tsx` (single ~3600-line root component). `electron/main.ts` is the Electron main process.
- **Backend**: `backend/app/main.py` — FastAPI app. LangGraph agent in `backend/app/agent/`.
- **Path alias**: `@/*` maps to repo root (both TS configs and Vite).
- **Tailwind CSS v4** via PostCSS (`@tailwindcss/postcss` plugin). Content scans all `*.{js,ts,jsx,tsx}` from root.
- **3D rendering**: React Three Fiber + drei for stage visualization.
- **Electron IPC**: `electron/ipc-handlers.ts` registers handlers; `electron/preload.ts` exposes bridge to renderer.

## Environment & Dependencies

- Copy `.env.example` → `.env`. The launcher auto-creates it if missing.
- **Python 3.11+** required (FastAPI, LangGraph, google-genai).
- **FFmpeg** must be on PATH (multimodal agent uses it for audio slicing).
- `LLM_PROVIDER=rule` works offline with a deterministic fallback — no API key needed for basic testing.
- Multimodal agent requires `GEMINI_API_KEY`.
- `.env` is loaded by both the Node launcher (`scripts/start-dev.cjs`) and the Python backend (`dotenv` in `backend/app/main.py` pointing at root `.env`).

## Testing Notes

- Backend pytest runs from `backend/` directory via `npm run test:backend`.
- Node tests use `node --test` (built-in test runner, not Jest/Vitest).
- Electron project service tests require the `dist-electron/` build output to exist.
- The CI workflow is `.github/workflows/deploy-cos.yml`.

## Conventions

- UI language is Chinese (zh-CN). Logs, comments, and user-facing strings are in Chinese.
- Code identifiers and type names are in English.
- No linter or formatter config exists (no ESLint, Prettier, or Ruff). Follow existing style.
- `tsconfig.json` has `noEmit: true` — the frontend TS is type-checked only, not compiled by tsc. Vite handles the build.
- Electron has its own `tsconfig.electron.json` with `outDir: dist-electron/` and `strict: true`.
