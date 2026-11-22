import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('Vercel forwards every same-origin API route to the existing Render API without API caching', () => {
  const configurationPath = fileURLToPath(new URL('../vercel.json', import.meta.url));
  const configuration = JSON.parse(readFileSync(configurationPath, 'utf8'));
  assert.deepEqual(configuration.rewrites, [{
    source: '/api/:path*',
    destination: 'https://nexconn-chat.onrender.com/api/:path*',
  }]);
  assert.ok(configuration.headers.some(({ source, headers }) => source === '/api/:path*'
    && headers.some(({ key, value }) => key === 'x-vercel-enable-rewrite-caching' && value === '0')));
});

test('Render runtime requires PostgreSQL and does not depend on a disk mount', () => {
  const serverPath = fileURLToPath(new URL('../server/index.js', import.meta.url));
  const dockerPath = fileURLToPath(new URL('../Dockerfile', import.meta.url));
  const server = readFileSync(serverPath, 'utf8');
  const docker = readFileSync(dockerPath, 'utf8');
  assert.match(server, /process\.env\.DATABASE_URL/);
  assert.match(server, /Production requires a server-side PostgreSQL DATABASE_URL/);
  assert.doesNotMatch(server, /DATABASE_PATH|hasMountPoint|mountinfo/);
  assert.doesNotMatch(docker, /DATABASE_PATH|\/data/);
});
