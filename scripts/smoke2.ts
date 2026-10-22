// v15.4 冒烟测试：精简版默认方案（球门实体）→ 派生图
// 验证：20 条事件能正确派生各维度逻辑图和总超图；只有 2 条"故意留的"提醒（掉球/打断监听待重构的受击）
import { createDefaultScenario2 } from '../src/lib/defaultScenario2';
import { buildDimensionGraph, buildTotalGraph, collectIssues } from '../src/lib/derive2';

const sc = createDefaultScenario2();
console.log(`方案「${sc.name}」：${sc.events.length} 条事件 · ${sc.dimensions.length} 个维度`);
console.log(`  角色 ${sc.events.filter((e) => e.owner === 'player').length} 条 · 球 ${sc.events.filter((e) => e.owner === 'ball').length} 条 · 球门 ${sc.events.filter((e) => e.owner === 'goal').length} 条`);
console.log(`  主动 ${sc.events.filter((e) => e.trigger === '主动').length} 条 · 被动 ${sc.events.filter((e) => e.trigger === '被动').length} 条`);

const issues = collectIssues(sc);
console.log(`体检提醒 ${issues.warnings.length} 条；纯数值事件 ${issues.pureNumeric.length} 条`);
for (const w of issues.warnings) console.log('  ⚠', w);

const expectEdges: Record<string, number> = { 球权: 4, 射门: 11, 位置: 30, 姿态: 0, 血量: 0, 球路: 8, 球门: 5 };
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
expect(sc.events.length === 20, `默认事件应为 20 条，实际 ${sc.events.length}`);
expect(sc.dimensions.length === 7, `应有 7 个维度（含球门），实际 ${sc.dimensions.length}`);
expect(issues.warnings.length === 2, `应只有 2 条提醒（掉球/打断监听受击），实际 ${issues.warnings.length}`);
expect(issues.pureNumeric.length === 0, '不应有纯数值事件');
expect(total.edges.length === totalEdges, `总超图边数 ${total.edges.length} 应等于各维度边数之和 ${totalEdges}`);
expect(total.edges.length === 58, `总超图应有 58 条变化，实际 ${total.edges.length}`);
expect(total.nodes.length === 27, `总超图应有 27 个状态，实际 ${total.nodes.length}`);
expect(total.nodes.filter((n) => n.isStart).length === 7, '总超图应有 7 个起始状态');
console.log('✅ 全部断言通过');
