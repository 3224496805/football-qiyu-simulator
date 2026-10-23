// 默认示例方案 v16.4：3v3 标准赛（移动四方向 + 冲击技能 + 受击/掉球链 + 回血自愈 + 受控限时）
//
// 本次调整（用户原话落地）：
//   1）「移动」拆成前进/后退/左移/右移四条主动事件，每条固定走 1 格，冷却与检测同频（1 拍）；
//   2）新增通用技能「冲击」：位移到持球者所在格 + 造成伤害（作用于对方），
//      前提是两人距离 ≤ 攻击距离参数（默认 2 格，可在维度页底部调）；
//   3）受击链接通：「受击」（血量≥50→血量<50）→ 监听它的「掉球」（姿态自由→受控 + 球权持球→无球）
//      和「打断」（蓄力→无球）；球侧由「球变自由」（监听掉球）接管。
//   4）新增「回血」被动事件：无球状态下持续检测，每拍回 10 点血，满血自动停；
//   5）受控锁定 + 限时：所有主动事件统一挂前提「姿态 ≠ 受控」——受控状态下所有主动事件失效；
//      受控是限时状态，进入受控满「受控持续参数」拍后，被动事件「缓过来」自动把姿态恢复自由
//      （时间参数默认 5 拍，维度页底部的平衡参数里可调）。
//   模拟器现在有真实格子坐标（9×9）：拿球距离、攻击距离、射门距离都是真实判定。
// v16.7（用户原话落地）：「射门未激活」并入「无球」——没球、或有球但离球门远，都算「无球」；
//   「进入射门待命」事件随之删除；「距离小」改为唯一入口：前提持球 + 距离 ≤ 射门距离，无球 → 射门激活；
//   「距离大」出口改为 射门激活 → 无球；「传球」不再单独列 射门未激活→未持球 这条变化。
//
// 铁律不变：一条事件只属于一个实体，只能改自己维度的状态；跨实体联动 = 被动监听信号。
import type { Dimension, PlayerSpec, Profession, QiyuEvent, Scenario2 } from '@/types/model2';
import { newDimensionId, newEventId, SCENARIO_VERSION } from '@/types/model2';

// ---------- 位置维度：9×9 网格压成的 3×3 区域状态 ----------
export const ZONE_X = ['本方', '中带', '对方'] as const;
export const ZONE_Y = ['左', '中', '右'] as const;
export function zoneName(zx: number, zy: number) {
  return `${ZONE_X[zx]}-${ZONE_Y[zy]}`;
}

const dim = (name: string, owner: Dimension['owner'], states: string[], note?: string): Dimension => ({
  id: newDimensionId(),
  name,
  owner,
  states,
  stateNotes: {},
  note,
});

interface EvDef {
  name: string;
  owner: QiyuEvent['owner'];
  trigger: QiyuEvent['trigger'];
  listen?: string[];
  preStates?: QiyuEvent['preStates'];
  effects?: QiyuEvent['effects'];
  numeric?: QiyuEvent['numeric'];
  affectsOthers?: boolean;
  condition?: string;
  note?: string;
  basePriority?: number;
  cooldown?: number;
  professions?: string[];
  group?: string;
}

const ev = (d: EvDef): QiyuEvent => ({
  id: newEventId(),
  name: d.name,
  owner: d.owner,
  trigger: d.trigger,
  listen: d.listen ?? [],
  preStates: d.preStates ?? [],
  effects: d.effects ?? [],
  numeric: d.numeric ?? [],
  affectsOthers: d.affectsOthers ?? false,
  condition: d.condition ?? '',
  note: d.note ?? '',
  basePriority: d.basePriority ?? 1,
  cooldown: d.cooldown ?? 0,
  professions: d.professions ?? [],
  group: d.group,
});

export const defaultProfessions: Profession[] = [
  { id: 'prof_fw', name: '前锋', note: '爆发位移 + 冲撞抢截' },
  { id: 'prof_mf', name: '中场', note: '疾跑突进 + 肘击' },
  { id: 'prof_df', name: '后卫', note: '闪避回追 + 飞铲' },
];

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

