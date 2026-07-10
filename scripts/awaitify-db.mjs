/**
 * Adds await to sync SQLite-style DB calls for the Postgres migration.
 * Run: node scripts/awaitify-db.mjs
 */
import fs from 'fs';
import path from 'path';

const roots = [
  path.resolve('server/src/routes'),
  path.resolve('server/src/lib'),
  path.resolve('server/src/middleware'),
  path.resolve('server/src/db/seed.ts'),
];

function transform(source, filePath) {
  if (filePath.endsWith('database.ts') || filePath.endsWith('pg.ts')) return source;
  let s = source;

  // getDb() → await getDb() (avoid double await)
  s = s.replace(/(?<!await\s)(?<![\w.])getDb\(\)/g, 'await getDb()');

  // .prepare(...).get/all/run( → await .prepare(...).get/all/run(
  // Handle single-line and common multi-line prepare
  s = s.replace(/(?<!await\s)(\w+)\.prepare\(([\s\S]*?)\)\.(get|all|run)\(/g, 'await $1.prepare($2).$3(');

  // db.exec( → await db.exec( / database.exec(
  s = s.replace(/(?<!await\s)(\w+)\.exec\(/g, 'await $1.exec(');

  // Fix DatabaseSync type imports
  s = s.replace(/import type \{ DatabaseSync \} from 'node:sqlite';\n?/g, '');
  s = s.replace(/: DatabaseSync/g, ': Db');
  s = s.replace(/import type \{ DatabaseSync \}/g, "import type { Db }");

  // Ensure Db is imported from database when using Db type and file already imports from database
  if (s.includes(': Db') && s.includes("from '../db/database.js'") && !s.includes('type Db') && !s.includes('{ Db')) {
    s = s.replace(
      /import \{([^}]+)\} from '\.\.\/db\/database\.js'/,
      (m, inner) => {
        if (inner.includes('Db')) return m;
        return `import {${inner.replace(/\s+$/, '')}, type Db } from '../db/database.js'`;
      }
    );
  }
  if (s.includes(': Db') && s.includes("from './database.js'") && !s.includes('type Db') && !/\bDb\b/.test(s.match(/import \{([^}]+)\} from '\.\/database\.js'/)?.[1] || '')) {
    s = s.replace(
      /import \{([^}]+)\} from '\.\/database\.js'/,
      (m, inner) => {
        if (inner.includes('Db')) return m;
        return `import {${inner.replace(/\s+$/, '')}, type Db } from './database.js'`;
      }
    );
  }

  // Express route handlers: (req, res) => {  → async
  s = s.replace(/,(\s*)\((req[^)]*)\)\s*=>\s*\{/g, ',$1async ($2) => {');
  s = s.replace(/async async \(/g, 'async (');

  s = s.replace(
    /export function (authMiddleware|optionalAuth|adminMiddleware)\(/g,
    'export async function $1('
  );
  s = s.replace(
    /export function (createNotification)\(/g,
    'export async function $1('
  );
  s = s.replace(
    /export function (seedDatabase|seedAppSettings|seedMonetizationExamples|getSetting|setSetting|getMonetizationSettings|expireStaleAdvertisements|listActiveAdvertisements|applyMonetizationExamples|ensureAdminUser)\(/g,
    'export async function $1('
  );
  s = s.replace(/export async async function/g, 'export async function');
  // await createNotification(...)
  s = s.replace(/(?<!await\s)createNotification\(/g, 'await createNotification(');

  return s;
}

function processFile(full) {
  const before = fs.readFileSync(full, 'utf8');
  if (!before.includes('getDb') && !before.includes('.prepare(') && !before.includes('DatabaseSync') && !before.includes('.exec(')) {
    return;
  }
  const after = transform(before, full);
  if (after !== before) {
    fs.writeFileSync(full, after);
    console.log('updated', full);
  }
}

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else if (name.endsWith('.ts')) processFile(full);
  }
}

for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  if (fs.statSync(root).isDirectory()) walk(root);
  else processFile(root);
}

// index.ts
const indexPath = path.resolve('server/src/index.ts');
if (fs.existsSync(indexPath)) {
  let s = fs.readFileSync(indexPath, 'utf8');
  const before = s;
  s = s.replace(/(?<!await\s)getDb\(\)/g, 'await getDb()');
  // make startup async
  if (!s.includes('async function start')) {
    s = s.replace(
      /getDb\(\);\r?\nexpireStaleAdvertisements\(getDb\(\)\);/,
      ''
    );
    // after translate:
    s = s.replace(
      /await getDb\(\);\r?\nexpireStaleAdvertisements\(await getDb\(\)\);/,
      ''
    );
  }
  if (s !== before) {
    fs.writeFileSync(indexPath, s);
    console.log('updated', indexPath);
  }
}

console.log('done');
