// 默认示例 v3：3v3（6 角色 + 1 球）+ 职业系统（前锋/中场/后卫）+ 网格位置图
//
// 实体归属：
//   角色实体 ×6：球权逻辑 / 位置逻辑(网格) / 姿态控制 / 血量逻辑
//   球实体 ×1：球路逻辑（传球飞行→落地滚动→自由→被拿）
// 职业：同职业共享相同技能事件（边带 professionIds），不同职业技能事件不同
import type { DomainGraph, DomainId, PlayerSpec, Profession, Scenario, SkillTemplate } from '@/types/model';
import { DOMAIN_NAMES } from '@/types/model';
import { newId } from './storage';

let seq = 0;
const nid = (p: string) => `${p}_${seq++}`;
const eid = () => `e_${seq++}`;

interface NE { name: string; x: number; y: number; note?: string }

export function makeGraph(domain: DomainId, nodeDefs: NE[], edges: Array<{
  event: string; from: string; to: string; condition: string;
  skillKind?: 'damage' | 'displacement'; isHyper?: boolean; affectsOthers?: boolean;
  professionIds?: string[]; basePriority?: number; cooldown?: number; structWeight?: number;
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
      professionIds: e.professionIds,
      params: {
        basePriority: e.basePriority ?? 1,
        cooldown: e.cooldown ?? 0,
        structWeight: e.structWeight ?? 1,
      },
    })),
  };
}

// ---------- 球权逻辑（挂角色：球掉了或传出即结束） ----------
const possessionGraph = makeGraph('possession', [
  { name: '无球', x: 130, y: 260, note: 'DFS 起点' },
  { name: '持球', x: 360, y: 140 },
  { name: '射门激活', x: 360, y: 400 },
  { name: '蓄力', x: 590, y: 480, note: '临时状态，可取消/被打断' },
  { name: '射门', x: 810, y: 400 },
], [
  // 拿 = 多实体联合：角色无球→持球 ∧ 球 自由/滚动→被持有（见球路逻辑「被拿」）
  { event: '拿', from: '无球', to: '持球', condition: '争抢成功（与球坐标距离<抢截半径）', isHyper: true, basePriority: 3 },
  { event: '掉', from: '持球', to: '无球', condition: '被断球 或 血量低于掉球阈值（球进入球路逻辑·自由）', isHyper: true, basePriority: 6 },
  // 传 = 多实体联合：角色持球→无球 ∧ 球 被持有→传球飞行（球权结束，球运动归球路逻辑）
  { event: '传', from: '持球', to: '无球', condition: '传球键触发（球权结束；球的飞行见球路逻辑「传出」）', isHyper: true, basePriority: 7, structWeight: 1.2 },
  { event: '激活射门技能', from: '持球', to: '射门激活', condition: '持球 且 射门键按下', basePriority: 2 },
  { event: '蓄力条更新', from: '射门激活', to: '蓄力', condition: '持续按住射门键', basePriority: 4 },
  { event: '关闭射门技能', from: '射门激活', to: '持球', condition: '取消键 或 超时未射', basePriority: 1 },
  { event: '取消', from: '蓄力', to: '持球', condition: '蓄力中主动取消（打断回持球）', basePriority: 1 },
  { event: '打断', from: '蓄力', to: '无球', condition: '蓄力中被断球/受击 或 血量低于掉球阈值（打断回无球）', basePriority: 6 },
  { event: '射', from: '蓄力', to: '射门', condition: '位置处于进攻侧网格 且 松开射门键（射门位移 8m，球路逻辑同步「射出」）', skillKind: 'displacement', isHyper: true, basePriority: 5 },
  { event: '关闭射门技能', from: '射门', to: '无球', condition: '射门动作结束（球出脚，球权结束）', basePriority: 1 },
]);

// ---------- 位置逻辑（挂角色）：状态 = 球场网格点 ----------
// 球场 120m × 80m 划分为 4列 × 3行 网格，格子中心即坐标：
//   x = 15 + 30·col（col 0..3），y = 13 + 27·row（row 0..2）
// 多人位置联合状态 = 各角色网格点的组合（见总超图面板）
export const GRID_COLS = 4;
export const GRID_ROWS = 3;
export const CELL_W = 30;
export const CELL_H = 27;

