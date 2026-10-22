// 调试：打印模拟全程日志，找出"比赛过快结束"的原因
import { createDefaultScenario2 } from '../src/lib/defaultScenario2';
import { initSim2, stepSim2 } from '../src/lib/sim2';

const sc = createDefaultScenario2();
let sim = initSim2(sc);
for (let i = 0; i < 3000 && !sim.over; i++) sim = stepSim2(sc, sim);
console.log(`结束于第 ${sim.tick} 拍，over=${sim.over}，日志 ${sim.log.length} 条`);
if (process.env.FULL_LOG) for (const l of sim.log) console.log(`[${l.tick}] ${l.text}`);
