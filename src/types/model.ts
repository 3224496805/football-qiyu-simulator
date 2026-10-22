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
  timeLimit?: { ticks: number; timeoutEvent?: string }; // 时限状态：进入 ticks 后自动触发 timeoutEvent 出边；缺省 = 无限状态
}

export type SkillKind = 'damage' | 'displacement' | 'signal' | 'aux';

export const SKILL_KIND_NAMES: Record<SkillKind, string> = {
  damage: '伤害',
  displacement: '位移',
  signal: '信号',
  aux: '辅助',
};

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
  condition: string;    // 状态前提（千星沙盒事件节点给出）
  skillKind?: SkillKind; // 主动技能类型
  skillId?: string;   // 绑定的技能模板 id（事件 = 状态变化 + 状态前提 + 主动技能）
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
  chargeMax?: number;    // 信号类：蓄能上限（如蓄力 0~100）
  effectValue?: number;  // 辅助类：效果值（如治疗量/护盾值）
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

export interface FormationSpot { id: string; col: number; row: number } // id=球员id 或 'ball'

export interface Scenario {
  id: string;
  version: number;          // 结构版本，用于存量数据迁移（当前 6）
  name: string;
  playersPerTeam: number;   // 默认 3（总数 6），上限 4（总数 8）
  professions: Profession[];
  players: PlayerSpec[];    // 全体球员名册（两队），长度 = playersPerTeam × 2
  graphs: Record<DomainId, DomainGraph>; // 实体上的状态逻辑图（可自由增删）
  formation?: FormationSpot[]; // 多人位置联合状态的当前落点（球场视图，可选）
  skills: SkillTemplate[];
  balance: BalanceParams;
  createdAt: number;
  updatedAt: number;
}

// 默认事件排序（逻辑链：鼓励合作；v6 按 3v3 新方案更新）
export const DEFAULT_EVENT_ORDER = ['传', '传球', '掉', '掉球', '射', '拿', '拿球', '传出', '位置更新', '距离小', '距离大', '蓄力储能', '蓄力状态结束', '打断', '被打断', '状态结束', '受击', '恢复', '回复', '争顶', '持球', '射门结束'];

export function defaultOrderIndex(name: string): number {
  const i = DEFAULT_EVENT_ORDER.indexOf(name);
  return i === -1 ? DEFAULT_EVENT_ORDER.length + name.charCodeAt(0) % 50 : i;
}