function gridName(col: number, row: number) {
  return `(${col},${row})`;
}

function gridCenter(col: number, row: number) {
  return { x: 15 + CELL_W * col, y: 13 + CELL_H * row };
}

function positionGraph(): DomainGraph {
  const nodes: NE[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const ctr = gridCenter(c, r);
      nodes.push({
        name: gridName(c, r),
        x: 140 + c * 180,
        y: 110 + r * 170,
        note: `网格点 中心坐标 (${ctr.x}, ${ctr.y})`,
      });
    }
  }
  const edges: Array<Parameters<typeof makeGraph>[2][number]> = [];
  // 移动：相邻网格点之间双向（普通移动速度）
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (c + 1 < GRID_COLS) {
        edges.push({ event: '移动', from: gridName(c, r), to: gridName(c + 1, r), condition: '方向输入（每 tick 位移=移动基准速度）', basePriority: 1 });
        edges.push({ event: '移动', from: gridName(c + 1, r), to: gridName(c, r), condition: '方向输入（反向）', basePriority: 1 });
      }
      if (r + 1 < GRID_ROWS) {
        edges.push({ event: '移动', from: gridName(c, r), to: gridName(c, r + 1), condition: '方向输入（纵向）', basePriority: 1 });
        edges.push({ event: '移动', from: gridName(c, r + 1), to: gridName(c, r), condition: '方向输入（纵向反向）', basePriority: 1 });
      }
      // 冲刺：向进攻侧（+x 方向）加速
      if (c + 1 < GRID_COLS) {
        edges.push({ event: '冲刺', from: gridName(c, r), to: gridName(c + 1, r), condition: '冲刺键 且 体力>0', basePriority: 1 });
      }
    }
  }
  // 位移技能：各职业不同（professionIds 限定）
  for (let r = 0; r < GRID_ROWS; r++) {
    // 前锋·射门爆发：跨 3 格突进（进攻方向）
    edges.push({ event: '射门爆发', from: gridName(0, r), to: gridName(3, r), condition: '前锋位移技（距离=位移基准+3m）', skillKind: 'displacement', professionIds: ['prof_fw'], basePriority: 2 });
    // 中场·疾跑突进：跨 2 格
    edges.push({ event: '疾跑突进', from: gridName(0, r), to: gridName(2, r), condition: '中场位移技（距离=位移基准+1m）', skillKind: 'displacement', professionIds: ['prof_mf'], basePriority: 2 });
    edges.push({ event: '疾跑突进', from: gridName(1, r), to: gridName(3, r), condition: '中场位移技（距离=位移基准+1m）', skillKind: 'displacement', professionIds: ['prof_mf'], basePriority: 2 });
  }
  // 后卫·侧身闪避：斜向 1 格（防守回追）
  edges.push({ event: '侧身闪避', from: gridName(3, 0), to: gridName(2, 1), condition: '后卫位移技（短距闪避）', skillKind: 'displacement', professionIds: ['prof_df'], basePriority: 2 });
  edges.push({ event: '侧身闪避', from: gridName(3, 2), to: gridName(2, 1), condition: '后卫位移技（短距闪避）', skillKind: 'displacement', professionIds: ['prof_df'], basePriority: 2 });
  edges.push({ event: '侧身闪避', from: gridName(2, 0), to: gridName(1, 1), condition: '后卫位移技（短距闪避）', skillKind: 'displacement', professionIds: ['prof_df'], basePriority: 2 });
  edges.push({ event: '侧身闪避', from: gridName(2, 2), to: gridName(1, 1), condition: '后卫位移技（短距闪避）', skillKind: 'displacement', professionIds: ['prof_df'], basePriority: 2 });
  return makeGraph('position', nodes, edges);
}

