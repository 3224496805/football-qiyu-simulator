// 用 esbuild 把算法原型脚本打包成 node 可跑的 mjs（处理 @/ 路径别名）
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = process.argv[2] ?? 'scripts/algo-proto.ts';
const out = path.join(root, 'scripts', '.' + path.basename(entry).replace(/\.ts$/, '.bundle.mjs'));
await build({
  entryPoints: [path.join(root, entry)],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: out,
  alias: { '@': path.join(root, 'src') },
  logLevel: 'silent',
});
console.log('打包完成 ->', path.relative(root, out));
