# CLAUDE.md — Musicflow

## Project
Local desktop music player (YouTube download, library, lyrics, playlists).
- `musicflow-api/` — Python Flask backend (`server.py` endpoints, `main.py` core logic, `db.py` SQLite, `app.py` pywebview entry)
- `musicflow-dash/` — React frontend (Vite + TanStack Router + Zustand + Tailwind 4)

## Run
- Backend: `cd musicflow-api && py server.py` (port 5000)
- Frontend dev: `cd musicflow-dash && npm run dev` (port 5173, proxies `/api`)
- Build: `cd musicflow-dash && npm run build` → outputs to `musicflow-api/static/`
- Use `py`, not `python`.

## Coding Rules
1. **Ask before assuming.** If a request has multiple valid interpretations, state them — don't silently pick one.
2. **Minimum code.** No speculative features, no unrequested abstractions, no unused flexibility.
3. **Surgical edits.** Touch only what the task requires. Match existing style. Don't refactor unrelated code. Only remove imports/dead code your own change orphaned.
4. **Verify before done.** State a short plan for multi-step tasks; confirm each step works before moving on.

## Git Workflow — you manage this
- You have access to the `main` branch and are responsible for keeping it organized.
- **Before starting work:** `git pull` to sync with the latest state.
- **After completing a task:** commit with a clear, specific message describing what changed and why, then `git push` to `main`.
- Commit in logical units — one feature/fix per commit, not one giant dump at the end.
- Never force-push. Never rewrite shared history.
- If a pull/push conflicts, stop and surface it — don't auto-resolve silently.
