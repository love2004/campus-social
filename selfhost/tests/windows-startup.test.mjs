import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('desktop setup signs in the new administrator and cannot issue a session for an existing account', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'campus-desktop-test-'));
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const { port } = socket.address();
  await new Promise(resolve => socket.close(resolve));

  const entry = fileURLToPath(new URL('../windows/run.mjs', import.meta.url));
  const child = spawn(process.execPath, [entry], {
    cwd: directory,
    env: { ...process.env, PORT: String(port), DATA_DIR: directory, ADMIN_EMAIL: '', ADMIN_PASSWORD: '' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const exit = once(child, 'exit');
  const output = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  t.after(async () => {
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exit;
    const resolved = path.resolve(directory);
    if (!resolved.startsWith(path.join(os.tmpdir(), 'campus-desktop-test-'))) throw new Error('Unsafe test cleanup');
    await rm(resolved, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  const email = 'desktop@example.org';
  const original = '桌面測試Password1';
  const replacement = '桌面測試Password2';
  async function command(action, payload) {
    const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    child.stdin.write(`${action} ${data}\n`);
    return (await output.next()).value;
  }
  const setup = password => command('SETUP', { email, password });
  function request(route, method, payload, cookie) {
    return fetch(base + route, {
      method,
      headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(payload),
    });
  }

  assert.equal((await output.next()).value, `READY ${port} demo`);
  assert.equal(await setup('short'), 'ADMIN INVALID');
  const setupReply = await setup(original);
  const match = /^ADMIN CREATED ([A-Za-z0-9_-]{43}) (\d+)$/.exec(setupReply);
  assert.ok(match, 'first setup should return an initial session');
  const [,token,expiresAt] = match;
  assert.ok(Number(expiresAt) > Date.now());
  assert.equal(await setup(replacement), 'ADMIN EXISTS');
  assert.equal((await (await fetch(base + '/api/health')).json()).configured, true);
  await assert.rejects(stat(path.join(directory, '.env.selfhost')), { code: 'ENOENT' });

  const cookie = `campus_session=${token}`;
  const session = await fetch(base + '/api/session', { headers: { Cookie: cookie } });
  assert.deepEqual(await session.json(), { email });
  assert.equal((await fetch(base + '/api/state?compact=1', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(base + '/api/session')).status, 401);
  assert.equal(await command('CHANGE', { current: 'incorrect', next: replacement }), 'ADMIN WRONG_PASSWORD');
  assert.equal((await fetch(base + '/api/session', { headers: { Cookie: cookie } })).status, 200);
  const changed = /^ADMIN CHANGED ([A-Za-z0-9_-]{43}) (\d+)$/.exec(await command('CHANGE', { current: original, next: replacement }));
  assert.ok(changed, 'the desktop can change a password without a browser session');
  const changedCookie = `campus_session=${changed[1]}`;
  assert.equal((await fetch(base + '/api/session', { headers: { Cookie: cookie } })).status, 401);
  assert.deepEqual(await (await fetch(base + '/api/session', { headers: { Cookie: changedCookie } })).json(), { email });
  assert.equal((await request('/api/login', 'POST', { email, password: original })).status, 401);
  assert.equal((await request('/api/login', 'POST', { email, password: replacement })).status, 200);
  assert.equal((await request('/api/password', 'PUT', { current: replacement, next: original }, changedCookie)).status, 200);
  assert.equal((await fetch(base + '/api/session', { headers: { Cookie: changedCookie } })).status, 200);
  child.stdin.end();
  assert.deepEqual(await exit, [0, null]);
});
