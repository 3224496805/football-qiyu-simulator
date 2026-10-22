// 用 esbuild 把 TS 测试脚本打包成 node 可跑的 mjs（处理 @/ 路径别名）
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(root, 'scripts/sim-smoke.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: path.join(root, 'scripts/.sim-smoke.bundle.mjs'),
  alias: { '@': path.join(root, 'src') },
  logLevel: 'silent',
});
console.log('打包完成');
