// 足球奇域模拟器 · 数据模型 v4
// 实体严格区分：角色实体 vs 球实体
// 逻辑图可自由增删：每个实体上可挂任意数量的状态逻辑图
// 权威优先级 = 总状态逻辑超图（跨图同名状态粘合）上的 DFS 搜索树
export type DomainId = string; // 逻辑图 id（可自由增删，如 possession / position / myGraph）

export type EntityKind = 'player' | 'ball';

export const ENTITY_NAMES: Record<EntityKind, string> = {
  player: '角色实体',
  ball: '球实体',
};

export interface StateNode {
  id: string;
  name: string;
  x: number; // 画布坐标
  y: number;
  note?: string;
}

export type SkillKind = 'damage' | 'displacement';

export interface EventParams {
  basePriority: number;  // 手动基础优先级
  cooldown: number;      // 冷却 tick
  structWeight: number;  // 结构权重
}

export interface DomainEdge {
  id: string;
  event: string;        // 事件名
  from: string;         // StateNode.id
  to: string;
  condition: string;    // 条件（千星沙盒事件节点给出）
  skillKind?: SkillKind; // 技能模板类型（未接入游戏，仅模板）
  isHyper: boolean;     // 多实体联合事件（超边）
  affectsOthers: boolean; // 是否影响其他实体
  professionIds?: string[]; // 仅限这些职业拥有该事件；空/undefined = 全职业通用
  params: EventParams;
}

export interface DomainGraph {
  id: DomainId;         // = 键名
  owner: EntityKind;    // 挂在哪类实体上
  name: string;         // 逻辑图名（可改）
  nodes: StateNode[];
  edges: DomainEdge[];
}

export interface SkillTemplate {
  id: string;
  name: string;
  kind: SkillKind;
  damage?: number;       // 伤害大小
  displacement?: number; // 位移距离
  cooldown: number;
  range?: number;
  note?: string;
}

export interface Profession {
  id: string;
  name: string;   // 如 前锋/中场/后卫
  note?: string;
}

export interface PlayerSpec {
  id: string;
  name: string;          // 如 红1 / 蓝2
  team: 'A' | 'B';
  professionId: string;  // 同职业 = 相同技能事件集合
}

export interface BalanceParams {
  damage: number;           // 全局伤害基准
  hpMax: number;            // 血量上限
  hpDropThreshold: number;  // 掉球血量阈值
  displacement: number;     // 位移基准距离（米）
}

export interface Scenario {
  id: string;
  version: number;          // 结构版本，用于存量数据迁移（当前 4）
  name: string;
  playersPerTeam: number;   // 默认 3（总数 6），上限 4（总数 8）
  professions: Profession[];
  players: PlayerSpec[];    // 全体球员名册（两队），长度 = playersPerTeam × 2
  graphs: Record<DomainId, DomainGraph>; // 实体上的状态逻辑图（可自由增删）
  skills: SkillTemplate[];
  balance: BalanceParams;
  createdAt: number;
  updatedAt: number;
}

// 默认事件排序（逻辑链：鼓励合作）
export const DEFAULT_EVENT_ORDER = ['传', '掉', '射', '打断', '蓄力条更新', '拿', '争顶', '激活射门技能', '关闭射门技能'];

export function defaultOrderIndex(name: string): number {
  const i = DEFAULT_EVENT_ORDER.indexOf(name);
  return i === -1 ? DEFAULT_EVENT_ORDER.length + name.charCodeAt(0) % 50 : i;
}