function positionStates(): string[] {
  const out: string[] = [];
  for (let zy = 0; zy < 3; zy++) for (let zx = 0; zx < 3; zx++) out.push(zoneName(zx, zy));
  return out;
}

// 「移动」四方向：每条只覆盖该方向上的区域边界跨越（每方向 6 条状态变化）
// 同一区域内移动只是底层格子坐标变化，不改变逻辑状态（模拟器里按格走）
function dirEffects(dimId: string, dx: number, dy: number): QiyuEvent['effects'] {
  const out: QiyuEvent['effects'] = [];
  for (let zy = 0; zy < 3; zy++) {
    for (let zx = 0; zx < 3; zx++) {
      const nx = zx + dx, ny = zy + dy;
      if (nx < 0 || nx > 2 || ny < 0 || ny > 2) continue;
      out.push({ dimension: dimId, from: zoneName(zx, zy), to: zoneName(nx, ny) });
    }
  }
  return out;
}

// 向进攻侧（横向 +1）跨区：冲刺用
function forwardEffects(dimId: string): QiyuEvent['effects'] {
  const out: QiyuEvent['effects'] = [];
  for (let zy = 0; zy < 3; zy++) {
    for (let zx = 0; zx + 1 < 3; zx++) {
      out.push({ dimension: dimId, from: zoneName(zx, zy), to: zoneName(zx + 1, zy) });
    }
  }
  return out;
}

