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
  external: ['sharp', 'canvas'],
});

// Ensure no competing TS serverless entry
for (const name of ['index.ts', 'index.mjs']) {
  const p = path.resolve('api', name);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

console.log('API bundled ->', outfile);
