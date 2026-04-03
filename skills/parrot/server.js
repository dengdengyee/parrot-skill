import http from 'node:http';

class RingBuffer {
  #items = [];
  #maxSize;
  #counter = 0;

  constructor(maxSize) {
    this.#maxSize = maxSize;
  }

  push(item) {
    this.#counter++;
    const id = 'log-' + String(this.#counter).padStart(4, '0');
    const entry = { id, timestamp: Date.now(), ...item };
    this.#items.push(entry);
    if (this.#items.length > this.#maxSize) this.#items.shift();
    return entry;
  }

  getAll() { return [...this.#items]; }

  since(id) {
    const num = parseInt(id.replace(/^log-/, ''), 10);
    return this.#items.filter(e => parseInt(e.id.replace(/^log-/, ''), 10) > num);
  }

  clear() {
    const count = this.#items.length;
    this.#items = [];
    return count;
  }

  get count() { return this.#items.length; }
  get lastId() { return this.#items.length > 0 ? this.#items[this.#items.length - 1].id : null; }
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':')
    + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...corsHeaders(),
  });
  res.end(payload);
}

function formatLogsText(logs) {
  if (logs.length === 0) return '(no logs)';
  return logs.map(entry => {
    const ts = formatTimestamp(entry.timestamp);
    const levelPart = `[${entry.level ?? 'log'}]`;
    const labelPart = entry.label ? ` ${entry.label}` : '';
    const header = `[${entry.id}] ${ts} ${levelPart}${labelPart}`;
    const dataLine = `  → ${JSON.stringify(entry.data)}`;
    let stackLines = '';
    if (entry.stack) {
      const lines = entry.stack.split('\n').slice(1)
        .map(l => l.trim()).filter(Boolean).map(l => `  ┄ ${l}`);
      if (lines.length > 0) stackLines = '\n' + lines.join('\n');
    }
    return `${header}\n${dataLine}${stackLines}`;
  }).join('\n\n');
}

function parseQuery(url) {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params = {};
  for (const part of url.slice(idx + 1).split('&')) {
    const [k, v] = part.split('=');
    if (k) params[decodeURIComponent(k)] = v !== undefined ? decodeURIComponent(v) : '';
  }
  return params;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function tryListen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
}

const port = parseInt(process.env.PARROT_PORT ?? '7700', 10);
const maxLogs = parseInt(process.env.PARROT_MAX_LOGS ?? '500', 10);
const silent = process.env.PARROT_SILENT === '1';

const buffer = new RingBuffer(maxLogs);

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // POST /log
  if (req.method === 'POST' && urlPath === '/log') {
    readBody(req).then(raw => {
      let body;
      try { body = JSON.parse(raw); }
      catch { sendJson(res, 400, { error: 'invalid json' }); return; }

      const entries = Array.isArray(body) ? body : [body];
      const ids = entries.map(item => {
        const entry = buffer.push({
          data: item.data,
          level: item.level ?? 'log',
          ...(item.label !== undefined ? { label: item.label } : {}),
          ...(item.stack !== undefined ? { stack: item.stack } : {}),
        });
        if (!silent) {
          const display = item.label ?? JSON.stringify(item.data).slice(0, 60);
          console.log(`🦜 [${entry.level}] ${display}`);
        }
        return entry.id;
      });

      sendJson(res, 201, Array.isArray(body) ? { ids } : { id: ids[0] });
    }).catch(() => sendJson(res, 400, { error: 'invalid json' }));
    return;
  }

  // GET /logs
  if (req.method === 'GET' && urlPath === '/logs') {
    const q = parseQuery(req.url);
    let logs = buffer.getAll();
    if (q.since) logs = buffer.since(q.since);
    if (q.level) logs = logs.filter(e => e.level === q.level);
    if (q.last) { const n = parseInt(q.last, 10); if (!isNaN(n)) logs = logs.slice(-n); }
    let cleared = false;
    if (q.clear === 'true') { buffer.clear(); cleared = true; }
    if (!silent) console.log(`→ GET /logs (${logs.length} entries${cleared ? ', cleared' : ''})`);
    const lastId = logs.length > 0 ? logs[logs.length - 1].id : null;
    if (q.format === 'json') {
      sendJson(res, 200, { count: logs.length, logs, lastId });
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders() });
      res.end(formatLogsText(logs));
    }
    return;
  }

  // DELETE /logs
  if (req.method === 'DELETE' && urlPath === '/logs') {
    sendJson(res, 200, { cleared: buffer.clear() });
    return;
  }

  // GET /health
  if (req.method === 'GET' && urlPath === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      port: server.address().port,
      logCount: buffer.count,
      maxLogs,
      uptime: Math.floor(process.uptime()),
    });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

let actualPort = null;
for (let attempt = 0; attempt < 10; attempt++) {
  const tryPort = port + attempt;
  try {
    await tryListen(server, tryPort);
    actualPort = tryPort;
    break;
  } catch (err) {
    if (err.code !== 'EADDRINUSE') { console.error(`Failed to start: ${err.message}`); process.exit(1); }
  }
}

if (actualPort === null) {
  console.error(`Could not bind to ports ${port}–${port + 9}. All in use.`);
  process.exit(1);
}

console.log(`🦜 parrot listening on http://localhost:${actualPort}`);
if (actualPort !== port) console.log(`   (port ${port} was in use — fell back to ${actualPort})`);
