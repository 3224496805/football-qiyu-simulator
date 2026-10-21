// 默认示例：3v3（6 玩家 + 1 球）+ 四个逻辑域
import type { DomainGraph, DomainId, Scenario, SkillTemplate } from '@/types/model';
import { DOMAIN_NAMES } from '@/types/model';
import { newId } from './storage';

let seq = 0;
const nid = (p: string) => `${p}_${seq++}`;
const eid = () => `e_${seq++}`;

interface NE { name: string; x: number; y: number; note?: string }

function makeGraph(domain: DomainId, nodeDefs: NE[], edges: Array<{
  event: string; from: string; to: string; condition: string;
  skillKind?: 'damage' | 'displacement'; isHyper?: boolean; affectsOthers?: boolean;
  basePriority?: number; cooldown?: number; structWeight?: number;
}>): DomainGraph {
  const nodes = nodeDefs.map((n) => ({ id: nid('n'), name: n.name, x: n.x, y: n.y, note: n.note }));
  const find = (name: string) => nodes.find((n) => n.name === name)!.id;
  return {
    domain,
    name: DOMAIN_NAMES[domain],
    nodes,
    edges: edges.map((e) => ({
      id: eid(),
      event: e.event,
      from: find(e.from),
      to: find(e.to),
      condition: e.condition,
      skillKind: e.skillKind,
      isHyper: e.isHyper ?? false,
      affectsOthers: e.affectsOthers ?? false,
      params: {
        basePriority: e.basePriority ?? 1,
        cooldown: e.cooldown ?? 0,
        structWeight: e.structWeight ?? 1,
      },
    })),
  };
}

// ---------- 球逻辑（含传球虚拟队友转接语义） ----------
const ballGraph = makeGraph('ball', [
  { name: '无球', x: 120, y: 260, note: 'BFS 起点' },
  { name: '持球', x: 340, y: 140 },
  { name: '队内拿球', x: 560, y: 140, note: '临时虚拟队友实体：球权在队内' },
  { name: '队外自由', x: 560, y: 340, note: '队友未接住 → 球权开放' },
  { name: '射门激活', x: 340, y: 400 },
  { name: '蓄力', x: 560, y: 480, note: '临时状态（唯一非永久状态）' },
  { name: '射门', x: 780, y: 400 },
], [
  { event: '拿', from: '无球', to: '持球', condition: '争抢成功（距离<抢截半径）', basePriority: 3 },
  { event: '传', from: '持球', to: '队内拿球', condition: '持球 且 传球键触发', isHyper: true, basePriority: 7, structWeight: 1.2 },
  { event: '拿', from: '队内拿球', to: '持球', condition: '队友满足拿球事件（在接球范围内）', isHyper: true, basePriority: 3 },
  { event: '掉', from: '队内拿球', to: '队外自由', condition: '队友未满足拿球事件', basePriority: 6 },
  { event: '拿', from: '队外自由', to: '持球', condition: '随机争抢判定', basePriority: 3 },
  { event: '掉', from: '持球', to: '无球', condition: '被断球 或 血量低于掉球阈值', basePriority: 6 },
  { event: '关闭射门技能', from: '射门激活', to: '持球', condition: '取消键 或 超时未射', basePriority: 1 },
  { event: '关闭射门技能', from: '蓄力', to: '持球', condition: '蓄力中取消', basePriority: 1 },
  { event: '激活射门技能', from: '持球', to: '射门激活', condition: '持球 且 射门键按下', basePriority: 2 },
  { event: '蓄力条更新', from: '射门激活', to: '蓄力', condition: '持续按住射门键', basePriority: 4 },
  { event: '射', from: '蓄力', to: '射门', condition: '位置状态∈{跑动,位移中} 且 松开射门键', skillKind: 'displacement', basePriority: 5 },
  { event: '关闭射门技能', from: '射门', to: '无球', condition: '射门动作结束（球出脚）', basePriority: 1 },
]);

// ---------- 位置逻辑（最复杂） ----------
const positionGraph = makeGraph('position', [
  { name: '原地', x: 140, y: 260 },
  { name: '跑动', x: 360, y: 140 },
  { name: '位移中', x: 360, y: 400 },
  { name: '冲刺', x: 580, y: 80 },
  { name: '僵直', x: 580, y: 400, note: '碰撞/受击硬直' },
  { name: '倒地', x: 800, y: 260 },
], [
  { event: '移动', from: '原地', to: '跑动', condition: '方向键输入', basePriority: 1, structWeight: 1.2 },
  { event: '停止', from: '跑动', to: '原地', condition: '无方向输入', basePriority: 1 },
  { event: '位移技能', from: '原地', to: '位移中', condition: '位移技能触发（距离=位移基准）', skillKind: 'displacement', basePriority: 2 },
  { event: '位移技能', from: '跑动', to: '位移中', condition: '位移技能触发（距离=位移基准）', skillKind: 'displacement', basePriority: 2 },
  { event: '位移结束', from: '位移中', to: '原地', condition: '位移距离耗尽', basePriority: 1 },
  { event: '冲刺', from: '跑动', to: '冲刺', condition: '冲刺键 且 体力>0', basePriority: 1 },
  { event: '体力耗尽', from: '冲刺', to: '原地', condition: '体力≤0', basePriority: 1 },
  { event: '碰撞', from: '位移中', to: '僵直', condition: '位移路径上存在碰撞体', skillKind: 'displacement', basePriority: 1 },
  { event: '受击', from: '跑动', to: '僵直', condition: '受到伤害事件 且 位置满足攻击范围', skillKind: 'damage', affectsOthers: true, basePriority: 2 },
  { event: '受击', from: '原地', to: '僵直', condition: '受到伤害事件 且 位置满足攻击范围', skillKind: 'damage', affectsOthers: true, basePriority: 2 },
  { event: '恢复', from: '僵直', to: '原地', condition: '僵直时间结束', basePriority: 1 },
  { event: '重击倒地', from: '僵直', to: '倒地', condition: '单次伤害>倒地阈值', skillKind: 'damage', affectsOthers: true, basePriority: 1 },
  { event: '起身', from: '倒地', to: '原地', condition: '倒地时间结束', basePriority: 1 },
]);

