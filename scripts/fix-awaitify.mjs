/**
 * Fix common issues after awaitify-db transform.
 */
import fs from 'fs';
import path from 'path';

function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, files);
    else if (name.endsWith('.ts')) files.push(full);
  }
  return files;
}

const files = walk(path.resolve('server/src'));

for (const file of files) {
  let s = fs.readFileSync(file, 'utf8');
  const before = s;

  s = s.replace(/export async function await /g, 'export async function ');
  s = s.replace(/async function await /g, 'async function ');
  s = s.replace(/ReturnType<typeof getDb>/g, 'Db');

  // Ensure Db import when used
  if (/\bDb\b/.test(s) && /from ['"].*database\.js['"]/.test(s) && !/\{[^}]*\bDb\b/.test(s.match(/import\s+(type\s+)?\{[^}]+\}/g)?.join(' ') || '')) {
    s = s.replace(/import\s+(type\s+)?\{([^}]+)\}\s+from\s+(['"].*database\.js['"])/, (m, typ, inner, from) => {
      if (/\bDb\b/.test(inner)) return m;
      const cleaned = inner.trim().replace(/,$/, '');
      return `import { ${cleaned}, type Db } from ${from}`;
    });
  }
  // seed.ts may have no import for Db
  if (file.endsWith('seed.ts') && s.includes(': Db') && !s.includes("from './database.js'") && !s.includes('from "../db/database.js"')) {
    s = `import type { Db } from './database.js';\n` + s;
  }
  if (file.endsWith('adminUser.ts') && s.includes(': Db') && !/import.*Db/.test(s)) {
    s = s.replace(
      /import \{ sendPasswordInviteEmail \}/,
      "import type { Db } from '../db/database.js';\nimport { sendPasswordInviteEmail }"
    );
  }

  // Functions that contain await but are not async — mark export function X as async if body has await
  s = s.replace(/export function (\w+)\(([^)]*)\)(:[^{]+)?\{/g, (m, name, args, ret) => {
    return m; // handled below more carefully
  });

  fs.writeFileSync(file, s);
  if (s !== before) console.log('fixed', file);
}

console.log('pass1 done');
