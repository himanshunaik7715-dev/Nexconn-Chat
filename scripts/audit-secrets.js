import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const envExamplePath = path.join(root, '.env.example');
const env = existsSync(envPath) ? parse(readFileSync(envPath)) : {};
const envExample = existsSync(envExamplePath) ? parse(readFileSync(envExamplePath)) : {};
const frontendRoots = ['src', 'dist', 'public'];
const files = [];

function collect(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(fullPath);
    else if (entry.isFile() && !entry.name.endsWith('.map')) files.push(fullPath);
  }
}

for (const directory of frontendRoots) collect(path.join(root, directory));
files.push(path.join(root, 'index.html'), path.join(root, 'vite.config.ts'));
const source = files.filter(existsSync).map((file) => readFileSync(file, 'utf8'));
const patterns = [
  /\bVITE_[A-Z0-9_]*(?:APP_SECRET|ACCESS_KEY|USER_TOKEN|JWT_SECRET|PASSWORD)\b/i,
  /\b(?:NEXCONN_APP_SECRET|NEXCONN_ACCESS_KEY|JWT_SECRET)\s*[:=]\s*['"][^'"]{12,}['"]/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/i,
];

const findings = [];
for (const pattern of patterns) {
  if (source.some((text) => pattern.test(text))) findings.push(pattern.toString());
}

const secretEntries = Object.entries(env).filter(([key, value]) =>
  value && /(secret|access.?key|token|password|jwt)/i.test(key),
);
for (const [key, value] of secretEntries) {
  if (value.length >= 12 && source.some((text) => text.includes(value))) findings.push(`configured ${key} value appears in frontend source or build`);
}
const sensitiveTemplateEntries = Object.entries(envExample).filter(([key, value]) =>
  value && /(APP_SECRET|ACCESS.?KEY|USER_TOKEN|JWT_SECRET|PASSWORD)/i.test(key),
);
const populatedTemplateKeys = sensitiveTemplateEntries
  .filter(([, value]) => !/^(?:your-|replace-with-|change-me|<)/i.test(value.trim()))
  .map(([key]) => key);
if (populatedTemplateKeys.length) findings.push(`.env.example has non-placeholder sensitive fields: ${populatedTemplateKeys.join(', ')}`);

let ignored = false;
let tracked = true;
try {
  execFileSync('git', ['check-ignore', '--quiet', '.env'], { cwd: root, stdio: 'ignore' });
  ignored = true;
} catch { ignored = false; }
try {
  execFileSync('git', ['ls-files', '--error-unmatch', '.env'], { cwd: root, stdio: 'ignore' });
} catch { tracked = false; }

if (findings.length || !ignored || tracked) {
  process.stderr.write(`Secret audit failed. Findings=${findings.length}; .env ignored=${ignored}; .env tracked=${tracked}.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Secret bundle audit passed. Checked ${secretEntries.length} populated secret-like environment values and ${sensitiveTemplateEntries.length} placeholder fields; .env is ignored and untracked. No credential values were printed.\n`);
}
