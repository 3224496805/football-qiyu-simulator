// 默认示例 v9：3v3 方案（位置图压缩：9×9 网格 + 3×3 区域状态，DFS 仅 sees 区域级转移）
//
// 实体归属：
//   角色实体 ×6：球权逻辑 / 持球逻辑(复合在球权里) / 位置逻辑(9×9 网格→3×3 区域) / 姿态控制 / 血量逻辑
//   球实体 ×1：球路逻辑
// 权威优先级 = 全部逻辑图经同名状态粘合为总超图后，对总超图做多起点 DFS 搜索树
import type { DomainGraph, EntityKind, PlayerSpec, PreState, Profession, Scenario, SkillTemplate, StateNode } from '@/types/model';
import { newId } from './storage';

let seq = 0;
const nid = (p: string) => `${p}_${seq++}`;
const eid = () => `e_${seq++}`;

interface NE { name: string; x: number; y: number; note?: string; timeLimit?: StateNode['timeLimit'] }

export function makeGraph(id: string, owner: EntityKind, name: string, nodeDefs: NE[], edges: Array<{
  event: string; from: string; to: string; condition: string;
  skillKind?: SkillTemplate['kind']; skillId?: string; isHyper?: boolean; affectsOthers?: boolean;
  professionIds?: string[]; basePriority?: number; cooldown?: number; structWeight?: number;
  trigger?: 'active' | 'passive'; listenEvents?: string[]; preStates?: PreState[];
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
      trigger: e.trigger ?? 'active',
      listenEvents: e.listenEvents,
      preStates: e.preStates,
      params: {
        basePriority: e.basePriority ?? 1,
        cooldown: e.cooldown ?? 0,
        structWeight: e.structWeight ?? 1,
      },
    })),
  };
}

// ---------- 球权逻辑（挂角色：无球 ⇄ 持球，球掉了或传出即结束） ----------
// 传球本质 = 持球→无球（结束本方球权）；接球方不是在传球瞬间变成持球，
// 而是等球追踪/滚动到位、拿球距离前提满足后，自行触发「拿球」事件。
function possessionGraph(): DomainGraph {
  return makeGraph('possession', 'player', '球权逻辑', [
    { name: '无球', x: 160, y: 260, note: 'DFS 起点' },
    { name: '持球', x: 470, y: 260 },
  ], [
    { event: '拿球', from: '无球', to: '持球', condition: '拿球距离前提：与球相距 ≤ 2 格（球处于「传向队友」追踪 或 「自由球」滚动中）才触发；传球本身不会直接把接球方变成持球', isHyper: true, basePriority: 3 },
    { event: '传球', from: '持球', to: '无球', condition: '传球键触发，目标只能是队友；本质 = 持球→无球结束本方球权，球进入「传向队友」朝随机一个队友追踪，队友在距离前提满足时自行拿球', isHyper: true, basePriority: 7, structWeight: 1.2 },
    { event: '掉球', from: '持球', to: '无球', condition: '被断球 或 血量低于掉球阈值；球直接成为自由球朝地图中心运动', isHyper: true, basePriority: 6 },
    { event: '受击掉球', from: '持球', to: '无球', condition: '【被动】受击事件执行后进入下一次判定：若此时血量低于掉球阈值则掉球（级联：血量→球权→球路）', isHyper: true, basePriority: 6, trigger: 'passive', listenEvents: ['受击'] },
  ]);
}

