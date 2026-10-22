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
expect(pr.rows.length === 21, `复合合并后应为 21 行（拿球/传球/掉球/射门 各合成一条），实际 ${pr.rows.length}`);
expect(pr.rows.filter((r) => r.trigger === '复合').length === 4, '应有 4 条复合事件（拿球/传球/掉球/射门）');
expect(pr.mainLoop.length >= 2, `主循环至少 2 个状态，实际 ${pr.mainLoop.length}（${pr.mainLoop.join('、')}）`);
expect(pr.rows.every((r) => r.score > 0), '每条事件得分都大于 0');
expect(pr.smallCycles.length >= 1, `应检测到短环（无球⇄持球 小圈），实际 ${pr.smallCycles.length} 个`);
expect(pr.rows[0].score >= pr.rows[pr.rows.length - 1].score, '排名按分数降序');
console.log('  前五名：' + pr.rows.slice(0, 5).map((r) => `${r.name}=${r.score}`).join('，'));
console.log('  被短环惩罚：' + (pr.rows.filter((r) => r.penalized).map((r) => r.name).join('、') || '无'));

// ---------- 公式权重滑杆 ----------
// 纯手动权重时，排名应严格按「基础优先级」降序（复合组取组内最高）
const prManual = computePriorities2(sc, { wSteady: 0, wPath: 0, wManual: 1, penalty: 0.3, jump: 0.15 });
const manualSorted = prManual.rows.every((r, i, arr) => i === 0 || arr[i - 1].manual >= r.manual - 1e-9);
expect(manualSorted, '手动权重=1 时，排名应按基础优先级降序');
expect(Math.abs(prManual.rows[0].score - prManual.rows[0].manual) < 1e-9, '纯手动权重时 最终分 = 手动分');
// 改权重后分数应变化（且回显的权重就是传入的）
const prAlt = computePriorities2(sc, { wSteady: 0.1, wPath: 0.8, wManual: 0.1, penalty: 1, jump: 0.3 });
expect(prAlt.weights.wPath === 0.8, '计算结果应回显实际使用的权重');
const anyScoreChanged = prAlt.rows.some((r) => {
  const old = pr.rows.find((x) => x.eventId === r.eventId);
  return old && Math.abs(old.score - r.score) > 1e-9;
});
expect(anyScoreChanged, '改权重后至少一条事件分数应变');
// 短环惩罚 1（不惩罚）时，没有任何行被压分
expect(prAlt.rows.every((r) => !r.penalized || Math.abs(r.score - (0.1 * r.steady + 0.8 * r.path + 0.1 * r.manual)) < 1e-3),
  '短环惩罚=1 时短环行得分 = 三项加权和（不被压）');

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

// ---------- 受击链路：冲击扣血 60 → 血量跌破 50 → 受击 → 掉球 → 球变自由 ----------
{
  const sc2 = JSON.parse(JSON.stringify(sc)) as typeof sc;
  const hit = sc2.events.find((e) => e.name === '冲击')!;
  const dmg = hit.numeric.find((n) => n.kind === '扣血')!;
  dmg.amount = 60; // 一下打穿 50 门槛
  const seenHit = new Set<string>();
  let sim2b = initSim2(sc2);
  for (let i = 0; i < 1500 && !sim2b.over; i++) {
    sim2b = stepSim2(sc2, sim2b);
    for (const l of sim2b.log) {
      if (l.tick !== sim2b.tick) continue;
      if (l.text.includes('冲击')) seenHit.add('冲击');
      if (l.text.includes('受击')) seenHit.add('受击');
      if (l.text.includes('掉球')) seenHit.add('掉球');
      if (l.text.includes('球变自由')) seenHit.add('球变自由');
    }
    if (seenHit.size === 4) break; // 链路跑通就提前结束
  }
  console.log(`\n受击链路（扣血调到 60）：跑到第 ${sim2b.tick} 拍`);
  expect(seenHit.has('冲击'), '应出现冲击');
  expect(seenHit.has('受击'), '应出现受击（血量跌破门槛）');
  expect(seenHit.has('掉球'), '应出现掉球（姿态自由→受控 + 球权持球→无球）');
  expect(seenHit.has('球变自由'), '应出现球变自由（球侧联动）');
  // 受击只能在 hp<50 瞬间触发一次：统计每个角色受击次数不应超过 1 次（hp 不回满的话）
  const hitCount = sim2b.log.filter((l) => l.text.includes('受击')).length;
  console.log(`  受击共触发 ${hitCount} 次（日志只留最近 300 条，仅作参考）`);
}

if (failed) { console.error('\n❌ 有断言失败'); process.exit(1); }
console.log('\n✅ 阶段 3 全部断言通过');
