import esbuild from 'esbuild';
import process from 'process';

const isDev = process.argv.includes('--dev');

esbuild.build({
  entryPoints: ['main.ts'],
  bundle: true,
  external: ['obsidian'],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: isDev ? 'inline' : false,
  minify: !isDev,
  treeShaking: true,
  outfile: 'main.js',
}).catch(() => process.exit(1));
