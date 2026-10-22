// 足球奇域模拟器 · 数据模型 v15（重做版）
//
// 核心原则：事件库是唯一数据源。
//   逻辑图 = 把事件库按某一个维度（球权/位置/姿态/血量/球路……）过滤后画出的状态转移图
//   总超图 = 把全部维度的事件合并，同名状态自动粘合，代表整个奇域关卡的精准状态
//   改事件库 → 两张图自动更新；图本身不存数据（阶段 2 才支持在图上反向编辑事件）
//
// 术语对齐千星沙箱官方创作体系：
//   主动事件 = 从客户端发出（玩家按键/操作触发）
//   被动事件 = 检测到状态发生变化后触发（≈ 官方「当……时」事件节点）
//   监听     = 信号全局可达：被动事件可声明监听哪些事件，被监听的事件执行后，它加入下一次判定；
//              不填监听 = 持续检测（每次判定都检查前提是否满足）
//   前提状态 = 事件判定前必须（或必须不）处于的状态，可跨维度组合，0~n 条
//   执行效果 = 状态变化（从某状态到某状态，可跨维度多条）+ 数值效果（可空）

export type TriggerKind = '主动' | '被动';
export type NumericKind = '扣血' | '回血' | '位移' | '蓄能';
export type EntityKind = 'player' | 'ball' | 'goal';

export const TRIGGER_KINDS: TriggerKind[] = ['主动', '被动'];
export const NUMERIC_KINDS: NumericKind[] = ['扣血', '回血', '位移', '蓄能'];
export const ENTITY_KINDS: EntityKind[] = ['player', 'ball', 'goal'];

export const ENTITY_NAMES: Record<EntityKind, string> = {
  player: '角色',
  ball: '球',
  goal: '球门',
};

// 前提状态：判定前，某维度必须处于（not=true 时必须不处于）某状态
export interface PreCondition {
  dimension: string; // 维度 id
  state: string;     // 状态名
  not?: boolean;
}

// 状态变化：某维度 从 from 状态 转到 to 状态
// 同一维度写多条 = 从任一源状态出发都可以（谁先命中谁执行）
export interface StateChange {
  dimension: string;
  from: string;
  to: string;
}

// 数值效果：不改变状态，只改数值（可空）
export interface NumericEffect {
  kind: NumericKind;
  value: number;
}

export interface QiyuEvent {
  id: string;
  name: string;
  owner: EntityKind;         // 归属实体：这条事件是角色身上的还是球身上的。
                             // 千星沙箱规则：每个实体只能改自己的状态，
                             // 跨实体联动必须拆成「对方被动监听到信号后自己改」的另一条事件
  trigger: TriggerKind;
  listen: string[];          // 被动事件监听的事件名列表；空 = 持续检测
  preStates: PreCondition[]; // 前提状态（可跨维度，0~n 条）
  effects: StateChange[];    // 状态变化（只能落在归属实体自己的维度上；空 = 纯数值/纯信号事件）
  numeric: NumericEffect[];  // 数值效果（可空）
  affectsOthers: boolean;    // 数值效果是否作用于对方（如攻击命中扣对方的血）
  condition: string;         // 非状态类前提（距离、数值门槛等），用文字补充描述
  note: string;              // 说明
  basePriority: number;      // 手动基础优先级（阶段 3 的算法会用它做微调）
  cooldown: number;          // 冷却（tick）
  professions: string[];     // 仅限这些职业拥有；空 = 全职业通用
  group?: string;            // 复合组名（可选）：同一个名字的跨实体事件 = 一条"复合事件"的两半
                             // 例：角色的「拿球」（主动）+ 球的「球被拿」（被动监听）合成复合事件「拿球」
}

// 状态维度：事件的分组依据。维度本身不存转移关系（转移关系在事件里）。
export interface Dimension {
  id: string;
  name: string;              // 如 球权 / 位置 / 姿态 / 血量 / 球路
  owner: EntityKind;         // 挂在角色身上还是球身上
  states: string[];          // 该维度声明的状态名
  stateNotes: Record<string, string>; // 状态备注（可选）
  note?: string;
}

export interface Profession {
  id: string;
  name: string;   // 如 前锋/中场/后卫
  note?: string;
}

export interface PlayerSpec {
  id: string;
  name: string;   // 如 红1 / 蓝2
  team: 'A' | 'B';
  professionId: string;
}

// 优先级打分公式的可调权重：优先级页顶部的滑杆调的就是这几个数。
// 不填就用默认值 DEFAULT_PRIORITY_WEIGHTS；它会随方案一起保存/导出。
export interface PriorityWeights {
  wSteady: number;  // 稳态概率权重：长期运行下停留越多的状态，它发出的变化越重要
  wPath: number;    // 主循环路径权重：离主循环越近、能到达的层越深，越重要
  wManual: number;  // 手动微调权重：事件的「基础优先级 ÷ 10」占的比重
  penalty: number;  // 短环惩罚：落在短环（2~3 个状态的小圈）里的变化，得分乘以这个数（0=完全压掉，1=不惩罚）
  jump: number;     // 随机跳转概率：算稳态时每一步随机跳到任意状态的几率，防止死角状态永远轮不到（一般 0.1~0.2）
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  wSteady: 0.4,
  wPath: 0.3,
  wManual: 0.3,
  penalty: 0.3,
  jump: 0.15,
};

export interface BalanceParams {
  damage: number;           // 全局伤害基准
  hpMax: number;            // 血量上限
  hpDropThreshold: number;  // 掉球血量阈值
  hpRegen: number;          // 无球时每次回血的固定回复量
  displacement: number;     // 位移基准距离（米）
  attackRange: number;      // 攻击距离（格）：冲击类技能能打到多远的目标
  shootRange: number;       // 射门距离（格）：离球门多近才能激活射门
}

export const SCENARIO_VERSION = 15;

export interface Scenario2 {
  id: string;
  version: number;           // = 15
  name: string;
  playersPerTeam: number;
  professions: Profession[];
  players: PlayerSpec[];
  dimensions: Dimension[];   // 状态维度列表
  events: QiyuEvent[];       // 事件库（唯一数据源）
  startState: Record<string, string>; // 维度 id -> 起始状态名
  balance: BalanceParams;
  weights?: PriorityWeights; // 优先级公式权重（可选，缺省用 DEFAULT_PRIORITY_WEIGHTS）
  createdAt: number;
  updatedAt: number;
}

export function newEventId(): string {
  return `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newDimensionId(): string {
  return `dim_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