// ---------- 持球逻辑（挂角色：复合在球权逻辑里，持球期间叠加射门状态机） ----------
function holdingGraph(): DomainGraph {
  return makeGraph('holding', 'player', '持球逻辑（复合）', [
    { name: '持球', x: 130, y: 280, note: '与球权逻辑「持球」粘合：持球期间叠加本状态机' },
    { name: '射门未激活', x: 340, y: 430 },
    { name: '射门激活', x: 370, y: 150 },
    { name: '蓄力', x: 620, y: 150, note: '时限状态：蓄力不可取消，满蓄力（3 tick）强制起脚', timeLimit: { ticks: 3, timeoutEvent: '射' } },
    { name: '射门', x: 850, y: 280, note: '出脚瞬间，随后球权结束' },
    { name: '无球', x: 620, y: 430, note: '与球权逻辑「无球」粘合：打断/射门结束回到无球' },
  ], [
    { event: '持球', from: '持球', to: '射门未激活', condition: '进入持球状态（复合：球权「持球」状态下叠加射门状态机）', basePriority: 1 },
    { event: '距离小', from: '射门未激活', to: '射门激活', condition: '与球门网格距离 ≤ 射门距离（满足射门前提）', basePriority: 2 },
    { event: '距离大', from: '射门激活', to: '射门未激活', condition: '与球门网格距离 > 射门距离（退出射门前提）', basePriority: 1 },
    { event: '蓄力储能', from: '射门激活', to: '蓄力', condition: '持续按住射门键（信号类技能·蓄力储能，充能持续累积；进入蓄力后不可取消）', skillKind: 'signal', skillId: 'sk_sig_1', basePriority: 4 },
    { event: '打断', from: '蓄力', to: '无球', condition: '蓄力中被断球/受击 或 血量低于掉球阈值（唯一退出蓄力的方式：被打断回无球）', isHyper: true, basePriority: 6 },
    { event: '射', from: '蓄力', to: '射门', condition: '松开射门键 或 满蓄力强制起脚（蓄力 3 tick 到期自动触发）；持球→蓄力→射门视为不可逆的传球事件，出脚后球权必失（射门爆发位移 5 格=60m，球路逻辑同步「传出」）', skillKind: 'impact', skillId: 'sk_imp_3', isHyper: true, basePriority: 7, structWeight: 1.2 },
    { event: '射门结束', from: '射门', to: '无球', condition: '射门动作结束（球出脚，球权结束）', basePriority: 1 },
  ]);
}

// ---------- 位置逻辑（挂角色）：9×9 网格 + 3×3 区域状态 ----------
// 球场 108m × 72m 划分为 9列 × 9行 网格，格子中心即坐标：
//   x = 6 + 12·col（col 0..8），y = 4 + 8·row（row 0..8）
// 逻辑状态 = 3×3 区域（每区 3×3 格）：同区域内移动只是底层坐标变化，不产生逻辑事件，
// 仅「跨区」才形成位置图上的状态转移。多人位置联合状态 = 各角色区域的组合，
// 底层仍保留精确格子坐标（伤害判定按同格）。
export const GRID_COLS = 9;
export const GRID_ROWS = 9;
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

// 3×3 区域：横轴 = 进攻方向（本方/中带/对方），纵轴 = 左/中/右
export const ZONE_X = ['本方', '中带', '对方'] as const;
export const ZONE_Y = ['左', '中', '右'] as const;

export function zoneName(zx: number, zy: number) {
  return `${ZONE_X[zx]}-${ZONE_Y[zy]}`;
}

export function zoneOf(col: number, row: number) {
  return { zx: Math.min(2, Math.floor(col / 3)), zy: Math.min(2, Math.floor(row / 3)) };
}

// 格子 → 所属区域状态名
export function zoneOfCell(col: number, row: number) {
  const z = zoneOf(col, row);
  return zoneName(z.zx, z.zy);
}

// 区域名 → 锚点格（区域中心），用于从区域状态反推参考坐标
export function zoneAnchor(name: string) {
  for (let zx = 0; zx < 3; zx++) {
    for (let zy = 0; zy < 3; zy++) {
      if (zoneName(zx, zy) === name) return { col: zx * 3 + 1, row: zy * 3 + 1 };
    }
  }
  return { col: 4, row: 4 };
}