// ---------- 姿态控制（挂角色）：自由/受控/霸体/僵直/倒地 ----------
const controlGraph = makeGraph('control', [
  { name: '自由', x: 200, y: 220 },
  { name: '受控', x: 430, y: 110 },
  { name: '霸体', x: 430, y: 340 },
  { name: '僵直', x: 660, y: 170, note: '受击硬直' },
  { name: '倒地', x: 660, y: 340, note: '重击倒地' },
], [
  { event: '受控', from: '自由', to: '受控', condition: '被控制技能命中', isHyper: true, affectsOthers: true, basePriority: 2 },
  { event: '解控', from: '受控', to: '自由', condition: '控制时间结束 或 解控技能', basePriority: 1 },
  { event: '霸体技能', from: '自由', to: '霸体', condition: '霸体技能触发', basePriority: 1 },
  { event: '霸体结束', from: '霸体', to: '自由', condition: '霸体持续时间结束', basePriority: 1 },
  { event: '受击', from: '自由', to: '僵直', condition: '受到伤害事件 且 网格坐标距离<攻击范围', skillKind: 'damage', affectsOthers: true, basePriority: 2 },
  { event: '重击倒地', from: '僵直', to: '倒地', condition: '单次伤害>倒地阈值', skillKind: 'damage', affectsOthers: true, basePriority: 1 },
  { event: '恢复', from: '僵直', to: '自由', condition: '僵直时间结束', basePriority: 1 },
  { event: '起身', from: '倒地', to: '自由', condition: '倒地时间结束', basePriority: 1 },
]);

// ---------- 血量逻辑（挂角色）----------
const hpGraph = makeGraph('hp', [
  { name: '健康', x: 140, y: 260 },
  { name: '受伤', x: 360, y: 140 },
  { name: '残血', x: 560, y: 140, note: '低于掉球阈值时触发掉球' },
  { name: '濒死', x: 760, y: 260 },
  { name: '虚弱', x: 560, y: 400, note: '已掉球' },
], [
  // 职业伤害事件：同职业相同、不同职业不同（professionIds 限定）
  { event: '冲撞抢截', from: '健康', to: '受伤', condition: '前锋伤害技（伤害=模板值，坐标距离<范围）', skillKind: 'damage', affectsOthers: true, professionIds: ['prof_fw'], basePriority: 2 },
  { event: '肘击', from: '健康', to: '受伤', condition: '中场伤害技（低伤害短冷却）', skillKind: 'damage', affectsOthers: true, professionIds: ['prof_mf'], basePriority: 2 },
  { event: '飞铲', from: '健康', to: '受伤', condition: '后卫伤害技（高伤害，自身僵直）', skillKind: 'damage', affectsOthers: true, professionIds: ['prof_df'], basePriority: 2 },
  { event: '受伤', from: '受伤', to: '残血', condition: '累计伤害达残血线', skillKind: 'damage', affectsOthers: true, basePriority: 2 },
  { event: '受伤', from: '残血', to: '濒死', condition: '累计伤害达濒死线', skillKind: 'damage', affectsOthers: true, basePriority: 2 },
  { event: '掉球', from: '残血', to: '虚弱', condition: '血量低于掉球阈值（级联：血量→球权→球路）', isHyper: true, basePriority: 6 },
  { event: '回复', from: '受伤', to: '健康', condition: '治疗效果', basePriority: 1 },
  { event: '回复', from: '残血', to: '受伤', condition: '治疗效果', basePriority: 1 },
  { event: '回复', from: '濒死', to: '残血', condition: '治疗效果', basePriority: 1 },
  { event: '恢复', from: '虚弱', to: '健康', condition: '虚弱时间结束 且 重新拿球', basePriority: 1 },
]);

