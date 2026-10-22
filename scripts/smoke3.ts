// 阶段 2 冒烟测试：图上写回操作 + 旧存档转换
import { createDefaultScenario2 } from '../src/lib/defaultScenario2';
import { createDefaultScenario } from '../src/lib/defaultScenario';
import { addEffectToEvent, addState, createEventForLink, removeEffect, removeState } from '../src/lib/edit2';
import { convertOldScenario } from '../src/lib/convert14';
import { buildTotalGraph, collectIssues } from '../src/lib/derive2';

let failed = false;
const expect = (cond: boolean, msg: string) => { if (!cond) { console.error('❌ ' + msg); failed = true; } else { console.log('✓ ' + msg); } };

// ---------- 写回操作 ----------
const sc = createDefaultScenario2();
const posDim = sc.dimensions.find((d) => d.name === '位置')!;
const ballDim = sc.dimensions.find((d) => d.name === '球路')!;

const r1 = addState(sc, posDim.id, '禁区');
expect(r1.ok && r1.sc.dimensions.find((d) => d.id === posDim.id)!.states.includes('禁区'), '双击空白：位置维度新增「禁区」');
expect(!addState(r1.ok ? r1.sc : sc, posDim.id, '禁区').ok, '同名状态被拒绝');

const r2 = createEventForLink(sc, posDim.id, '禁区', '本方-中', '回防');
expect(r2.ok && r2.sc.events.some((e) => e.name === '回防' && e.owner === 'player' && e.effects.length === 1), '连线新建事件「回防」（归属角色）');
expect(!createEventForLink(sc, posDim.id, '禁区', '本方-中', '').ok, '空事件名被拒绝');

const move = sc.events.find((e) => e.name === '前进')!;
const r3 = addEffectToEvent(sc, move.id, posDim.id, '禁区', '本方-中');
expect(r3.ok && r3.sc.events.find((e) => e.id === move.id)!.effects.length === move.effects.length + 1, '连线挂到已有事件「前进」');
expect(r3.ok && !addEffectToEvent(r3.sc, move.id, posDim.id, '禁区', '本方-中').ok, '重复变化被拒绝');

const ballEvent = sc.events.find((e) => e.name === '传出')!;
expect(!addEffectToEvent(sc, ballEvent.id, posDim.id, '禁区', '本方-中').ok, '球的事件拒绝写角色维度（实体铁律）');

const r4 = removeEffect(r3.sc, `${move.id}#${move.effects.length}`);
expect(r4.ok && r4.sc.events.find((e) => e.id === move.id)!.effects.length === move.effects.length, '删除刚加的那条变化');

expect(!removeState(sc, posDim.id, '本方-中').ok, '被引用的状态拒绝删除');
const r5 = addState(sc, posDim.id, '角落');
expect(r5.ok && removeState(r5.sc, posDim.id, '角落').ok, '无引用状态可删除');
void ballDim;

// ---------- 旧存档转换 ----------
const old = createDefaultScenario(); // 旧版 v14 默认方案（6 张图）
const { sc2, report } = convertOldScenario(old);
console.log('\n转换报告：');
for (const l of report) console.log('  ' + l);

const issues = collectIssues(sc2);
const total = buildTotalGraph(sc2);
expect(sc2.dimensions.length === 6, `转换出 6 个维度，实际 ${sc2.dimensions.length}`);
expect(sc2.events.length === 25, `25 条事件（同名边合并），实际 ${sc2.events.length}`);
expect(total.edges.length === 68, `总超图应有 68 条变化，实际 ${total.edges.length}`);
expect(total.nodes.length === 22, `总超图应有 22 个状态（持球/无球粘合），实际 ${total.nodes.length}`);
expect(total.nodes.filter((n) => n.glued).length === 2, '持球/无球两个同名粘合状态');
expect(issues.warnings.length === 0, `转换结果体检应无提醒，实际 ${issues.warnings.length}：${issues.warnings.join('；')}`);
expect(Object.keys(sc2.startState).length === 6, '起始状态 6 项已映射到新维度');

if (failed) { console.error('\n❌ 有断言失败'); process.exit(1); }
console.log('\n✅ 阶段 2 全部断言通过');
