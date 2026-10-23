// v16.7 冒烟测试：默认方案（四方向移动 + 冲击 + 受击链 + 回血 + 受控锁定 + 射门维度合并）→ 派生图
// 验证：26 条事件能正确派生各维度逻辑图和总超图；体检提醒恰 2 条死胡同；冲击和回血是纯数值事件
// v16.7：「射门未激活」并入「无球」，「进入射门待命」删除；「距离小」前提=持球+距离小（用户原话落地）
import { createDefaultScenario2 } from '../src/lib/defaultScenario2';
import { buildDimensionGraph, buildTotalGraph, collectCoexist, collectConflicts, collectIssues } from '../src/lib/derive2';

const sc = createDefaultScenario2();
console.log(`方案「${sc.name}」：${sc.events.length} 条事件 · ${sc.dimensions.length} 个维度`);
console.log(`  角色 ${sc.events.filter((e) => e.owner === 'player').length} 条 · 球 ${sc.events.filter((e) => e.owner === 'ball').length} 条 · 球门 ${sc.events.filter((e) => e.owner === 'goal').length} 条`);
console.log(`  主动 ${sc.events.filter((e) => e.trigger === '主动').length} 条 · 被动 ${sc.events.filter((e) => e.trigger === '被动').length} 条`);

const issues = collectIssues(sc);
console.log(`体检提醒 ${issues.warnings.length} 条；纯数值事件 ${issues.pureNumeric.length} 条`);
for (const w of issues.warnings) console.log('  ⚠', w);

const expectEdges: Record<string, number> = { 球权: 4, 射门: 6, 位置: 30, 姿态: 2, 血量: 1, 球路: 8, 球门: 5 };
let totalEdges = 0;
for (const d of sc.dimensions) {
  const g = buildDimensionGraph(sc, d.id);
  totalEdges += g.edges.length;
  console.log(`逻辑图「${d.name}」：${g.nodes.length} 状态 · ${g.edges.length} 条变化 · 起点 ${sc.startState[d.id] ?? '（无）'}`);
  if (g.edges.length !== expectEdges[d.name]) {
    console.error(`❌ 维度「${d.name}」应有 ${expectEdges[d.name]} 条变化，实际 ${g.edges.length}`);
    process.exit(1);
  }
}

const total = buildTotalGraph(sc);
console.log(`总超图：${total.nodes.length} 状态 · ${total.edges.length} 条变化`);

const expect = (cond: boolean, msg: string) => { if (!cond) { console.error('❌ ' + msg); process.exit(1); } };
expect(sc.events.length === 26, `默认事件应为 26 条，实际 ${sc.events.length}`);
expect(sc.dimensions.length === 7, `应有 7 个维度（含球门），实际 ${sc.dimensions.length}`);
// 体检写全后，默认方案应恰有 2 条死胡同提醒：血量<50（已知的待设计出口）和结算（故意终局）
expect(issues.warnings.length === 2 && issues.warnings.every((w) => w.includes('死胡同')),
  `应只有 2 条死胡同提醒（血量<50、结算），实际 ${issues.warnings.length} 条：${issues.warnings.join('；')}`);
expect(issues.warnings.some((w) => w.includes('血量<50')) && issues.warnings.some((w) => w.includes('结算')),
  '死胡同应点名为血量<50 和结算');
const pureNames = issues.pureNumeric.map((e) => e.name).sort();
expect(pureNames.length === 2 && pureNames.includes('冲击') && pureNames.includes('回血'), `纯数值事件应是冲击和回血，实际 ${pureNames.join('、')}`);
// v16.7 合并断言：进入射门待命已删除；距离小 = 无球→射门激活，前提持球
expect(!sc.events.some((e) => e.name === '进入射门待命'), '「进入射门待命」应已删除');
const distSmall = sc.events.find((e) => e.name === '距离小')!;
const sDim = sc.dimensions.find((d) => d.name === '射门')!;
const pDim = sc.dimensions.find((d) => d.name === '球权')!;
expect(sDim.states.join('/') === '无球/射门激活/蓄力', `射门维度应为 3 状态（无球/射门激活/蓄力），实际 ${sDim.states.join('/')}`);
expect(distSmall.effects.length === 1 && distSmall.effects[0].from === '无球' && distSmall.effects[0].to === '射门激活',
  '距离小应是 无球→射门激活');
