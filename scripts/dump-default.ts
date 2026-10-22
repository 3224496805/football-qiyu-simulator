// 把 v16 默认方案导出成 JSON（用于注入浏览器存档）
import { createDefaultScenario2 } from '../src/lib/defaultScenario2';
import * as fs from 'fs';
const sc = createDefaultScenario2();
fs.writeFileSync('scripts/.default-v16.json', JSON.stringify(sc));
console.log(`已导出：${sc.events.length} 条事件，id=${sc.id}`);
