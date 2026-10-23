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
expect(pr.rows.length === 22, `复合合并后应为 22 行（26 条事件 - 8 个复合半边 + 4 条复合），实际 ${pr.rows.length}`);
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

// ---------- 纯数值事件锚点评分（v16.5 修正：冲击/回血不应零图分） ----------
const chongji = pr.rows.find((r) => r.name === '冲击')!;
const huixue = pr.rows.find((r) => r.name === '回血')!;
expect(chongji.steady > 0 || chongji.path > 0, `冲击应有图分（前提锚点），实际 稳态${chongji.steady} 路径${chongji.path}`);
expect(huixue.steady > 0 || huixue.path > 0, `回血应有图分（前提锚点），实际 稳态${huixue.steady} 路径${huixue.path}`);
expect(chongji.score > 0.3, `冲击总分应明显高于纯手动分 0.18，实际 ${chongji.score}`);
expect(huixue.score > 0.1, `回血总分应明显高于纯手动分 0.06，实际 ${huixue.score}`);
expect(!chongji.penalized && !huixue.penalized, '纯数值事件不应被短环惩罚');
console.log(`  锚点评分：冲击 ${chongji.score}（锚点「${chongji.bestFrom}」，第 ${chongji.rank} 名），回血 ${huixue.score}（锚点「${huixue.bestFrom}」，第 ${huixue.rank} 名）`);

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
// 下限只防"秒结束"类退化：v16.7 合并后射门少了一跳，3 球理论上 ~15 拍可完成；人机有随机性，阈值留足余量
expect(sim.tick > 15, `比赛不应 15 拍内就结束（蓄力要 3 拍、同名抢占每拍限一次），实际 ${sim.tick} 拍`);
expect(seen.has('拿球'), '日志里应出现拿球');
expect(seen.has('传球或蓄力'), '日志里应出现传球或蓄力');
expect(seen.has('球门拿球'), '日志里应出现球门拿球（进球链路跑通）');
expect(sim.over, '3000 拍内应完成 3 球结算（射门链路全通）');
const goal = sim.entities.find((e) => e.kind === 'goal')!;
console.log('  球门最终状态：' + Object.values(goal.states).join('、'));
console.log('  最后 5 条日志：');
for (const l of sim.log.slice(-5)) console.log(`    [${l.tick}] ${l.text}`);

// ---------- 受击链路：冲击扣血 60 → 血量跌破 50 → 受击 → 掉球 → 球变自由 ----------
// 注意一条真实规则竞态：若受害者挨打时正在蓄力且蓄力恰好到期，「射门」会与「受击」同拍触发——
// 球已飞向球门，「球变自由」就没有「球被持有」可接（符合规则，不是链路断了）。所以最多连试 3 局，任一局链路完整即通过。
{
  let chainOk = false;
  let lastTick = 0;
  let lastHitCount = 0;
  for (let trial = 0; trial < 3 && !chainOk; trial++) {
    const sc2 = JSON.parse(JSON.stringify(sc)) as typeof sc;
    const hit = sc2.events.find((e) => e.name === '冲击')!;
    const dmg = hit.numeric.find((n) => n.kind === '扣血')!;
    dmg.amount = 60; // 一下打穿 50 门槛
    // 本段只验证受击链路：摘掉「比赛结算」（防终局提前打断）和「蓄力」「射门」
    // （防"挨打同拍蓄力恰好到期→射门抢先出脚"的规则竞态把球先送进球门，那是合规行为，不是链路断了）
    sc2.events = sc2.events.filter((e) => e.name !== '比赛结算' && e.name !== '蓄力' && e.name !== '射门');
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
    lastTick = sim2b.tick;
    lastHitCount = sim2b.log.filter((l) => l.text.includes('受击')).length;
    chainOk = seenHit.size === 4;
    console.log(`  受击链路第 ${trial + 1} 局：跑到第 ${lastTick} 拍，见到 ${[...seenHit].join('、') || '无'}`);
  }
  console.log(`\n受击链路（扣血调到 60）：最多 3 局，链路${chainOk ? '已跑通' : '未跑通'}`);
  expect(chainOk, '受击链路（冲击→受击→掉球→球变自由）3 局内应至少完整跑通一次');
  // 受击只能在 hp<50 瞬间触发一次：统计每个角色受击次数不应超过 1 次（hp 不回满的话）
  console.log(`  受击共触发 ${lastHitCount} 次（日志只留最近 300 条，仅作参考）`);
}

