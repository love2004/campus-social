import http from 'node:http';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { changeAdministratorPassword, createApp, initializeAdministrator } from '../server.mjs';

const host = '127.0.0.1';
const port = Number(process.env.PORT || 5180);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.log('ERROR PORT');
  process.exit(1);
}

const url = `http://${host}:${port}`;
let app;
const server = http.createServer({ requestTimeout: 240000, headersTimeout: 30000 }, (req, res) => {
  if (app) return app.handler(req, res);
  res.writeHead(503).end();
});

try {
  // Claim the port before opening the store or starting any scheduled work.
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  app = await createApp({
    directory: path.resolve(process.env.DATA_DIR || 'selfhost-data'),
    requestBaseUrl: url,
  });
} catch (error) {
  console.log(`ERROR ${error.code === 'EADDRINUSE' ? `IN_USE ${port}` : 'START'}`);
  server.close();
  process.exitCode = 1;
}

if (app) {
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    const closed = new Promise(resolve => server.close(resolve));
    await closed;
    await app.close();
  }
  const commands = createInterface({ input: process.stdin });
  // Only the launcher can use this pipe. The desktop can verify the current password
  // before changing it, even when the WebView has no session.
  commands.on('line', line => {
    if (stopping) return;
    const separator = line.indexOf(' ');
    const command = line.slice(0, separator);
    if (command !== 'SETUP' && command !== 'CHANGE') return;
    try {
      const input = JSON.parse(Buffer.from(line.slice(separator + 1), 'base64').toString('utf8'));
      if (command === 'CHANGE') {
        const { token, expiresAt } = changeAdministratorPassword(app.store, input);
        console.log(`ADMIN CHANGED ${token} ${expiresAt}`);
        return;
      }
      const { created, session } = initializeAdministrator(app.store, input, { signIn: true });
      // Return the initial session only through the launcher's private response pipe.
      console.log(created ? `ADMIN CREATED ${session.token} ${session.expiresAt}` : 'ADMIN EXISTS');
    } catch (error) {
      if (command === 'CHANGE' && error.status === 403) console.log('ADMIN WRONG_PASSWORD');
      else console.log(error.name === 'ZodError' ? 'ADMIN INVALID' : 'ADMIN ERROR');
    }
  });
  commands.on('close', () => void shutdown());
  console.log(`READY ${port} ${app.store.kv('administrator') ? 'configured' : 'demo'}`);
}