expect(distSmall.preStates.some((p) => p.dimension === pDim.id && p.state === '持球' && !p.not), '距离小前提应含「球权=持球」');
expect(total.edges.length === totalEdges, `总超图边数 ${total.edges.length} 应等于各维度边数之和 ${totalEdges}`);
expect(total.edges.length === 56, `总超图应有 56 条变化（v16.7 射门维度合并后），实际 ${total.edges.length}`);
expect(total.nodes.length === 25, `总超图应有 25 个状态，实际 ${total.nodes.length}`);
expect(total.nodes.filter((n) => n.isStart).length === 6, '总超图应有 6 个起始状态（两个「无球」粘合成一个）');
// v16.7 粘合断言：球权·无球 和 射门·无球 在总超图里应是同一个节点，且标了粘合
const gluedBall = total.nodes.find((n) => n.name === '无球');
expect(!!gluedBall && gluedBall.glued && gluedBall.dims.length === 2, '总超图里「无球」应是两个维度粘合而成的同一节点');

// ---------- 矛盾分栏（v16.6） ----------
const conflicts = collectConflicts(sc);
const coexists = collectCoexist(sc);
console.log(`  矛盾岔路口 ${conflicts.length} 个（被动撞车 ${conflicts.filter((c) => c.risk === '被动撞车').length} 个），纯共存点 ${coexists.length} 处`);
// 射门维度「射门激活」合并后是两岔口：→无球（传球主动+距离大被动共存）/ →蓄力（蓄力主动）
const c1 = conflicts.find((c) => c.dimName === '射门' && c.from === '射门激活');
expect(!!c1 && c1.branches.length === 2, `射门激活应有 2 个去向分支，实际 ${c1?.branches.length}`);
expect(c1!.branches.some((b) => b.to === '无球' && b.events.length === 2), '射门激活→无球 应是传球+距离大的共存分支');
expect(c1!.branches.some((b) => b.to === '蓄力' && b.events.length === 1), '射门激活→蓄力 应只有蓄力一条');
// 位置「中带-中」：前进+冲刺同去对方-中（共存卡牌），另有三个去向
const c2 = conflicts.find((c) => c.dimName === '位置' && c.from === '中带-中');
expect(!!c2 && c2.branches.length === 4, `中带-中应有 4 个去向分支，实际 ${c2?.branches.length}`);
expect(c2!.branches.some((b) => b.to === '对方-中' && b.events.length === 2), '中带-中→对方-中 应是前进+冲刺的共存分支');
// 纯共存：球权·持球→无球 有 传球/掉球/射门 三条；射门·蓄力→无球 有 射门/打断
expect(coexists.some((c) => c.dimName === '球权' && c.from === '持球' && c.to === '无球' && c.events.length === 3),
  '球权·持球→无球 应有三条事件共存（传球/掉球/射门）');
expect(coexists.some((c) => c.dimName === '射门' && c.from === '蓄力' && c.to === '无球' && c.events.length === 2),
  '射门·蓄力→无球 应有两条事件共存（射门/打断）');
// 矛盾栏里跨分支两两矛盾、分支内不矛盾（构造保证，这里验证构造没串味）
for (const g of conflicts) {
  for (let i = 0; i < g.branches.length; i++) for (let j = i + 1; j < g.branches.length; j++) {
    expect(g.branches[i].to !== g.branches[j].to, `栏 ${g.dimName}·${g.from} 的不同分支去向必须不同`);
  }
}
console.log('✅ 全部断言通过');
