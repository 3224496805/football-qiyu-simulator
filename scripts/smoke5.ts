// 阶段 4 冒烟测试：AI 生成 JSON 的解析与校验（aiImport2）
import { createDefaultScenario2 } from '../src/lib/defaultScenario2';
import { parseAiJson } from '../src/lib/aiImport2';

let failed = false;
const expect = (cond: boolean, msg: string) => { if (!cond) { console.error('❌ ' + msg); failed = true; } else { console.log('✓ ' + msg); } };

const sc = createDefaultScenario2();

// 1. 正常批次：新维度「体能」+ 3 条事件（含监听已有事件、跨实体前提、职业限定）
const good = JSON.stringify({
  newDimensions: [{ name: '体能', owner: '角色', states: ['充沛', '透支'], note: '冲刺消耗体能' }],
  events: [
    {
      name: '体能消耗', owner: 'player', trigger: '被动', listen: ['冲刺'],
      effects: [{ dimension: '体能', from: '充沛', to: '透支' }],
      condition: '冲刺一次消耗 30 体能', basePriority: 2,
    },
    {
      name: '体能恢复', owner: 'player', trigger: '被动',
      preStates: [{ dimension: '球权', state: '无球' }],
      effects: [{ dimension: '体能', from: '透支', to: '充沛' }],
      numeric: [{ kind: '回血', value: 5 }],
      condition: '无球静止时缓慢恢复',
    },
    {
      name: '带球冲刺', owner: 'player', trigger: '主动',
      preStates: [
        { dimension: '球权', state: '持球' },
        { dimension: '体能', state: '透支', not: true },
      ],
      effects: [{ dimension: '位置', from: '本方-中', to: '中带-中' }],
      professions: ['前锋'], basePriority: 5, cooldown: 2,
    },
  ],
});
const r1 = parseAiJson(sc, good);
expect(r1.ok, '正常批次应通过：' + r1.msg);
expect(r1.dims?.length === 1 && r1.dims[0].name === '体能', '应新增 1 个维度「体能」');
expect(r1.events?.length === 3, `应有 3 条事件，实际 ${r1.events?.length}`);
const dimId = r1.dims![0].id;
expect(r1.events![0].effects[0].dimension === dimId, '状态变化里的维度名应被翻译成新维度 id');
expect(r1.events![0].listen.includes('冲刺'), '监听已有事件「冲刺」应保留');
expect(r1.events![2].professions.length === 1, '职业名应被翻译成职业 id');
console.log('  汇总：' + r1.msg);

// 2. 容忍 Markdown 代码块包裹
const wrapped = '```json\n' + good + '\n```';
expect(parseAiJson(sc, wrapped).ok, 'Markdown 代码块包裹的 JSON 应能解析');

// 3. 各种拒绝场景
const bad = (obj: unknown) => parseAiJson(sc, JSON.stringify(obj));
expect(!bad({ events: [{ name: '坏', owner: 'player', trigger: '被动', listen: ['不存在的事件'], effects: [{ dimension: '体能', from: 'a', to: 'b' }] }] }).ok
  || !bad({ newDimensions: [{ name: '体能', owner: 'player', states: ['a', 'b'] }], events: [{ name: '坏', owner: 'player', trigger: '被动', listen: ['不存在的事件'], effects: [{ dimension: '体能', from: 'a', to: 'b' }] }] }).ok,
  '监听不存在的事件名应被拒绝');
const rListen = bad({ events: [{ name: '坏', owner: 'player', trigger: '被动', listen: ['不存在的事件'], effects: [{ dimension: '球权', from: '无球', to: '持球' }] }] });
expect(!rListen.ok && rListen.msg.includes('不存在'), '监听不存在的事件名应被拒绝并说明：' + rListen.msg);
const rCross = bad({ events: [{ name: '坏', owner: 'ball', trigger: '被动', effects: [{ dimension: '球权', from: '无球', to: '持球' }] }] });
expect(!rCross.ok && rCross.msg.includes('只能改自己'), '球的事件改角色维度应被拒绝（实体铁律）：' + rCross.msg);
const rDup = bad({ events: [{ name: '拿球', owner: 'player', trigger: '主动', effects: [{ dimension: '球权', from: '无球', to: '持球' }] }] });
expect(!rDup.ok && rDup.msg.includes('重名'), '与已有事件重名应被拒绝：' + rDup.msg);
const rActiveListen = bad({ events: [{ name: '坏', owner: 'player', trigger: '主动', listen: ['拿球'], effects: [{ dimension: '球权', from: '无球', to: '持球' }] }] });
expect(!rActiveListen.ok && rActiveListen.msg.includes('主动'), '主动事件填监听应被拒绝：' + rActiveListen.msg);
const rProf = bad({ events: [{ name: '坏', owner: 'player', trigger: '主动', effects: [{ dimension: '球权', from: '无球', to: '持球' }], professions: ['守门员'] }] });
expect(!rProf.ok && rProf.msg.includes('守门员'), '不存在的职业应被拒绝：' + rProf.msg);
const rEmpty = bad({ events: [{ name: '坏', owner: 'player', trigger: '主动' }] });
expect(!rEmpty.ok && rEmpty.msg.includes('空事件'), '空事件应被拒绝：' + rEmpty.msg);
const rDim = bad({ events: [{ name: '坏', owner: 'player', trigger: '主动', effects: [{ dimension: '不存在的维度', from: 'a', to: 'b' }] }] });
expect(!rDim.ok && rDim.msg.includes('可用维度'), '不存在的维度应被拒绝并列出可用维度：' + rDim.msg);
const rBadJson = parseAiJson(sc, '这不是 JSON');
expect(!rBadJson.ok, '非 JSON 文本应被拒绝');

if (failed) { console.error('\n❌ 有断言失败'); process.exit(1); }
console.log('\n✅ 阶段 4（AI 导入）全部断言通过');