// ---------- 控制逻辑 ----------
const controlGraph = makeGraph('control', [
  { name: '自由', x: 200, y: 220 },
  { name: '受控', x: 440, y: 120 },
  { name: '霸体', x: 440, y: 340 },
], [
  { event: '受控', from: '自由', to: '受控', condition: '被控制技能命中', isHyper: true, affectsOthers: true, basePriority: 2 },
  { event: '解控', from: '受控', to: '自由', condition: '控制时间结束 或 解控技能', basePriority: 1 },
  { event: '霸体技能', from: '自由', to: '霸体', condition: '霸体技能触发', basePriority: 1 },
  { event: '霸体结束', from: '霸体', to: '自由', condition: '霸体持续时间结束', basePriority: 1 },
]);

// ---------- 血量逻辑 ----------
const hpGraph = makeGraph('hp', [
  { name: '健康', x: 140, y: 260 },
  { name: '受伤', x: 360, y: 140 },
  { name: '残血', x: 560, y: 140, note: '低于掉球阈值时触发掉球' },
  { name: '濒死', x: 760, y: 260 },
  { name: '虚弱', x: 560, y: 400, note: '已掉球' },
], [
  { event: '受伤', from: '健康', to: '受伤', condition: '伤害事件 且 位置前提满足（伤害大小=伤害基准）', skillKind: 'damage', affectsOthers: true, basePriority: 2 },
  { event: '受伤', from: '受伤', to: '残血', condition: '累计伤害达残血线', skillKind: 'damage', affectsOthers: true, basePriority: 2 },
  { event: '受伤', from: '残血', to: '濒死', condition: '累计伤害达濒死线', skillKind: 'damage', affectsOthers: true, basePriority: 2 },
  { event: '掉球', from: '残血', to: '虚弱', condition: '血量低于掉球阈值（跨逻辑域级联：血量→球）', isHyper: true, basePriority: 6 },
  { event: '回复', from: '受伤', to: '健康', condition: '治疗效果', basePriority: 1 },
  { event: '回复', from: '残血', to: '受伤', condition: '治疗效果', basePriority: 1 },
  { event: '回复', from: '濒死', to: '残血', condition: '治疗效果', basePriority: 1 },
  { event: '恢复', from: '虚弱', to: '健康', condition: '虚弱时间结束 且 重新拿球', basePriority: 1 },
]);

const defaultSkills: SkillTemplate[] = [
  { id: 'sk_dmg_1', name: '冲撞抢截', kind: 'damage', damage: 20, cooldown: 3, range: 1.5, note: '近身伤害+概率掉球' },
  { id: 'sk_dmg_2', name: '飞铲', kind: 'damage', damage: 30, cooldown: 6, range: 2.5, note: '高伤害，命中后自身僵直' },
  { id: 'sk_dmg_3', name: '肘击', kind: 'damage', damage: 12, cooldown: 2, range: 0.8, note: '低伤害短冷却' },
  { id: 'sk_dsp_1', name: '疾跑突进', kind: 'displacement', displacement: 6, cooldown: 5, range: 8, note: '直线位移' },
  { id: 'sk_dsp_2', name: '侧身闪避', kind: 'displacement', displacement: 3, cooldown: 2, range: 4, note: '短距离闪避' },
  { id: 'sk_dsp_3', name: '射门爆发', kind: 'displacement', displacement: 8, cooldown: 8, range: 10, note: '射门位移（射事件前提）' },
];

export function createDefaultScenario(): Scenario {
  seq = 0;
  const now = Date.now();
  return {
    id: newId(),
    name: '示例：3v3 标准赛',
    playersPerTeam: 3,
    graphs: {
      ball: ballGraph,
      position: positionGraph,
      control: controlGraph,
      hp: hpGraph,
    },
    skills: defaultSkills,
    balance: { damage: 15, hpMax: 100, hpDropThreshold: 30, displacement: 5 },
    createdAt: now,
    updatedAt: now,
  };
}
