// 默认示例 v6：3v3 方案（按手绘设计图重构）
//
// 实体归属：
//   角色实体 ×6：球权逻辑 / 持球逻辑(复合在球权里) / 位置逻辑(10×10 网格) / 姿态控制 / 血量逻辑
//   球实体 ×1：球路逻辑
// 权威优先级 = 全部逻辑图经同名状态粘合为总超图后，对总超图做 DFS 搜索树
import type { DomainGraph, EntityKind, PlayerSpec, Profession, Scenario, SkillTemplate, StateNode } from '@/types/model';
import { newId } from './storage';

let seq = 0;
const nid = (p: string) => `${p}_${seq++}`;
const eid = () => `e_${seq++}`;

interface NE { name: string; x: number; y: number; note?: string; timeLimit?: StateNode['timeLimit'] }

export function makeGraph(id: string, owner: EntityKind, name: string, nodeDefs: NE[], edges: Array<{
  event: string; from: string; to: string; condition: string;
  skillKind?: SkillTemplate['kind']; skillId?: string; isHyper?: boolean; affectsOthers?: boolean;
  professionIds?: string[]; basePriority?: number; cooldown?: number; structWeight?: number;
}>): DomainGraph {
  const nodes = nodeDefs.map((n) => ({ id: nid('n'), name: n.name, x: n.x, y: n.y, note: n.note, timeLimit: n.timeLimit }));
  const find = (n: string) => nodes.find((x) => x.name === n)!.id;
  return {
    id, owner, name, nodes,
    edges: edges.map((e) => ({
      id: eid(),
      event: e.event,
      from: find(e.from),
      to: find(e.to),
      condition: e.condition,
      skillKind: e.skillKind,
      skillId: e.skillId,
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

// ---------- 球权逻辑（挂角色：无球 ⇄ 持球，球掉了或传出即结束） ----------
function possessionGraph(): DomainGraph {
  return makeGraph('possession', 'player', '球权逻辑', [
    { name: '无球', x: 160, y: 260, note: 'DFS 起点' },
    { name: '持球', x: 470, y: 260 },
  ], [
    { event: '拿球', from: '无球', to: '持球', condition: '争抢成功（与球网格坐标距离<抢截半径；球路逻辑同步「拿球」）', isHyper: true, basePriority: 3 },
    { event: '传球', from: '持球', to: '无球', condition: '传球键触发（球权结束；球进入球路逻辑「传出」）', isHyper: true, basePriority: 7, structWeight: 1.2 },
    { event: '掉球', from: '持球', to: '无球', condition: '被断球 或 血量低于掉球阈值（球进入球路逻辑「传出」）', isHyper: true, basePriority: 6 },
  ]);
}

// ---------- 持球逻辑（挂角色：复合在球权逻辑里，持球期间叠加射门状态机） ----------
function holdingGraph(): DomainGraph {
  return makeGraph('holding', 'player', '持球逻辑（复合）', [
    { name: '持球', x: 130, y: 280, note: '与球权逻辑「持球」粘合：持球期间叠加本状态机' },
    { name: '射门未激活', x: 340, y: 430 },
    { name: '射门激活', x: 370, y: 150 },
    { name: '蓄力', x: 620, y: 150, note: '时限状态：满蓄力或超 3 tick 自动结束', timeLimit: { ticks: 3, timeoutEvent: '蓄力状态结束' } },
    { name: '射门', x: 850, y: 280, note: '出脚瞬间，随后球权结束' },
    { name: '无球', x: 620, y: 430, note: '与球权逻辑「无球」粘合：打断/射门结束回到无球' },
  ], [
    { event: '持球', from: '持球', to: '射门未激活', condition: '进入持球状态（复合：球权「持球」状态下叠加射门状态机）', basePriority: 1 },
    { event: '距离小', from: '射门未激活', to: '射门激活', condition: '与球门网格距离 ≤ 射门距离（满足射门前提）', basePriority: 2 },
    { event: '距离大', from: '射门激活', to: '射门未激活', condition: '与球门网格距离 > 射门距离（退出射门前提）', basePriority: 1 },
    { event: '蓄力储能', from: '射门激活', to: '蓄力', condition: '持续按住射门键（信号类技能·蓄力储能，充能持续累积）', skillKind: 'signal', skillId: 'sk_sig_1', basePriority: 4 },
    { event: '蓄力状态结束', from: '蓄力', to: '射门未激活', condition: '达到蓄力上限自动结束 或 松开未射（时限状态到期）', basePriority: 1 },
    { event: '打断', from: '蓄力', to: '无球', condition: '蓄力中被断球/受击 或 血量低于掉球阈值（打断回无球）', isHyper: true, basePriority: 6 },
    { event: '射', from: '蓄力', to: '射门', condition: '位置处于进攻侧网格 且 松开射门键（射门爆发位移 5 格=60m，球路逻辑同步「传出」）', skillKind: 'displacement', skillId: 'sk_dsp_3', isHyper: true, basePriority: 5 },
    { event: '射门结束', from: '射门', to: '无球', condition: '射门动作结束（球出脚，球权结束）', basePriority: 1 },
  ]);
}

// ---------- 位置逻辑（挂角色）：状态 = 10×10 球场网格点 ----------
// 球场 120m × 80m 划分为 10列 × 10行 网格，格子中心即坐标：
//   x = 6 + 12·col（col 0..9），y = 4 + 8·row（row 0..9）
// 多人位置联合状态 = 各角色网格点的组合
export const GRID_COLS = 10;
export const GRID_ROWS = 10;
export const CELL_W = 12;
export const CELL_H = 8;

export function gridName(col: number, row: number) {
  return `(${col},${row})`;
}

// 网格单位换算：横向 1 格 = CELL_W 米（位移距离统一按此折算格数）
export function metersToCells(m: number) {
  return m / CELL_W;
}

export function gridCenter(col: number, row: number) {
  return { x: CELL_W / 2 + CELL_W * col, y: CELL_H / 2 + CELL_H * row };
}

function positionGraph(): DomainGraph {
  const nodes: NE[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const ctr = gridCenter(c, r);
      nodes.push({
        name: gridName(c, r),
        x: 90 + c * 92,
        y: 80 + r * 78,
        note: `网格点 中心坐标 (${ctr.x}, ${ctr.y})`,
      });
    }
  }
  const E: Array<Parameters<typeof makeGraph>[4][number]> = [];
  // 移动：相邻网格点双向（普通移动速度）
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (c + 1 < GRID_COLS) {
        E.push({ event: '移动', from: gridName(c, r), to: gridName(c + 1, r), condition: '方向输入（每 tick 位移=移动基准速度）', basePriority: 1 });
        E.push({ event: '移动', from: gridName(c + 1, r), to: gridName(c, r), condition: '方向输入（反向）', basePriority: 1 });
      }
      if (r + 1 < GRID_ROWS) {
        E.push({ event: '移动', from: gridName(c, r), to: gridName(c, r + 1), condition: '方向输入（纵向）', basePriority: 1 });
        E.push({ event: '移动', from: gridName(c, r + 1), to: gridName(c, r), condition: '方向输入（纵向反向）', basePriority: 1 });
      }
      // 冲刺：向进攻侧（+x）加速
      if (c + 1 < GRID_COLS) {
        E.push({ event: '冲刺', from: gridName(c, r), to: gridName(c + 1, r), condition: '冲刺键 且 体力>0', basePriority: 1 });
      }
    }
  }
  // 位移技能：各职业不同（professionIds 限定）
  for (let r = 0; r < GRID_ROWS; r++) {
    // 前锋·射门爆发：从中线附近直插前场（跨 5 格）
    E.push({ event: '射门爆发', from: gridName(2, r), to: gridName(7, r), condition: '前锋位移技（距离 = 5 格 = 60m，1 格=12m）', skillKind: 'displacement', professionIds: ['prof_fw'], basePriority: 2 });
    E.push({ event: '射门爆发', from: gridName(4, r), to: gridName(9, r), condition: '前锋位移技（距离 = 5 格 = 60m，1 格=12m）', skillKind: 'displacement', professionIds: ['prof_fw'], basePriority: 2 });
    // 中场·疾跑突进：跨 3 格
    for (const c of [0, 3, 6]) {
      E.push({ event: '疾跑突进', from: gridName(c, r), to: gridName(c + 3, r), condition: '中场位移技（距离 = 3 格 = 36m，1 格=12m）', skillKind: 'displacement', professionIds: ['prof_mf'], basePriority: 2 });
    }
    // 后卫·侧身闪避：斜向 1 格（防守回追）
    if (r > 0) E.push({ event: '侧身闪避', from: gridName(8, r), to: gridName(7, r - 1), condition: '后卫位移技（斜向 1 格 ≈ 15m，1 格=12m）', skillKind: 'displacement', professionIds: ['prof_df'], basePriority: 2 });
    if (r + 1 < GRID_ROWS) E.push({ event: '侧身闪避', from: gridName(8, r), to: gridName(7, r + 1), condition: '后卫位移技（斜向 1 格 ≈ 15m，1 格=12m）', skillKind: 'displacement', professionIds: ['prof_df'], basePriority: 2 });
  }
  return makeGraph('position', 'player', '位置逻辑（10×10 网格）', nodes, E);
}

// ---------- 姿态控制（挂角色）：自由 ⇄ 受控 ----------
function controlGraph(): DomainGraph {
  return makeGraph('control', 'player', '姿态控制', [
    { name: '自由', x: 200, y: 240 },
    { name: '受控', x: 480, y: 240, note: '时限状态：被打断进入，控制时间结束自动恢复自由', timeLimit: { ticks: 2, timeoutEvent: '状态结束' } },
  ], [
    { event: '被打断', from: '自由', to: '受控', condition: '被控制技能命中（打断当前动作）', isHyper: true, affectsOthers: true, basePriority: 2 },
    { event: '状态结束', from: '受控', to: '自由', condition: '控制时间结束（时限状态到期自动恢复）', basePriority: 1 },
  ]);
}

// ---------- 血量逻辑（挂角色）：血量 1-100 数值，按阈值分为状态 ----------
function hpGraph(): DomainGraph {
  return makeGraph('hp', 'player', '血量逻辑', [
    { name: '血量≥50', x: 200, y: 260, note: '健康：血量数值 1-100，阈值状态节点' },
    { name: '血量<50', x: 520, y: 260, note: '危险：低于掉球阈值时级联触发掉球（血量→球权→球路）' },
  ], [
    { event: '受击', from: '血量≥50', to: '血量<50', condition: '受到伤害事件 且 网格坐标距离<攻击范围；血量扣减后 <50', skillKind: 'damage', affectsOthers: true, basePriority: 2 },
    { event: '恢复', from: '血量<50', to: '血量≥50', condition: '辅助技能·治疗（效果值=模板值）或自然回复，血量回到 ≥50', skillKind: 'aux', skillId: 'sk_aux_1', basePriority: 1 },
  ]);
}

// ---------- 球路逻辑（挂球实体）：持球 ⇄ 自由球，类比位置更新 ----------
function ballTrackGraph(): DomainGraph {
  return makeGraph('ballTrack', 'ball', '球路逻辑', [
    { name: '球被持有', x: 170, y: 260, note: '球在某角色脚下（伴随球权逻辑）' },
    { name: '自由球', x: 560, y: 260, note: '传/射/掉后空中或滚动；位置按落点网格逐 tick 更新' },
  ], [
    { event: '传出', from: '球被持有', to: '自由球', condition: '角色传/射/掉球事件触发（联动球权逻辑）', isHyper: true, basePriority: 7 },
    { event: '位置更新', from: '自由球', to: '自由球', condition: '球路按速度方向逐 tick 更新网格落点（类比位置逻辑的移动事件）', basePriority: 1 },
    { event: '拿球', from: '自由球', to: '球被持有', condition: '角色满足拿球事件（与球权逻辑「拿球」联动）', isHyper: true, basePriority: 3 },
  ]);
}

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

// 新建一张空白逻辑图（带一个起始状态，保证 DFS 有根）
export function emptyGraph(owner: EntityKind, name: string): DomainGraph {
  return {
    id: `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    owner,
    name,
    nodes: [{ id: nid('n'), name: '起始状态', x: 200, y: 200 }],
    edges: [],
  };
}

const defaultSkills: SkillTemplate[] = [
  { id: 'sk_dmg_1', name: '冲撞抢截', kind: 'damage', damage: 20, cooldown: 3, range: 1.5, note: '前锋：近身伤害+概率掉球' },
  { id: 'sk_dmg_2', name: '飞铲', kind: 'damage', damage: 30, cooldown: 6, range: 2.5, note: '后卫：高伤害，命中后自身僵直' },
  { id: 'sk_dmg_3', name: '肘击', kind: 'damage', damage: 12, cooldown: 2, range: 0.8, note: '中场：低伤害短冷却' },
  { id: 'sk_dsp_1', name: '疾跑突进', kind: 'displacement', displacement: 36, cooldown: 5, range: 8, note: '中场：直线位移 3 格（36m）' },
  { id: 'sk_dsp_2', name: '侧身闪避', kind: 'displacement', displacement: 12, cooldown: 2, range: 4, note: '后卫：斜向 1 格（12m）' },
  { id: 'sk_dsp_3', name: '射门爆发', kind: 'displacement', displacement: 60, cooldown: 8, range: 10, note: '前锋：射门位移 5 格（60m，射事件前提）' },
  { id: 'sk_sig_1', name: '蓄力储能', kind: 'signal', chargeMax: 100, cooldown: 0, range: 0, note: '信号类：按住射门键持续蓄能，满 100 触发蓄力状态结束' },
  { id: 'sk_aux_1', name: '治疗喷雾', kind: 'aux', effectValue: 25, cooldown: 8, range: 3, note: '辅助类：恢复目标血量（效果值=25）' },
];

export function createDefaultScenario(): Scenario {
  seq = 0;
  const now = Date.now();
  return {
    id: newId(),
    version: 6,
    name: '示例：3v3 标准赛',
    playersPerTeam: 3,
    professions: defaultProfessions.map((p) => ({ ...p })),
    players: buildRoster(3, defaultProfessions),
    graphs: {
      possession: possessionGraph(),
      holding: holdingGraph(),
      position: positionGraph(),
      control: controlGraph(),
      hp: hpGraph(),
      ballTrack: ballTrackGraph(),
    },
    skills: defaultSkills,
    balance: { damage: 15, hpMax: 100, hpDropThreshold: 30, displacement: 5 },
    createdAt: now,
    updatedAt: now,
  };
}
