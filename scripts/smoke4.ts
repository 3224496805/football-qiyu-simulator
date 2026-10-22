// 阶段 3 冒烟测试：优先级 v2 + 动态模拟
import { createDefaultScenario2 } from '../src/lib/defaultScenario2';
import { computePriorities2 } from '../src/lib/priority2';
import { initSim2, stepSim2 } from '../src/lib/sim2';

let failed = false;
const expect = (cond: boolean, msg: string) => { if (!cond) { console.error('❌ ' + msg); failed = true; } else { console.log('✓ ' + msg); } };

const sc = createDefaultScenario2();

// ---------- 优先级 v2 ----------
const t0 = Date.now();
const pr = computePriorities2(sc);
console.log(`优先级 v2：${pr.stateCount} 状态 · ${pr.edgeCount} 变化 · ${pr.iterations} 轮收敛 · ${Date.now() - t0}ms`);
expect(pr.rows.length === 20, `20 条事件全部参与排名，实际 ${pr.rows.length}`);
expect(pr.mainLoop.length >= 2, `主循环至少 2 个状态，实际 ${pr.mainLoop.length}（${pr.mainLoop.join('、')}）`);
expect(pr.rows.every((r) => r.score > 0), '每条事件得分都大于 0');
expect(pr.rows.some((r) => r.penalized), '存在被短环惩罚的事件（无球⇄持球 小圈）');
expect(pr.rows[0].score >= pr.rows[pr.rows.length - 1].score, '排名按分数降序');
console.log('  前五名：' + pr.rows.slice(0, 5).map((r) => `${r.name}=${r.score}`).join('，'));
console.log('  被短环惩罚：' + (pr.rows.filter((r) => r.penalized).map((r) => r.name).join('、') || '无'));

// ---------- 动态模拟 ----------
let sim = initSim2(sc);
const seen = new Set<string>(); // 日志只保留最近 300 条，关键事件边跑边记
for (let i = 0; i < 3000 && !sim.over; i++) {
  sim = stepSim2(sc, sim);
  for (const l of sim.log) {
    if (l.tick !== sim.tick) continue;
    if (l.text.includes('拿球')) seen.add('拿球');
    if (l.text.includes('传球') || l.text.includes('蓄力')) seen.add('传球或蓄力');
    if (l.text.includes('球门拿球')) seen.add('球门拿球');
  }
}
console.log(`\n模拟：跑到第 ${sim.tick} 拍，日志 ${sim.log.length} 条，比赛${sim.over ? '已结束（进 3 球结算）' : '未结束'}`);
expect(sim.log.length > 50, `300 拍内应有大量事件日志，实际 ${sim.log.length}`);
expect(sim.tick > 20, `比赛不应 20 拍内就结束（蓄力要 3 拍、同名抢占每拍限一次），实际 ${sim.tick} 拍`);
expect(seen.has('拿球'), '日志里应出现拿球');
expect(seen.has('传球或蓄力'), '日志里应出现传球或蓄力');
expect(seen.has('球门拿球'), '日志里应出现球门拿球（进球链路跑通）');
expect(sim.over, '3000 拍内应完成 3 球结算（射门链路全通）');
const goal = sim.entities.find((e) => e.kind === 'goal')!;
console.log('  球门最终状态：' + Object.values(goal.states).join('、'));
console.log('  最后 5 条日志：');
for (const l of sim.log.slice(-5)) console.log(`    [${l.tick}] ${l.text}`);

if (failed) { console.error('\n❌ 有断言失败'); process.exit(1); }
console.log('\n✅ 阶段 3 全部断言通过');