export function createDefaultScenario2(): Scenario2 {
  const dimensions: Dimension[] = [
    dim('球权', 'player', ['无球', '持球'], '角色当前是否控制球'),
    dim('射门', 'player', ['无球', '射门激活', '蓄力'], '射门状态机：基础状态叫「无球」（没球、或有球但离球门远都算）；拿着球且离球门够近才进「射门激活」→ 蓄力 → 出脚'),
    dim('位置', 'player', positionStates(), '3×3 区域状态；同区域内移动只是底层坐标变化，不产生事件'),
    dim('姿态', 'player', ['自由', '受控'], '被冲击命中掉球后进入受控；受控是限时状态，满「受控持续参数」拍后由「缓过来」自动恢复自由'),
    dim('血量', 'player', ['血量≥50', '血量<50'], '阈值状态：受击跌破 50；状态变化由模拟器按真实血量数值判定'),
    dim('球路', 'ball', ['球被持有', '传向队友', '自由球', '飞向球门'], '球自身的运动状态；「飞向球门」是射门后的新状态'),
    dim('球门', 'goal', ['等待', '进1球', '进2球', '结算'], '球门实体：拿满三次球就进入结算（从任意状态）'),
  ];
  const D = Object.fromEntries(dimensions.map((d) => [d.name, d.id]));
  const P = D['球权'], S = D['射门'], W = D['位置'], ZI = D['姿态'], H = D['血量'], B = D['球路'], G = D['球门'];

  // 受控锁定：所有主动事件都挂这条前提——姿态必须不是「受控」（用户规则：受控状态下所有主动事件失效）
  // 每次调用返回新对象，避免多条事件共享同一条前提
  const freeOnly = (): QiyuEvent['preStates'][number] => ({ dimension: ZI, state: '受控', not: true });

  const events: QiyuEvent[] = [
    // ========== 角色 · 主动（玩家操作从客户端发出） ==========
    // 移动四方向：每条固定走 1 格，冷却 1 拍（与检测同频）；区域内移动只改格子坐标
    // 所有主动事件都带 freeOnly() 前提：受控状态下全部失效（无法触发）
    ev({
      name: '前进', owner: 'player', trigger: '主动', cooldown: 1, basePriority: 5,
      preStates: [freeOnly()],
      condition: '按住方向键（朝球门一侧）；每拍最多 1 格，与检测同频',
      effects: dirEffects(W, 1, 0),
      numeric: [{ kind: '位移', value: 12 }],
      note: '固定 1 格（12m）；跨过区域边界时才产生逻辑状态变化',
    }),
    ev({
      name: '后退', owner: 'player', trigger: '主动', cooldown: 1, basePriority: 5,
      preStates: [freeOnly()],
      condition: '按住方向键（背朝球门）；每拍最多 1 格',
      effects: dirEffects(W, -1, 0),
      numeric: [{ kind: '位移', value: 12 }],
    }),
    ev({
      name: '左移', owner: 'player', trigger: '主动', cooldown: 1, basePriority: 5,
      preStates: [freeOnly()],
      condition: '按住方向键（左侧）；每拍最多 1 格',
      effects: dirEffects(W, 0, -1),
      numeric: [{ kind: '位移', value: 12 }],
    }),
    ev({
      name: '右移', owner: 'player', trigger: '主动', cooldown: 1, basePriority: 5,
      preStates: [freeOnly()],
      condition: '按住方向键（右侧）；每拍最多 1 格',
      effects: dirEffects(W, 0, 1),
      numeric: [{ kind: '位移', value: 12 }],
    }),
    ev({
      name: '冲刺', owner: 'player', trigger: '主动',
      preStates: [freeOnly()],
      condition: '冲刺键 且 体力 > 0（向进攻方向跨 1 区 ≈ 3 格）',
      effects: forwardEffects(W),
      numeric: [{ kind: '位移', value: 36 }],
    }),
    ev({
      name: '冲击', owner: 'player', trigger: '主动', basePriority: 6, cooldown: 3,
      preStates: [
        freeOnly(),
        { dimension: P, state: '无球' },
        { dimension: B, state: '球被持有' },
      ],
      condition: '与持球者的距离 ≤ 攻击距离参数（默认 2 格，维度页底部可调）',
      effects: [],
      numeric: [{ kind: '位移', value: 24 }, { kind: '扣血', value: 15 }],
      affectsOthers: true,
      note: '通用技能：冲到持球者所在格并造成伤害（作用于对方；目标就是持球的对家）。位置变化是"动态位移"——目标在哪就冲到哪，图上看不到固定的位置边',
    }),
    ev({
      name: '拿球', owner: 'player', trigger: '主动', basePriority: 3,
      group: '拿球',
      preStates: [
        freeOnly(),
        { dimension: B, state: '球被持有', not: true },
        { dimension: B, state: '飞向球门', not: true },
      ],
      condition: '与球距离 ≤ 2 格（模拟器按真实格子判定）',
      effects: [{ dimension: P, from: '无球', to: '持球' }],
      note: '前提：球没被任何人拿着、也不在飞行中（只能拿「传向队友」或「自由球」）；球那边的「球被拿」被动监听到本事件后才改球的状态',
    }),
    ev({
      name: '传球', owner: 'player', trigger: '主动', basePriority: 7,
      group: '传球',
      preStates: [freeOnly(), { dimension: P, state: '持球' }],
      condition: '按下传球键，选定队友后传出（信号类技能·传球引导）',
      effects: [
        { dimension: P, from: '持球', to: '无球' },
        { dimension: S, from: '射门激活', to: '无球' },
      ],
      note: '传球的本质只是结束本方球权；球往哪走由球的「传出」被动事件负责，接球方到位后自己「拿球」',
    }),
    ev({
      name: '蓄力', owner: 'player', trigger: '主动', basePriority: 4,
      preStates: [freeOnly(), { dimension: P, state: '持球' }],
      condition: '在「射门激活」状态下按住射门键：先进入蓄力状态；蓄力约 3 tick 后结束（不可取消）',
      effects: [{ dimension: S, from: '射门激活', to: '蓄力' }],
      numeric: [{ kind: '蓄能', value: 100 }],
      note: '按新定义：射门激活 → 蓄力，蓄力是出脚前的必经状态',
    }),

    // ========== 角色 · 被动（检测到状态变化后触发） ==========
    ev({
      name: '受击', owner: 'player', trigger: '被动', basePriority: 6,
      condition: '血量数值跌破 50（持续检测；血量维度的状态变化由模拟器按真实血量数值判定）',
      effects: [{ dimension: H, from: '血量≥50', to: '血量<50' }],
      note: '阈值事件：血量数值跌破 50 时把血量状态切过去；「掉球」「打断」都在监听它',
    }),
    ev({
      name: '掉球', owner: 'player', trigger: '被动', listen: ['受击'], basePriority: 6,
      group: '掉球',
      condition: '受击后血量跌破 50（由监听「受击」保证）',
      effects: [
        { dimension: ZI, from: '自由', to: '受控' },
        { dimension: P, from: '持球', to: '无球' },
      ],
      note: '执行落在姿态和球权两个维度：被打后即受控又丢球；球侧由「球变自由」（监听本事件）接管',
    }),
    ev({
      name: '打断', owner: 'player', trigger: '被动', listen: ['受击'], basePriority: 6,
      preStates: [{ dimension: S, state: '蓄力' }],
      condition: '蓄力中被受击命中（唯一退出蓄力的方式）',
      effects: [{ dimension: S, from: '蓄力', to: '无球' }],
      note: '监听「受击」：蓄力中挨打会被打回无球',
    }),
    ev({
      name: '射门', owner: 'player', trigger: '被动', basePriority: 7,
      group: '射门',
      preStates: [{ dimension: S, state: '蓄力' }],
      condition: '蓄力状态结束（蓄能满或松开射门键），持续检测；前提：必须正处于「蓄力」状态',
      effects: [
        { dimension: S, from: '蓄力', to: '无球' },
        { dimension: P, from: '持球', to: '无球' },
      ],
      note: '按新定义：蓄力结束后出脚，把球传给球门实体；前提必须处于蓄力状态，否则光凭"持球"变化就会误触发；球由「飞向球门」被动接管，球门由「球门拿球」「比赛结算」接管',
    }),
    ev({
      name: '距离小', owner: 'player', trigger: '被动', basePriority: 2,
      preStates: [{ dimension: P, state: '持球' }],
      condition: '拿着球、且与球门距离 ≤ 射门距离参数（两个条件同时满足才触发；模拟器按真实格子判定）',
      effects: [{ dimension: S, from: '无球', to: '射门激活' }],
      note: '「射门未激活」已并入「无球」：没球、或有球但离球门远，都算无球；从这边进「射门激活」必须持球 + 距离小同时成立',
    }),
    ev({
      name: '距离大', owner: 'player', trigger: '被动',
      condition: '与球门距离 > 射门距离参数（退出射门前提；模拟器按真实格子判定）',
      effects: [{ dimension: S, from: '射门激活', to: '无球' }],
    }),
    ev({
      name: '回血', owner: 'player', trigger: '被动', cooldown: 1, basePriority: 2,
      preStates: [{ dimension: P, state: '无球' }],
      condition: '无球状态下持续自愈（持续检测，每拍一次；血满了自动停）',
      effects: [],
      numeric: [{ kind: '回血', value: 10 }],
      note: '缓慢自愈：没球在身时每拍回 10 点血，直到血量上限；受控时也能回（受控只锁主动事件，不锁被动）',
    }),
    ev({
      name: '缓过来', owner: 'player', trigger: '被动', basePriority: 5,
      preStates: [{ dimension: ZI, state: '受控' }],
      condition: '受控是限时状态：进入受控满「受控持续参数」拍后自动触发（默认 5 拍，维度页底部可调）',
      effects: [{ dimension: ZI, from: '受控', to: '自由' }],
      note: '受控倒计时结束的出口：时间一到自动回自由，主动事件随之恢复；回血只补血、不影响这个倒计时',
    }),

    // ========== 球 · 被动（球只改自己的球路状态） ==========
    ev({
      name: '传出', owner: 'ball', trigger: '被动', listen: ['传球'], basePriority: 7,
      group: '传球',
      condition: '随机选定一名队友作为追踪目标',
      effects: [{ dimension: B, from: '球被持有', to: '传向队友' }],
      note: '球被动监听到「传球」的信号后，自己进入追踪状态（射门走另一条「飞向球门」）',
    }),
    ev({
      name: '球变自由', owner: 'ball', trigger: '被动', listen: ['掉球'], basePriority: 6,
      group: '掉球',
      effects: [{ dimension: B, from: '球被持有', to: '自由球' }],
      note: '掉球后球直接成为自由球，朝球场中心滚动',
    }),
    ev({
      name: '球被拿', owner: 'ball', trigger: '被动', listen: ['拿球'], basePriority: 3,
      group: '拿球',
      effects: [
        { dimension: B, from: '传向队友', to: '球被持有' },
        { dimension: B, from: '自由球', to: '球被持有' },
      ],
      note: '任一变化命中即被持有（在追踪中被断下 / 自由球被捡起），并吸附到拿球人脚下',
    }),
    ev({
      name: '飞向球门', owner: 'ball', trigger: '被动', listen: ['射门'], basePriority: 7,
      group: '射门',
      condition: '射门出脚后球朝球门飞行，飞抵即算球门拿球',
      effects: [{ dimension: B, from: '球被持有', to: '飞向球门' }],
      note: '配合球门实体的「球门拿球」「比赛结算」完成进球判定',
    }),
    ev({
      name: '重新开出', owner: 'ball', trigger: '被动', listen: ['球门拿球'], basePriority: 8,
      effects: [{ dimension: B, from: '飞向球门', to: '自由球' }],
      note: '球门计分后球回到场内，成为自由球（进球不算的结算那一下除外，那时比赛已结束）',
    }),
    ev({
      name: '追踪队友', owner: 'ball', trigger: '被动', basePriority: 3,
      preStates: [{ dimension: B, state: '传向队友' }],
      condition: '每 tick 朝传出时选定的队友移动 1 格，直到被拿走',
      effects: [{ dimension: B, from: '传向队友', to: '传向队友' }],
      numeric: [{ kind: '位移', value: 12 }],
    }),
    ev({
      name: '滚向中心', owner: 'ball', trigger: '被动', basePriority: 2,
      preStates: [{ dimension: B, state: '自由球' }],
      condition: '每 tick 朝球场中心移动 1 格，到达即停',
      effects: [{ dimension: B, from: '自由球', to: '自由球' }],
      numeric: [{ kind: '位移', value: 12 }],
    }),

    // ========== 球门 · 被动（球门实体的计分与结算） ==========
    ev({
      name: '球门拿球', owner: 'goal', trigger: '被动', listen: ['射门'], basePriority: 8,
      preStates: [{ dimension: B, state: '飞向球门' }],
      condition: '球飞抵球门（球路必须是「飞向球门」）：第 1、2 次拿球时计分',
      effects: [
        { dimension: G, from: '等待', to: '进1球' },
        { dimension: G, from: '进1球', to: '进2球' },
      ],
      note: '球门实体拿到球的计数推进；前提是球真的朝球门飞（传球/自由球滚到球门口不算进球）',
    }),
    ev({
      name: '比赛结算', owner: 'goal', trigger: '被动', listen: ['射门'], basePriority: 9,
      preStates: [{ dimension: B, state: '飞向球门' }],
      condition: '球门实体累计拿满 3 次球——无论当前处于哪个状态（覆盖总超图任意状态），都进入「结算」',
      effects: [
        { dimension: G, from: '等待', to: '结算' },
        { dimension: G, from: '进1球', to: '结算' },
        { dimension: G, from: '进2球', to: '结算' },
      ],
      note: '同一维度写多条 = 从任一源状态出发都可以，正好实现"任意状态进结算"',
    }),
  ];

  const now = Date.now();
  return {
    id: `sc_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    version: SCENARIO_VERSION,
    name: '示例：3v3 标准赛',
    playersPerTeam: 3,
    professions: defaultProfessions.map((p) => ({ ...p })),
    players: buildRoster(3, defaultProfessions),
    dimensions,
    events,
    startState: {
      [P]: '无球',
      [S]: '无球',
      [W]: '本方-中',
      [D['姿态']]: '自由',
      [D['血量']]: '血量≥50',
      [B]: '自由球',
      [G]: '等待',
    },
    balance: { damage: 15, hpMax: 100, hpDropThreshold: 30, hpRegen: 5, displacement: 5, attackRange: 2, shootRange: 3, controlTicks: 5 },
    createdAt: now,
    updatedAt: now,
  };
}
