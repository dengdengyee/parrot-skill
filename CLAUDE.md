# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Parrot** is a Claude skill for debugging runtime JavaScript/TypeScript bugs that can't be diagnosed through static analysis — race conditions, stale closures, async ordering issues, silent data loss, etc.

It works by:
1. Starting a local HTTP log server (`skills/parrot/server.js`) on `localhost:7700`
2. Claude instruments user code with fire-and-forget `fetch` POST calls
3. User runs their code normally
4. Claude reads the collected logs via the server's REST API
5. Claude analyzes logs, finds the root cause, then removes instrumentation

## Repository Structure

```
skills/
  parrot/
    server.js      # Core HTTP log collection server (zero dependencies)
    SKILL.md       # Skill definition with frontmatter triggers + workflow docs
.claude-plugin/
  marketplace.json # Plugin registry metadata for Claude marketplace
parrot.skill       # Distributable ZIP archive of the skill
```

## Skill Definition (`skills/parrot/SKILL.md`)

The frontmatter YAML `description` field defines when Claude auto-triggers this skill. Key trigger conditions: user says "trace", "instrument", "see what's happening", behavior is timing-dependent or inconsistent, async operations interact unexpectedly, or state is wrong with no errors.

Non-triggers: static bugs, compile/TypeScript errors, CSS issues, Python code, production logging setup.

## Server API (`skills/parrot/server.js`)

The server uses a `RingBuffer` class (default 500 entries) and exposes:

| Endpoint | Purpose |
|----------|---------|
| `POST /log` | Accepts `{ data, level?, label?, stack? }` — returns `{ id }` |
| `GET /logs` | Query params: `format=json\|text`, `since=log-ID`, `level=`, `last=N`, `clear=true` |
| `DELETE /logs` | Clear all logs |
| `GET /health` | Server status |

Port fallback: tries 7700–7709 sequentially. Env vars: `PARROT_PORT`, `PARROT_MAX_LOGS`, `PARROT_SILENT=1`.

## Instrumentation Pattern

Claude adds this helper to user code (no await — fire-and-forget preserves timing):

```javascript
function plog(data, label, level = 'log') {
  fetch('http://localhost:7700/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, label, level }),
  });
}
```

## Installation Methods

- **Marketplace**: `/plugin marketplace add dengdengyee/parrot-skill` then `/plugin install parrot@parrot-skill`
- **Manual**: Download `parrot.skill` (ZIP archive) and install directly

## No Build/Test/Lint Commands

There is no package.json, build system, or test runner. The server is plain Node.js 18+ with zero external dependencies. The `skills/parrot-workspace/` directory (gitignored) contains manual evaluation runs with benchmark data.