// ---------- 回血 + 受控锁定（v16.3 用户规则） ----------
{
  // 事件库层面：回血事件存在（被动/无球前提/回血 10/每拍一次）
  const regen = sc.events.find((e) => e.name === '回血')!;
  expect(!!regen && regen.trigger === '被动' && regen.numeric.some((n) => n.kind === '回血' && n.value === 10)
    && regen.preStates.some((p) => sc.dimensions.find((d) => d.id === p.dimension)?.name === '球权' && p.state === '无球'),
    '应有「回血」被动事件：前提无球、回血 10');
  // 所有主动事件都必须挂「姿态 ≠ 受控」前提（受控状态下主动事件全部失效）
  const actives = sc.events.filter((e) => e.trigger === '主动');
  expect(actives.every((e) => e.preStates.some((p) =>
    p.not && p.state === '受控' && sc.dimensions.find((d) => d.id === p.dimension)?.name === '姿态')),
    `全部 ${actives.length} 条主动事件都应有「姿态≠受控」前提`);

  // 模拟层面：搭一个"红1 受控 + 残血 40"的局面，跑 5 拍
  const sc3 = JSON.parse(JSON.stringify(sc)) as typeof sc;
  const sim3 = initSim2(sc3);
  const r1 = sim3.entities.find((e) => e.name === '红1')!;
  r1.hp = 40;
  const ziDim = sc3.dimensions.find((d) => d.name === '姿态')!;
  r1.states[ziDim.id] = '受控';
  let cur = sim3;
  for (let i = 0; i < 5; i++) cur = stepSim2(sc3, cur);
  const logs5 = cur.log.filter((l) => l.tick <= 5);
  expect(logs5.some((l) => l.text.includes('红1 被动触发「回血」') && l.text.includes('回血 10')),
    '受控+残血的红1 应持续回血（被动不受受控限制）');
  expect(!logs5.some((l) => l.text.includes('红1 主动执行')),
    '受控的红1 五拍内不应有任何主动事件触发');
  const r1After = cur.entities.find((e) => e.name === '红1')!;
  expect(r1After.hp > 40, `红1 血量应较 40 有所恢复，实际 ${r1After.hp}`);
  console.log(`  受控残血红1 跑 5 拍：hp 40 → ${r1After.hp}，主动事件 0 条`);

  // 受控是限时状态：再跑几拍，满「受控持续参数」（默认 5 拍）后应由「缓过来」自动恢复自由
  const recover = sc3.events.find((e) => e.name === '缓过来')!;
  expect(!!recover && recover.trigger === '被动'
    && recover.effects.some((f) => f.from === '受控' && f.to === '自由'
      && sc3.dimensions.find((d) => d.id === f.dimension)?.name === '姿态'),
    '应有「缓过来」被动事件：姿态 受控→自由');
  for (let i = 0; i < 5; i++) cur = stepSim2(sc3, cur); // 累计 10 拍
  const r1Later = cur.entities.find((e) => e.name === '红1')!;
  expect(cur.log.some((l) => l.text.includes('红1 被动触发「缓过来」')), '受控到期后应出现「缓过来」日志');
  expect(r1Later.states[ziDim.id] === '自由', `受控到期后红1 姿态应恢复自由，实际 ${r1Later.states[ziDim.id]}`);
  console.log(`  受控限时：第 ${cur.tick} 拍时红1 姿态 = ${r1Later.states[ziDim.id]}（受控持续参数 ${sc3.balance.controlTicks} 拍）`);
}

if (failed) { console.error('\n❌ 有断言失败'); process.exit(1); }
console.log('\n✅ 阶段 3 全部断言通过');
