// 足球奇域模拟器 · 数据模型
export type DomainId = 'ball' | 'position' | 'control' | 'hp';

export const DOMAIN_IDS: DomainId[] = ['ball', 'position', 'control', 'hp'];

export const DOMAIN_NAMES: Record<DomainId, string> = {
  ball: '球逻辑',
  position: '位置逻辑',
  control: '控制逻辑',
  hp: '血量逻辑',
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
  basePriority: number;  // 手动基础优先级（默认序：传7 掉6 射5 蓄力更新4 拿3 激活2 关闭1）
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
  params: EventParams;
}

export interface DomainGraph {
  domain: DomainId;
  name: string;
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

export interface BalanceParams {
  damage: number;           // 全局伤害基准
  hpMax: number;            // 血量上限
  hpDropThreshold: number;  // 掉球血量阈值
  displacement: number;     // 位移基准距离
}

export interface Scenario {
  id: string;
  name: string;
  playersPerTeam: number;   // 默认 3（总数 6），上限 4（总数 8）
  graphs: Record<DomainId, DomainGraph>;
  skills: SkillTemplate[];
  balance: BalanceParams;
  createdAt: number;
  updatedAt: number;
}

// 默认事件排序（逻辑链：鼓励合作）
export const DEFAULT_EVENT_ORDER = ['传', '掉', '射', '蓄力条更新', '拿', '激活射门技能', '关闭射门技能'];

export function defaultOrderIndex(name: string): number {
  const i = DEFAULT_EVENT_ORDER.indexOf(name);
  return i === -1 ? DEFAULT_EVENT_ORDER.length + name.charCodeAt(0) % 50 : i;
}
