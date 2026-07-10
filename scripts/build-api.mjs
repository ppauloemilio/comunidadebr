import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const outfile = path.resolve('api/index.js');

await esbuild.build({
  entryPoints: [path.resolve('api/vercel-handler.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile,
  sourcemap: false,
  logLevel: 'info',
  // Keep native/optional packages external if any appear later
  external: ['sharp', 'canvas'],
});

// Remove TS entry so Vercel uses the bundled JS
const tsEntry = path.resolve('api/index.ts');
if (fs.existsSync(tsEntry)) fs.unlinkSync(tsEntry);

console.log('API bundled ->', outfile);
