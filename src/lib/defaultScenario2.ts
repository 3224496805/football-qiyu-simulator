// 默认示例方案 v15.2：3v3 标准赛（按用户指示精简 + 球门实体）
//
// 本次调整（用户原话落地）：
//   1）所有和球无关的被动事件、主动技能先删掉（受击/被打断/状态结束/回血/恢复，
//      冲撞抢截/肘击/飞铲/射门爆发/疾跑突进/侧身闪避），用户晚些自己重构；
//      「掉球」「打断」因后续要挂回受击体系，暂时保留（监听着不存在的「受击」，体检会提醒）。
//   2）蓄力事件 = 在「射门激活」状态下先进入「蓄力」状态；
//      射门事件 = 蓄力状态结束后把球传给球门实体。
//   3）新增球门实体：拿满三次球，就从任意状态进入「结算」状态。
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

// 「移动」：相邻区域双向互通，共 24 条状态变化
function moveEffects(dimId: string): QiyuEvent['effects'] {
  const out: QiyuEvent['effects'] = [];
  for (let zy = 0; zy < 3; zy++) {
    for (let zx = 0; zx < 3; zx++) {
      if (zx + 1 < 3) {
        out.push({ dimension: dimId, from: zoneName(zx, zy), to: zoneName(zx + 1, zy) });
        out.push({ dimension: dimId, from: zoneName(zx + 1, zy), to: zoneName(zx, zy) });
      }
      if (zy + 1 < 3) {
        out.push({ dimension: dimId, from: zoneName(zx, zy), to: zoneName(zx, zy + 1) });
        out.push({ dimension: dimId, from: zoneName(zx, zy + 1), to: zoneName(zx, zy) });
      }
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
    dim('射门', 'player', ['未持球', '射门未激活', '射门激活', '蓄力'], '持球期间叠加的射门状态机（按新定义：激活→蓄力→出脚）'),
    dim('位置', 'player', positionStates(), '3×3 区域状态；同区域内移动只是底层坐标变化，不产生事件'),
    dim('姿态', 'player', ['自由', '受控'], '（事件已删，等你晚些重构）'),
    dim('血量', 'player', ['血量≥50', '血量<50'], '（事件已删，等你晚些重构）'),
    dim('球路', 'ball', ['球被持有', '传向队友', '自由球', '飞向球门'], '球自身的运动状态；「飞向球门」是射门后的新状态'),
    dim('球门', 'goal', ['等待', '进1球', '进2球', '结算'], '球门实体：拿满三次球就进入结算（从任意状态）'),
  ];
  const D = Object.fromEntries(dimensions.map((d) => [d.name, d.id]));
  const P = D['球权'], S = D['射门'], W = D['位置'], B = D['球路'], G = D['球门'];

  const events: QiyuEvent[] = [
    // ========== 角色 · 主动（玩家操作从客户端发出） ==========
    ev({
      name: '移动', owner: 'player', trigger: '主动',
      condition: '方向输入导致的跨区移动（同一区域内移动只是底层坐标变化，不产生事件）',
      effects: moveEffects(W),
      note: '一条事件覆盖 3×3 区域间的全部相邻双向移动（24 条状态变化）',
    }),
    ev({
      name: '冲刺', owner: 'player', trigger: '主动',
      condition: '冲刺键 且 体力 > 0（向进攻方向跨 1 区 ≈ 3 格）',
      effects: forwardEffects(W),
    }),
    ev({
      name: '拿球', owner: 'player', trigger: '主动', basePriority: 3,
      preStates: [
        { dimension: B, state: '球被持有', not: true },
        { dimension: B, state: '飞向球门', not: true },
      ],
      condition: '与球距离 ≤ 2 格',
      effects: [{ dimension: P, from: '无球', to: '持球' }],
      note: '前提：球没被任何人拿着、也不在飞行中（只能拿「传向队友」或「自由球」）；球那边的「球被拿」被动监听到本事件后才改球的状态',
    }),
    ev({
      name: '传球', owner: 'player', trigger: '主动', basePriority: 7,
      preStates: [{ dimension: P, state: '持球' }],
      condition: '按下传球键，选定队友后传出（信号类技能·传球引导）',
      effects: [
        { dimension: P, from: '持球', to: '无球' },
        { dimension: S, from: '射门未激活', to: '未持球' },
        { dimension: S, from: '射门激活', to: '未持球' },
      ],
      note: '传球的本质只是结束本方球权；球往哪走由球的「传出」被动事件负责，接球方到位后自己「拿球」',
    }),
    ev({
      name: '蓄力', owner: 'player', trigger: '主动', basePriority: 4,
      preStates: [{ dimension: P, state: '持球' }],
      condition: '在「射门激活」状态下按住射门键：先进入蓄力状态；蓄力约 3 tick 后结束（不可取消）',
      effects: [{ dimension: S, from: '射门激活', to: '蓄力' }],
      numeric: [{ kind: '蓄能', value: 100 }],
      note: '按新定义：射门激活 → 蓄力，蓄力是出脚前的必经状态',
    }),

    // ========== 角色 · 被动（检测到状态变化后触发） ==========
    ev({
      name: '射门', owner: 'player', trigger: '被动', basePriority: 7,
      preStates: [{ dimension: S, state: '蓄力' }],
      condition: '蓄力状态结束（蓄能满或松开射门键），持续检测；前提：必须正处于「蓄力」状态',
      effects: [
        { dimension: S, from: '蓄力', to: '未持球' },
        { dimension: P, from: '持球', to: '无球' },
      ],
      note: '按新定义：蓄力结束后出脚，把球传给球门实体；前提必须处于蓄力状态，否则光凭"持球"变化就会误触发；球由「飞向球门」被动接管，球门由「球门拿球」「比赛结算」接管',
    }),
    ev({
      name: '掉球', owner: 'player', trigger: '被动', listen: ['受击'], basePriority: 6,
      condition: '受击结算后，血量数值低于掉球阈值才触发',
      effects: [
        { dimension: P, from: '持球', to: '无球' },
        { dimension: S, from: '射门未激活', to: '未持球' },
        { dimension: S, from: '射门激活', to: '未持球' },
        { dimension: S, from: '蓄力', to: '未持球' },
      ],
      note: '「受击」体系已删、等你重构；这条先保留着监听，重构后直接生效',
    }),
    ev({
      name: '打断', owner: 'player', trigger: '被动', listen: ['受击'], basePriority: 6,
      preStates: [{ dimension: S, state: '蓄力' }],
      condition: '蓄力中被受击命中（唯一退出蓄力的方式）',
      effects: [{ dimension: S, from: '蓄力', to: '未持球' }],
      note: '同上：等受击体系重构后自动接入',
    }),
    ev({
      name: '进入射门待命', owner: 'player', trigger: '被动', listen: ['拿球'],
      effects: [{ dimension: S, from: '未持球', to: '射门未激活' }],
      note: '拿到球后自动挂上射门状态机（还没满足射门距离）',
    }),
    ev({
      name: '距离小', owner: 'player', trigger: '被动', basePriority: 2,
      condition: '与球门距离 ≤ 射门距离（持续检测：每次判定都看前提是否满足）',
      effects: [{ dimension: S, from: '射门未激活', to: '射门激活' }],
    }),
    ev({
      name: '距离大', owner: 'player', trigger: '被动',
      condition: '与球门距离 > 射门距离（退出射门前提）',
      effects: [{ dimension: S, from: '射门激活', to: '射门未激活' }],
    }),

    // ========== 球 · 被动（球只改自己的球路状态） ==========
    ev({
      name: '传出', owner: 'ball', trigger: '被动', listen: ['传球'], basePriority: 7,
      condition: '随机选定一名队友作为追踪目标',
      effects: [{ dimension: B, from: '球被持有', to: '传向队友' }],
      note: '球被动监听到「传球」的信号后，自己进入追踪状态（射门走另一条「飞向球门」）',
    }),
    ev({
      name: '球变自由', owner: 'ball', trigger: '被动', listen: ['掉球'], basePriority: 6,
      effects: [{ dimension: B, from: '球被持有', to: '自由球' }],
      note: '掉球后球直接成为自由球，朝球场中心滚动',
    }),
    ev({
      name: '球被拿', owner: 'ball', trigger: '被动', listen: ['拿球'], basePriority: 3,
      effects: [
        { dimension: B, from: '传向队友', to: '球被持有' },
        { dimension: B, from: '自由球', to: '球被持有' },
      ],
      note: '任一变化命中即被持有（在追踪中被断下 / 自由球被捡起），并吸附到拿球人脚下',
    }),
    ev({
      name: '飞向球门', owner: 'ball', trigger: '被动', listen: ['射门'], basePriority: 7,
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
      condition: '球飞抵球门：第 1、2 次拿球时计分',
      effects: [
        { dimension: G, from: '等待', to: '进1球' },
        { dimension: G, from: '进1球', to: '进2球' },
      ],
      note: '球门实体拿到球的计数推进',
    }),
    ev({
      name: '比赛结算', owner: 'goal', trigger: '被动', listen: ['射门'], basePriority: 9,
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
      [S]: '未持球',
      [W]: '本方-中',
      [D['姿态']]: '自由',
      [D['血量']]: '血量≥50',
      [B]: '自由球',
      [G]: '等待',
    },
    balance: { damage: 15, hpMax: 100, hpDropThreshold: 30, hpRegen: 5, displacement: 5 },
    createdAt: now,
    updatedAt: now,
  };
}
