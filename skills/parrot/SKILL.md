---
name: parrot
description: >-
  Use parrot to instrument JavaScript/TypeScript code with structured runtime
  logging when the bug or behavior can't be understood from reading the code
  alone. Trigger when the user explicitly invokes /parrot; they say they need
  to "trace", "instrument", "log", or "see what's happening" at runtime;
  behavior is inconsistent or only reproduces under specific conditions; state
  or data is wrong but no error is thrown and the cause isn't clear; async
  operations, hooks, or components interact in unexpected ways; they need to
  observe actual runtime values to understand what's happening. Do NOT trigger
  for bugs with an obvious static fix, compile errors, CSS issues, Python or
  non-JS code, or production logging infrastructure setup.
---

# Parrot — Structured Runtime Log Collection for Hard-to-Spot Bugs

Parrot is for bugs you can't see by reading the code. It replaces ad-hoc `console.log` debugging with a structured local log server: Claude instruments the code with `fetch`-based log calls, the user runs the code, Claude reads the collected logs and drives the investigation.

**Use parrot when:**
- The bug only manifests at runtime (race conditions, async ordering, timing-dependent failures)
- A fetch succeeds (HTTP 200) but the data coming back is wrong or goes to the wrong place
- State is changing unexpectedly and you need to trace every transition to find where it goes wrong
- Multiple async operations interact and you need to see the real execution order
- The user explicitly invokes `/parrot`

**Don't use parrot when:**
- The bug is visible from a code read (wrong key name, missing `await`, off-by-one, etc.) — just fix it
- It's a TypeScript compile error, a CSS layout issue, or a build/bundler problem
- The user wants to set up production logging infrastructure (Winston, Datadog, Sentry)

No npm install. No dependencies. Pure Node.js server, pure `fetch` in the browser or runtime.

## Workflow

### Step 1: Start the Parrot Server

Start the server in the background using the Node.js executable on the user's machine:

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/parrot/server.js
```

The server binds to `http://localhost:7700` by default (falls back to 7701–7709 if the port is in use). It will print the actual port it bound to — capture that port for use in instrumentation.

Environment variables (all optional):
- `PARROT_PORT` — preferred port (default: 7700)
- `PARROT_MAX_LOGS` — ring buffer size (default: 500)
- `PARROT_SILENT=1` — suppress server stdout

### Step 2: Instrument the Code

Replace or augment `console.log` calls with `fetch` POST requests to the parrot server. Use no external libraries — only native `fetch` (available in all modern browsers and Node.js 18+).

**Basic log call:**
```js
fetch('http://localhost:7700/log', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: { value, otherThing }, level: 'log', label: 'MyComponent' }),
});
```

**Log levels:** `log` (default), `warn`, `error`, `debug`, `info`

**Label** is a short string identifying the source location (component name, function name, file). Always set a label — it makes reading logs much easier.

**Logging errors with stack traces:**
```js
fetch('http://localhost:7700/log', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    data: err.message,
    level: 'error',
    label: 'fetchUser',
    stack: err.stack,
  }),
});
```

**Batch logging (send multiple entries at once):**
```js
fetch('http://localhost:7700/log', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify([
    { data: { phase: 'start', input }, label: 'processOrder' },
    { data: { phase: 'validated', result }, label: 'processOrder' },
  ]),
});
```

### Step 3: Read the Logs

After the user runs/interacts with the instrumented code, fetch the logs:

```bash
curl http://localhost:7700/logs
```

This returns a human-readable plaintext format by default. For structured data:

```bash
curl 'http://localhost:7700/logs?format=json'
```

**Useful query parameters:**
- `?since=log-0012` — only entries after a given log ID (for polling)
- `?level=error` — filter by level
- `?last=20` — only the last N entries
- `?clear=true` — return logs and then clear the buffer

### Step 4: Analyze and Iterate

Read the logs and reason about the bug. Look for:
- Unexpected values at key checkpoints
- Missing log entries (code path not reached)
- Error entries with stack traces
- Ordering anomalies (race conditions, out-of-order async calls)

Add more instrumentation where behavior is still unclear, then repeat Step 3.

### Step 5: Clean Up

When debugging is done:
1. Remove all `fetch(...)` log instrumentation added during the session
2. Stop the parrot server (kill the background process)
3. Optionally clear the log buffer: `curl -X DELETE http://localhost:7700/logs`

## Server API Reference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/log` | Append one or more log entries |
| GET | `/logs` | Retrieve logs (text or JSON) |
| DELETE | `/logs` | Clear the log buffer |
| GET | `/health` | Server status, port, log count, uptime |

## Instrumentation Principles

- **Label everything.** Always set `label` to the component or function name — it's the most useful field when scanning logs.
- **Log data objects, not strings.** Pass structured objects to `data` so they're serializable and filterable. Avoid string concatenation.
- **Use levels intentionally.** Use `error` for caught exceptions, `warn` for unexpected-but-handled states, `log`/`debug` for flow tracing.
- **Instrument boundaries.** Add logs at function entry/exit, before/after async calls, and at branch points — not inside tight loops unless necessary.
- **Don't await the fetch.** Fire-and-forget is fine. Awaiting log calls changes async timing and can mask the bug.

## Example: Debugging a React Component

```js
// Before
function loadUser(id) {
  fetch(`/api/users/${id}`)
    .then(r => r.json())
    .then(data => setUser(data));
}

// After — instrumented with parrot
function loadUser(id) {
  plog({ phase: 'start', id }, 'loadUser');
  fetch(`/api/users/${id}`)
    .then(r => {
      plog({ status: r.status, ok: r.ok }, 'loadUser');
      return r.json();
    })
    .then(data => {
      plog({ data }, 'loadUser');
      setUser(data);
    })
    .catch(err => plog({ error: err.message, stack: err.stack }, 'loadUser', 'error'));
}

// Helper to reduce boilerplate (define once at top of file)
function plog(data, label, level = 'log') {
  fetch('http://localhost:7700/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, label, level }),
  });
}
```