// ---------- 球路逻辑（挂球实体：球掉出/传出后的运动） ----------
const ballTrackGraph = makeGraph('ballTrack', [
  { name: '被持有', x: 140, y: 260, note: '球在角色脚下（伴随球权逻辑）' },
  { name: '传球飞行', x: 370, y: 140, note: '传/射出脚后在空中' },
  { name: '落地滚动', x: 590, y: 140, note: '第一落点触地后滚动' },
  { name: '自由', x: 810, y: 260, note: '滚停/未被接住 → 开放争抢' },
  { name: '争顶', x: 590, y: 400, note: '高空球多人争顶判定' },
], [
  // 传出/射出 = 与角色球权逻辑联动的超边（角色 传/射 ⇄ 球 被持有→传球飞行）
  { event: '传出', from: '被持有', to: '传球飞行', condition: '角色传事件触发（联动球权逻辑「传」）', isHyper: true, basePriority: 7 },
  { event: '射出', from: '被持有', to: '传球飞行', condition: '角色射事件触发（联动球权逻辑「射」）', isHyper: true, basePriority: 5 },
  { event: '飞行结束', from: '传球飞行', to: '落地滚动', condition: '到达落点（落点网格=传球目标格）', basePriority: 1 },
  { event: '争顶', from: '传球飞行', to: '争顶', condition: '高空球 且 多名角色网格邻接落点（多实体联合判定）', isHyper: true, affectsOthers: true, basePriority: 3 },
  { event: '滚停', from: '落地滚动', to: '自由', condition: '滚动距离耗尽（球停在网格点）', basePriority: 1 },
  { event: '被拿', from: '自由', to: '被持有', condition: '角色满足拿球事件（与角色球权逻辑「拿」联动）', isHyper: true, basePriority: 3 },
  { event: '争顶成功', from: '争顶', to: '被持有', condition: '争顶判定胜出（高度/位置优势）', isHyper: true, basePriority: 3 },
]);

// ---------- 职业与名册 ----------
export const defaultProfessions: Profession[] = [
  { id: 'prof_fw', name: '前锋', note: '爆发位移 + 冲撞抢截' },
  { id: 'prof_mf', name: '中场', note: '疾跑突进 + 肘击' },
  { id: 'prof_df', name: '后卫', note: '闪避回追 + 飞铲' },
];

// 按人数生成名册：每队依次循环 前锋→中场→后卫→前锋…
export function buildRoster(playersPerTeam: number, professions: Profession[]): PlayerSpec[] {
  const list: PlayerSpec[] = [];
  for (const team of ['A', 'B'] as const) {
    for (let i = 0; i < playersPerTeam; i++) {
      const prof = professions[i % professions.length];
      list.push({
        id: `pl_${team}${i + 1}`,
        name: `${team === 'A' ? '红' : '蓝'}${i + 1}`,
        team,
        professionId: prof.id,
      });
    }
  }
  return list;
}

const defaultSkills: SkillTemplate[] = [
  { id: 'sk_dmg_1', name: '冲撞抢截', kind: 'damage', damage: 20, cooldown: 3, range: 1.5, note: '前锋：近身伤害+概率掉球' },
  { id: 'sk_dmg_2', name: '飞铲', kind: 'damage', damage: 30, cooldown: 6, range: 2.5, note: '后卫：高伤害，命中后自身僵直' },
  { id: 'sk_dmg_3', name: '肘击', kind: 'damage', damage: 12, cooldown: 2, range: 0.8, note: '中场：低伤害短冷却' },
  { id: 'sk_dsp_1', name: '疾跑突进', kind: 'displacement', displacement: 6, cooldown: 5, range: 8, note: '中场：直线位移（坐标 +6m）' },
  { id: 'sk_dsp_2', name: '侧身闪避', kind: 'displacement', displacement: 3, cooldown: 2, range: 4, note: '后卫：短距离闪避' },
  { id: 'sk_dsp_3', name: '射门爆发', kind: 'displacement', displacement: 8, cooldown: 8, range: 10, note: '前锋：射门位移（射事件前提）' },
];

export function createDefaultScenario(): Scenario {
  seq = 0;
  const now = Date.now();
  return {
    id: newId(),
    version: 3,
    name: '示例：3v3 标准赛',
    playersPerTeam: 3,
    professions: defaultProfessions.map((p) => ({ ...p })),
    players: buildRoster(3, defaultProfessions),
    graphs: {
      possession: possessionGraph,
      position: positionGraph(),
      control: controlGraph,
      hp: hpGraph,
      ballTrack: ballTrackGraph,
    },
    skills: defaultSkills,
    balance: { damage: 15, hpMax: 100, hpDropThreshold: 30, displacement: 5 },
    createdAt: now,
    updatedAt: now,
  };
}