function positionGraph(): DomainGraph {
  const nodes: NE[] = [];
  for (let zy = 0; zy < 3; zy++) {
    for (let zx = 0; zx < 3; zx++) {
      nodes.push({
        name: zoneName(zx, zy),
        x: 210 + zx * 300,
        y: 110 + zy * 200,
        note: `区域状态 = 格子 (${zx * 3}~${zx * 3 + 2}, ${zy * 3}~${zy * 3 + 2})；区域内移动不产生逻辑事件，仅跨区转移计入`,
      });
    }
  }
  const E: Array<Parameters<typeof makeGraph>[4][number]> = [];
  const Z = zoneName;
  // 移动：相邻区域双向（区域内移动 = 底层坐标变化，不入图）
  for (let zy = 0; zy < 3; zy++) {
    for (let zx = 0; zx < 3; zx++) {
      if (zx + 1 < 3) {
        E.push({ event: '移动', from: Z(zx, zy), to: Z(zx + 1, zy), condition: '方向输入·跨区（同区域内移动为底层坐标变化，不产生逻辑事件）', basePriority: 1 });
        E.push({ event: '移动', from: Z(zx + 1, zy), to: Z(zx, zy), condition: '方向输入·跨区（反向）', basePriority: 1 });
      }
      if (zy + 1 < 3) {
        E.push({ event: '移动', from: Z(zx, zy), to: Z(zx, zy + 1), condition: '方向输入·跨区（纵向）', basePriority: 1 });
        E.push({ event: '移动', from: Z(zx, zy + 1), to: Z(zx, zy), condition: '方向输入·跨区（纵向反向）', basePriority: 1 });
      }
      // 冲刺：向进攻侧（+x）跨区加速
      if (zx + 1 < 3) {
        E.push({ event: '冲刺', from: Z(zx, zy), to: Z(zx + 1, zy), condition: '冲刺键 且 体力>0（跨 1 区 ≈ 3 格）', basePriority: 1 });
      }
    }
  }
  // 冲击技能（位移+伤害合并）：区域级表达，位移按格折算（1 格 = 12m，与 9×9 网格同步）
  for (let zy = 0; zy < 3; zy++) {
    // 前锋·射门爆发：60m ≈ 5 格，横跨两区
    E.push({ event: '射门爆发', from: Z(0, zy), to: Z(1, zy), condition: '前锋冲击技（位移 60m ≈ 5 格，横跨两区）', skillKind: 'impact', skillId: 'sk_imp_3', professionIds: ['prof_fw'], basePriority: 2 });
    E.push({ event: '射门爆发', from: Z(1, zy), to: Z(2, zy), condition: '前锋冲击技（位移 60m ≈ 5 格，横跨两区）', skillKind: 'impact', skillId: 'sk_imp_3', professionIds: ['prof_fw'], basePriority: 2 });
    // 中场·疾跑突进：36m ≈ 3 格 = 1 区
    E.push({ event: '疾跑突进', from: Z(0, zy), to: Z(1, zy), condition: '中场冲击技（位移 36m ≈ 3 格 = 1 区）', skillKind: 'impact', skillId: 'sk_imp_4', professionIds: ['prof_mf'], basePriority: 2 });
    E.push({ event: '疾跑突进', from: Z(1, zy), to: Z(2, zy), condition: '中场冲击技（位移 36m ≈ 3 格 = 1 区）', skillKind: 'impact', skillId: 'sk_imp_4', professionIds: ['prof_mf'], basePriority: 2 });
    // 后卫·侧身闪避：12m ≈ 1 格，横向换道（防守回追）
    if (zy > 0) E.push({ event: '侧身闪避', from: Z(2, zy), to: Z(2, zy - 1), condition: '后卫冲击技（斜向 12m ≈ 1 格，横向换道）', skillKind: 'impact', skillId: 'sk_imp_5', professionIds: ['prof_df'], basePriority: 2 });
    if (zy + 1 < 3) E.push({ event: '侧身闪避', from: Z(2, zy), to: Z(2, zy + 1), condition: '后卫冲击技（斜向 12m ≈ 1 格，横向换道）', skillKind: 'impact', skillId: 'sk_imp_5', professionIds: ['prof_df'], basePriority: 2 });
  }
  return makeGraph('position', 'player', '位置逻辑（9×9 网格 → 3×3 区域）', nodes, E);
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

// ---------- 血量逻辑（挂角色）：阈值复合状态 + 内部血量子状态（数值） ----------
// 血量≥50 / 血量<50 是阈值复合状态：内部各有一个血量子状态（数值），
// 受击/回血是复合状态「内部」的数值更新事件（self-loop，不退出复合状态）；
// 只有数值跨回阈值才经「恢复」退出复合状态。持球时无血量事件，无球才触发回血。
function hpGraph(): DomainGraph {
  return makeGraph('hp', 'player', '血量逻辑（阈值复合）', [
    { name: '血量≥50', x: 200, y: 140, note: '阈值复合状态：内部血量子状态（数值 50~100），数值更新不退出状态' },
    { name: '血量<50', x: 520, y: 330, note: '阈值复合状态：内部血量子状态（数值 0~49）；回血是其内部更新事件，数值回到 ≥50 才经「恢复」退出' },
  ], [
    { event: '受击', from: '血量≥50', to: '血量<50', condition: '【前提】双方位置状态重合（同一格）才能造成伤害；数值扣减后 <50（跨阈值进入复合状态）', skillKind: 'impact', affectsOthers: true, basePriority: 2,
      preStates: [{ graph: 'possession', state: '持球', not: true }] },
    { event: '受击', from: '血量<50', to: '血量<50', condition: '复合状态内部更新：数值进一步扣减，仍 <50（不退出复合状态）', skillKind: 'impact', affectsOthers: true, basePriority: 2,
      preStates: [{ graph: 'possession', state: '持球', not: true }] },
    { event: '回血', from: '血量<50', to: '血量<50', condition: '【复合内部】无球状态下每次判定固定回复少量血量（全局参数 hpRegen），数值仍 <50 时不退出复合状态', skillKind: 'aux', skillId: 'sk_aux_1', basePriority: 1,
      preStates: [{ graph: 'possession', state: '无球' }] },
    { event: '恢复', from: '血量<50', to: '血量≥50', condition: '【被动】回血累积使数值跨回 ≥50：退出复合状态（监听回血，于下一次判定执行）', skillKind: 'aux', skillId: 'sk_aux_1', basePriority: 1,
      trigger: 'passive', listenEvents: ['回血'] },
  ]);
}

// ---------- 球路逻辑（挂球实体）：球被持有 / 传向队友（追踪）/ 自由球（朝中心） ----------
// 球的位置状态分两类运动：
//   传向队友 = 传出后朝随机一个队友追踪（队友拿球距离前提满足时自行拿球）；
//   自由球   = 掉球后直接自由运动，朝地图中心滚动（任何人距离前提满足时可拿球）。
function ballTrackGraph(): DomainGraph {
  return makeGraph('ballTrack', 'ball', '球路逻辑', [
    { name: '球被持有', x: 150, y: 260, note: '球在某角色脚下（伴随球权逻辑）' },
    { name: '传向队友', x: 570, y: 130, note: '传出后进入：朝随机一个队友的位置逐 tick 追踪；队友在拿球距离前提满足时触发拿球' },
    { name: '自由球', x: 570, y: 400, note: '掉球/受击掉球后进入：朝地图中心 (4,4) 自由运动；任何球员距离前提满足时可拿球' },
  ], [
    { event: '传出', from: '球被持有', to: '传向队友', condition: '【被动】持球方执行传球/射门（本质：持球→无球）后，球传出并随机选定一名队友作为追踪目标', isHyper: true, basePriority: 7, trigger: 'passive', listenEvents: ['传球', '射'] },
    { event: '掉球', from: '球被持有', to: '自由球', condition: '【被动】掉球/受击掉球后球直接成为自由球，朝地图中心运动', isHyper: true, basePriority: 6, trigger: 'passive', listenEvents: ['掉球', '受击掉球'] },
    { event: '追踪队友', from: '传向队友', to: '传向队友', condition: '朝追踪目标（传出时随机选定的队友）位置移动 1 格；追踪持续到队友拿球为止', basePriority: 3 },
    { event: '滚向中心', from: '自由球', to: '自由球', condition: '朝地图中心 (4,4) 移动 1 格，到达即停', basePriority: 2 },
    { event: '拿球', from: '传向队友', to: '球被持有', condition: '【被动】某球员执行拿球事件（无球→持球，距离前提满足）后，球被该球员持有', isHyper: true, basePriority: 3, trigger: 'passive', listenEvents: ['拿球'] },
    { event: '拿球', from: '自由球', to: '球被持有', condition: '【被动】同上：自由球被距离前提满足的球员拿走', isHyper: true, basePriority: 3, trigger: 'passive', listenEvents: ['拿球'] },
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
  { id: 'sk_imp_1', name: '冲撞抢截', kind: 'impact', damage: 20, displacement: 12, cooldown: 3, range: 1.5, note: '前锋：近身冲撞（伤害+小幅位移）+概率掉球' },
  { id: 'sk_imp_2', name: '飞铲', kind: 'impact', damage: 30, displacement: 6, cooldown: 6, range: 2.5, note: '后卫：高伤害短位移，命中后自身僵直' },
  { id: 'sk_imp_3', name: '射门爆发', kind: 'impact', damage: 10, displacement: 60, cooldown: 8, range: 10, note: '前锋：射门位移 5 格（60m）+少量伤害' },
  { id: 'sk_imp_4', name: '疾跑突进', kind: 'impact', damage: 0, displacement: 36, cooldown: 5, range: 8, note: '中场：直线位移 3 格（36m）' },
  { id: 'sk_imp_5', name: '侧身闪避', kind: 'impact', damage: 0, displacement: 12, cooldown: 2, range: 4, note: '后卫：斜向 1 格（12m）' },
  { id: 'sk_imp_6', name: '肘击', kind: 'impact', damage: 12, displacement: 0, cooldown: 2, range: 0.8, note: '中场：低伤害短冷却' },
  { id: 'sk_sig_1', name: '蓄力储能', kind: 'signal', chargeMax: 100, cooldown: 0, range: 0, note: '信号类：按住射门键持续蓄能，满 100（3 tick）强制起脚' },
  { id: 'sk_aux_1', name: '治疗喷雾', kind: 'aux', effectValue: 25, cooldown: 8, range: 3, note: '辅助类：恢复目标血量（效果值=25）' },
];

// 默认 DFS 起点（多起点：接入位置与血量初始状态；位置 = 3×3 区域状态）
export function defaultStartState(): Record<string, string> {
  return {
    possession: '无球',
    holding: '射门未激活',
    position: '本方-中',
    control: '自由',
    hp: '血量≥50',
    ballTrack: '自由球',
  };
}

// 默认阵型：两队分居球场两侧（A 队 1~2 列，B 队 6~7 列，球在中心格 (4,4)）
export function defaultFormation(players: PlayerSpec[]) {
  return players.map((p) => {
    const mates = players.filter((x) => x.team === p.team);
    const idx = mates.indexOf(p);
    const n = mates.length;
    const col = p.team === 'A' ? 1 + (idx % 2) : GRID_COLS - 3 + (idx % 2);
    const row = Math.round(((idx + 0.5) / n) * (GRID_ROWS - 1));
    return { id: p.id, col, row };
  }).concat([{ id: 'ball', col: Math.floor(GRID_COLS / 2), row: Math.floor(GRID_ROWS / 2) }]);
}

export function createDefaultScenario(): Scenario {
  seq = 0;
  const now = Date.now();
  const players = buildRoster(3, defaultProfessions);
  return {
    id: newId(),
    version: 11,
    name: '示例：3v3 标准赛',
    playersPerTeam: 3,
    professions: defaultProfessions.map((p) => ({ ...p })),
    players,
    graphs: {
      possession: possessionGraph(),
      holding: holdingGraph(),
      position: positionGraph(),
      control: controlGraph(),
      hp: hpGraph(),
      ballTrack: ballTrackGraph(),
    },
    startState: defaultStartState(),
    formation: defaultFormation(players),
    skills: defaultSkills,
    balance: { damage: 15, hpMax: 100, hpDropThreshold: 30, hpRegen: 5, displacement: 5 },
    createdAt: now,
    updatedAt: now,
  };
}
