// 一次性迁移：把用户浏览器里的方案从 v16.6 结构迁到 v16.7（射门维度合并）
// 用法：node scripts/bundle-tool.mjs scripts/migrate-merge-shoot.ts && node scripts/.migrate-merge-shoot.bundle.mjs <输入.json> <输出.json>
// 规则：射门维度「射门未激活」「未持球」统一改名「无球」；自环变化删除；「进入射门待命」删除；
//       「距离小」补上前提「球权=持球」。其余事件（含用户自建的「控制」）原样保留。
import { readFileSync, writeFileSync } from 'fs';
import { collectIssues, collectConflicts, buildTotalGraph } from '../src/lib/derive2';

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) { console.error('用法：… <输入.json> <输出.json>'); process.exit(1); }

const sc = JSON.parse(readFileSync(inPath, 'utf8'));
const shoot = sc.dimensions.find((d: any) => d.name === '射门' && d.owner === 'player');
const ball = sc.dimensions.find((d: any) => d.name === '球权' && d.owner === 'player');
if (!shoot || !ball) { console.error('没找到射门/球权维度'); process.exit(1); }

const log: string[] = [];
const before = sc.events.length;

// 1. 删「进入射门待命」（无它了）
sc.events = sc.events.filter((e: any) => e.name !== '进入射门待命');
if (sc.events.length < before) log.push('已删「进入射门待命」');

// 2. 射门维度状态表 + 说明
shoot.states = ['无球', '射门激活', '蓄力'];
shoot.note = '射门状态机：基础状态叫「无球」（没球、或有球但离球门远都算）；拿着球且离球门够近才进「射门激活」→ 蓄力 → 出脚';
if (sc.startState?.[shoot.id]) sc.startState[shoot.id] = '无球';

// 3. 所有事件里落在射门维度的变化：未持球/射门未激活 → 无球；自环删除；完全重复的变化去重
const RENAME: Record<string, string> = { 未持球: '无球', 射门未激活: '无球' };
for (const ev of sc.events) {
  const seen = new Set<string>();
  ev.effects = (ev.effects as any[]).flatMap((f) => {
    if (f.dimension !== shoot.id) { seen.add(f.dimension + '|' + f.from + '|' + f.to); return [f]; }
    const from = RENAME[f.from] ?? f.from;
    const to = RENAME[f.to] ?? f.to;
    if (from === to) { log.push(`「${ev.name}」删掉自环变化 ${from}→${to}`); return []; }
    const key = f.dimension + '|' + from + '|' + to;
    if (seen.has(key)) { log.push(`「${ev.name}」去掉重复变化 ${from}→${to}`); return []; }
    seen.add(key);
    return [{ ...f, from, to }];
  });
}

// 4. 「距离小」补前提：球权=持球（没有才补）
const distSmall = sc.events.find((e: any) => e.name === '距离小');
if (distSmall) {
  const has = (distSmall.preStates as any[]).some((p) => p.dimension === ball.id && p.state === '持球' && !p.not);
  if (!has) { distSmall.preStates.push({ dimension: ball.id, state: '持球' }); log.push('「距离小」已补前提：球权=持球'); }
  distSmall.condition = '拿着球、且与球门距离 ≤ 射门距离参数（两个条件同时满足才触发；模拟器按真实格子判定）';
}

sc.updatedAt = Date.now();
sc.name = sc.name.replace(/（.*?）/, '') + '（v16.7 射门合并）';

// ---- 验证 ----
const issues = collectIssues(sc);
const conflicts = collectConflicts(sc);
const total = buildTotalGraph(sc);
console.log(log.join('\n'));
console.log(`迁移后：${sc.events.length} 条事件 · 射门维度 [${shoot.states.join('/')}] · 总超图 ${total.nodes.length} 状态 ${total.edges.length} 变化`);
console.log(`体检 ${issues.warnings.length} 条；矛盾岔路口 ${conflicts.length} 个`);
const names = sc.events.map((e: any) => e.name);
console.log('事件名单：' + names.join('、'));
if (!names.includes('控制')) { console.error('❌ 用户的「控制」事件丢了！'); process.exit(1); }
writeFileSync(outPath, JSON.stringify(sc), 'utf8');
console.log('已写出 -> ' + outPath);
