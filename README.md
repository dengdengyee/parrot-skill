# parrot-skill

Let Claude debug your frontend by collecting logs via a local server — Claude instruments your code, reads the logs, and drives the debugging session.

Parrot is for **runtime bugs you can't diagnose by reading the code**: race conditions, async ordering issues, data that silently disappears through a pipeline, stale closures, state that changes in unexpected ways. For bugs with an obvious static cause, Claude will handle them directly without needing parrot.

## Install

### Claude Code

**Step 1** — Register the marketplace:

```
/plugin marketplace add dengdengyee/parrot-skill
```

**Step 2** — Install the skill:

```
/plugin install parrot@parrot-skill
```

### Manual (.skill file)

Download [`parrot.skill`](./parrot.skill) and install it via Claude Code's plugin menu, or upload it directly in Claude.ai.

## Usage

Invoke explicitly when you're stuck on a runtime-specific bug:

```
/parrot
```

Or describe what you're seeing and Claude will reach for it when runtime tracing is the right tool:

> "My debounced search is still occasionally showing stale results — I've read the code and can't figure out why"

> "20 items go in, 12 come out, no errors anywhere — can you trace what's being dropped?"

> "My counter gets stuck at 1 no matter how many times I press the key"

## How it works

1. **Starts a local log server** (`server.js`, pure Node.js, no dependencies) on `localhost:7700`
2. **Instruments your code** with `fetch`-based log calls at key boundaries — function entry/exit, before/after async calls, inside catch blocks
3. **Reads the collected logs** after you run the code, and uses them to pinpoint the bug
4. **Cleans up** — removes instrumentation and stops the server when done

No npm install. No external services. Logs stay on your machine.

## When to use parrot vs. just asking Claude

| Situation | Use |
|---|---|
| Bug is visible from reading the code (wrong key, missing `await`, etc.) | Just ask Claude — no parrot needed |
| Need to see actual runtime values to understand what's wrong | `/parrot` |
| Behavior is inconsistent or timing-dependent | `/parrot` |
| Data is wrong but no error is thrown | `/parrot` |
| Multiple async operations interacting unexpectedly | `/parrot` |
| TypeScript error, CSS bug, build issue | Just ask Claude |
