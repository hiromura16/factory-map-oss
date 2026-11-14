import { copyFile, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('.', import.meta.url));
await rm(new URL('.build/', import.meta.url), { recursive: true, force: true });
await build({
  absWorkingDir: directory,
  entryPoints: ['src/console/ui.jsx'],
  outfile: '.build/vendor/factory-ui.js',
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2022'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  legalComments: 'linked',
});
for (const name of ['react', 'react-dom', 'scheduler']) {
  await copyFile(
    new URL('node_modules/' + name + '/LICENSE', import.meta.url),
    new URL('.build/vendor/LICENSE-' + name + '.txt', import.meta.url),
  );
}
