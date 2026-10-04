// Run from the repo root: node web/test/chrome.mjs test|bench
// Launches a fresh headless Chrome profile and serves web/ on 127.0.0.1:8000.
// DRAWINGKID_WEB_ROOT can point to a baseline web copy for comparison.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const webRoot = process.env.DRAWINGKID_WEB_ROOT ?? resolve(import.meta.dirname, '..');
const profile = await mkdtemp(join(tmpdir(), 'drawingkid-chrome-'));
const server = spawn('python3', ['-m', 'http.server', '8000', '--bind', '127.0.0.1', '--directory', webRoot], { stdio: 'ignore' });
const chrome = spawn(chromePath, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

async function waitForPort() {
  for (let i = 0; i < 100; i++) {
    try { return Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
    catch { await delay(100); }
  }
  throw new Error('Chrome debugging port did not start');
}

async function run() {
  const port = await waitForPort();
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const tab = tabs.find((t) => t.type === 'page');
  assert.ok(tab);
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message.result);
  };
  function send(method, params = {}) {
    const id = ++seq;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }
  await send('Page.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:8000/${process.argv[2] === 'ui' ? '' : 'test/blank.html'}` });
  for (let i = 0; i < 100; i++) {
    const ready = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (ready.result.value === 'complete') break;
    await delay(100);
  }
  const body = await readFile(join(import.meta.dirname,
    process.argv[2] === 'bench' ? 'benchmark.browser.js' : process.argv[2] === 'ui' ? 'undo-button.browser.js' : 'document.browser.js'), 'utf8');
  const result = await send('Runtime.evaluate', {
    expression: `(async () => { ${body}\n })()`, awaitPromise: true, returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
  console.log(JSON.stringify(result.result.value, null, 2));
  ws.close();
}

try { await run(); }
finally {
  chrome.kill();
  server.kill();
  await Promise.all([chrome, server].map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  })));
  await rm(profile, { recursive: true, force: true });
}
