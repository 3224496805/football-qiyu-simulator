// 动态模拟器 v3：直接跑事件库 + 真实格子坐标（9×9 格）
//
// 坐标层：
//   每个实体都有格子坐标 (cx,cy)；区域状态 = 坐标所在的 3×3 区域
//   ——坐标变、区域不变时不产生逻辑事件（同一区域内移动只是底层坐标变化）
//   球门固定在对方区域正中 (8,4)；球开局在中心 (4,4)；角色开局在「本方-中」区域列队
//
// 本模拟器对事件"文字条件"的真实判定（按事件名约定，改名字前先改这里）：
//   「拿球」：与球距离 ≤ 2 格              「冲击」：与持球的对家距离 ≤ 攻击距离参数
//   「距离小」：与球门距离 ≤ 射门距离参数    「距离大」：与球门距离 > 射门距离参数
//   「回血」：血量未满才触发                「缓过来」：进入受控满「受控持续参数」拍
//   血量维度的状态变化按真实血量数值判定（转到「血量<50」需血量数值 < 50，转到「血量≥50」需 ≥ 50）
//
// 位置类事件（带「位移」数值效果的）按坐标执行：
//   方向从第一条位置变化的区域差推出（前进=+x 等），距离 = 位移数值 ÷ 12（默认 1 格）；
//   「冲击」这类"作用于对方"的位移 = 冲到目标所在格（动态位移，图上看不到固定位置边）
//
// 简单人机（规则式，不是机器学习）：
//   自己持球 → 朝球门走，进射门距离就蓄力；球没人拿 → 追球，够得着就拿；
//   对家持球 → 追持球者，进攻击距离就冲击；队友持球 → 朝球门侧跟进。少量随机探索避免死板。
//
// 每 tick：1. 上一拍监听反应先结算 2. 主动阶段（人机按打分选事件）3. 持续检测
//   每实体每维度每拍最多改一次；同维度多条命中随机挑一条；
//   蓄力锁 = 带「蓄能」数值的事件锁定该维度约 数值/40 拍，期间主动/检测事件不可取消（监听类如「打断」可破）；
//   受控是限时状态：进入「受控」时记下拍号，满「受控持续参数」拍后被动事件「缓过来」自动恢复自由；
//   前提涉及其他实体状态的抢占类主动事件每拍同名限一次（拿球/冲击）；冷却按事件记录
import type { EntityKind, QiyuEvent, Scenario2 } from '@/types/model2';
import { ZONE_X, ZONE_Y, zoneName } from '@/lib/defaultScenario2';

export interface SimEntity {
  id: string;
  name: string;
  kind: EntityKind;
  team?: 'A' | 'B';
  professionId?: string;
  states: Record<string, string>; // 维度 id -> 当前状态
  hp: number;
  charge: number;
  chargeLock?: { dim: string; until: number } | null; // 蓄力中：锁定该维度直到指定拍
  controlledSince?: number | null; // 进入「受控」状态的拍号（受控是限时状态，到期自动恢复）；null = 不在受控中
  cx: number; // 格子坐标（0..8）
  cy: number;
  homeY?: number; // 开局站位行（人机跑位的"车道"，避免全员挤一路）
}

export interface SimLog {
  tick: number;
  text: string;
}

export interface SimState {
  tick: number;
  entities: SimEntity[];
  pending: { entityId: string; eventId: string }[]; // 下一拍判定的被动队列
  cooldowns: Record<string, number>;                // `${实体}:${事件}` -> 剩余 tick
  log: SimLog[];
  over: boolean;          // 球门进入结算 = 比赛结束
  ballTargetId: string | null; // 传球时选定的追踪目标
}

const GRID = 9;                 // 9×9 格
const CENTER = { x: 4, y: 4 };  // 球场中心
const PICKUP_RANGE = 2;         // 拿球距离（格）
const LOG_CAP = 300;

const cheb = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const clampCell = (v: number) => Math.max(0, Math.min(GRID - 1, v));
const zoneOfCell = (cx: number, cy: number) => zoneName(Math.floor(cx / 3), Math.floor(cy / 3));
const dimIdOf = (sc: Scenario2, name: string) => sc.dimensions.find((d) => d.name === name)?.id;

// 区域名（如「本方-中」）反解成区域坐标；解析不了（用户改过名）就返回 null
const parseZone = (name: string): [number, number] | null => {
  const [a, b] = name.split('-');
  const zx = (ZONE_X as readonly string[]).indexOf(a);
  const zy = (ZONE_Y as readonly string[]).indexOf(b);
  return zx >= 0 && zy >= 0 ? [zx, zy] : null;
};

// 开局阵型：双方都在「本方-中」区域（x 0..2, y 3..5）里列队
const FORMATION: Record<'A' | 'B', [number, number][]> = {
  A: [[0, 3], [0, 4], [0, 5]],
  B: [[2, 3], [2, 4], [2, 5]],
};

export function initSim2(sc: Scenario2): SimState {
  const entities: SimEntity[] = [];
  const startOf = (owner: EntityKind) => {
    const out: Record<string, string> = {};
    for (const d of sc.dimensions.filter((x) => x.owner === owner)) {
      out[d.id] = sc.startState[d.id] ?? d.states[0] ?? '';
    }
    return out;
  };
  const count: Record<string, number> = { A: 0, B: 0 };
  for (const p of sc.players) {
    const form = FORMATION[p.team][count[p.team] % FORMATION[p.team].length];
    count[p.team]++;
    entities.push({
      id: p.id, name: p.name, kind: 'player', team: p.team, professionId: p.professionId,
      states: startOf('player'), hp: sc.balance.hpMax, charge: 0, chargeLock: null, controlledSince: null,
      cx: form[0], cy: form[1], homeY: form[1],
    });
  }
  entities.push({ id: 'ball', name: '球', kind: 'ball', states: startOf('ball'), hp: 0, charge: 0, chargeLock: null, controlledSince: null, cx: CENTER.x, cy: CENTER.y });
  entities.push({ id: 'goal', name: '球门', kind: 'goal', states: startOf('goal'), hp: 0, charge: 0, chargeLock: null, controlledSince: null, cx: 8, cy: 4 });
  return { tick: 0, entities, pending: [], cooldowns: {}, log: [], over: false, ballTargetId: null };
}

// 前提是否满足：状态前提按归属实体检查（角色的维度查该角色，球的维度查球，球门的维度查球门）
function preStatesOk(sc: Scenario2, ev: QiyuEvent, self: SimEntity, all: SimEntity[]): boolean {
  const find = (dimId: string): SimEntity | undefined => {
    const dim = sc.dimensions.find((d) => d.id === dimId);
    if (!dim) return undefined;
    if (dim.owner === self.kind) return self;
    return all.find((e) => e.kind === dim.owner);
  };
  return ev.preStates.every((p) => {
    const holder = find(p.dimension);
    if (!holder) return false;
    const cur = holder.states[p.dimension];
    return p.not ? cur !== p.state : cur === p.state;
  });
}

// 血量维度的门槛：状态变化按真实血量数值判定
function hpGateOk(sc: Scenario2, ent: SimEntity, f: QiyuEvent['effects'][number]): boolean {
  const d = sc.dimensions.find((x) => x.id === f.dimension);
  if (d?.name !== '血量') return true;
  if (f.to.includes('<50')) return ent.hp < 50;
  if (f.to.includes('≥50')) return ent.hp >= 50;
  return true;
}

// 文字条件的真实判定（按事件名约定）
function simGate(sc: Scenario2, st: SimState, ev: QiyuEvent, ent: SimEntity): boolean {
  const ball = st.entities.find((e) => e.kind === 'ball');
  const goal = st.entities.find((e) => e.kind === 'goal');
  const pid = dimIdOf(sc, '球权');
  const holder = pid ? st.entities.find((e) => e.kind === 'player' && e.states[pid] === '持球') : undefined;
  switch (ev.name) {
    case '拿球':
      return !!ball && cheb(ent.cx, ent.cy, ball.cx, ball.cy) <= PICKUP_RANGE;
    case '冲击':
      return !!holder && holder.team !== ent.team && cheb(ent.cx, ent.cy, holder.cx, holder.cy) <= sc.balance.attackRange;
    case '距离小':
      return !!goal && cheb(ent.cx, ent.cy, goal.cx, goal.cy) <= sc.balance.shootRange;
    case '距离大':
      return !!goal && cheb(ent.cx, ent.cy, goal.cx, goal.cy) > sc.balance.shootRange;
    case '滚向中心':
      // 球已经在中心就不再空滚（避免日志每拍刷屏）
      return ent.cx !== CENTER.x || ent.cy !== CENTER.y;
    case '回血':
      // 血满了就不再触发（避免日志每拍空刷"回血 10（现 100）"）
      return ent.hp < sc.balance.hpMax;
    case '缓过来': {
      // 受控是限时状态：进入受控满「受控持续参数」拍后才允许恢复自由。
      // 没记录进入拍号（比如手动摆的局面）就从当前拍开始计时。
      if (ent.controlledSince == null) { ent.controlledSince = st.tick; return false; }
      return st.tick - ent.controlledSince >= sc.balance.controlTicks;
    }
    case '追踪队友': {
      // 追踪目标已贴身就不再空走（等「拿球」接管）
      const t = st.entities.find((e) => e.id === st.ballTargetId);
      return !!t && (ent.cx !== t.cx || ent.cy !== t.cy);
    }
    default:
      return true;
  }
}

// 位置类事件（带位移数值）：坐标移动 + 区域状态同步
function applyMove(sc: Scenario2, ev: QiyuEvent, ent: SimEntity, target: SimEntity | null, all: SimEntity[], changed: Set<string>, numBits: string[], stateBits: string[]) {
  const posDim = sc.dimensions.find((d) => d.name === '位置' && d.owner === 'player');
  if (!posDim) return;
  const occupied = (x: number, y: number) => all.some((o) => o.kind === 'player' && o.id !== ent.id && o.cx === x && o.cy === y);
  if (ev.affectsOthers && target) {
    // 冲击类动态位移：冲到目标所在格（允许贴身，是技能效果）
    ent.cx = target.cx;
    ent.cy = target.cy;
    numBits.push(`冲到 ${target.name} 所在格（${ent.cx},${ent.cy}）`);
  } else {
    // 方向从第一条位置变化的区域差推出；距离 = 位移数值 ÷ 12（1 格 = 12m）
    const f0 = ev.effects.find((f) => f.dimension === posDim.id);
    const zf = f0 ? parseZone(f0.from) : null;
    const zt = f0 ? parseZone(f0.to) : null;
    const dx = zf && zt ? Math.sign(zt[0] - zf[0]) : 0;
    const dy = zf && zt ? Math.sign(zt[1] - zf[1]) : 0;
    const step = Math.max(1, Math.round((ev.numeric.find((n) => n.kind === '位移')?.value ?? 12) / 12));
    // 一格一格走：前方格子有人就停下（简单的"人不能叠人"规则）
    let moved = 0;
    for (let i = 0; i < step; i++) {
      const nx = clampCell(ent.cx + dx);
      const ny = clampCell(ent.cy + dy);
      if ((nx === ent.cx && ny === ent.cy) || occupied(nx, ny)) break;
      ent.cx = nx;
      ent.cy = ny;
      moved++;
    }
    numBits.push(moved > 0 ? `（格 ${ent.cx},${ent.cy}）` : `（前方有人，原地不动）`);
  }
  // 区域状态同步：跨过区域边界才产生逻辑状态变化
  const newZone = zoneOfCell(ent.cx, ent.cy);
  const cur = ent.states[posDim.id];
  if (cur !== newZone && !changed.has(`${ent.id}:${posDim.id}`)) {
    ent.states[posDim.id] = newZone;
    changed.add(`${ent.id}:${posDim.id}`);
    stateBits.push(`位置 ${cur}→${newZone}`);
  }
}

function applyEvent(sc: Scenario2, st: SimState, ev: QiyuEvent, ent: SimEntity, firedBy: Map<string, Set<string>>, changed: Set<string>, logs: SimLog[]) {
  // 「作用于对方」的目标：前提里引用了球的「球被持有」→ 目标锁定持球的对家；否则随机一名对家
  let target: SimEntity | null = null;
  if (ev.affectsOthers) {
    const pid = dimIdOf(sc, '球权');
    const wantHolder = ev.preStates.some((p) => {
      const d = sc.dimensions.find((x) => x.id === p.dimension);
      return d?.owner === 'ball' && p.state === '球被持有' && !p.not;
    });
    target = (wantHolder && pid
      ? st.entities.find((e) => e.kind === 'player' && e.team !== ent.team && e.states[pid] === '持球')
      : null) ?? (() => {
        const foes = st.entities.filter((e) => e.kind === 'player' && e.team !== ent.team);
        return foes[Math.floor(Math.random() * foes.length)] ?? null;
      })();
    if (!target) return false;
  }

  // 位置类事件（带位移数值）不按"从状态命中"判定：移动总是可执行，状态变化由坐标同步产生
  const posDim = sc.dimensions.find((d) => d.name === '位置' && d.owner === 'player');
  const moveLike = ev.numeric.some((n) => n.kind === '位移') &&
    (ev.affectsOthers || (!!posDim && ev.effects.some((f) => f.dimension === posDim.id)));

  // 命中的状态变化：同一维度若有多条"从状态"命中（如区域内多个去向），随机挑一条；血量维度过数值门槛
  const byDim = new Map<string, QiyuEvent['effects']>();
  for (const f of ev.effects) {
    const dim = sc.dimensions.find((d) => d.id === f.dimension);
    if (!dim || dim.owner !== ent.kind) continue;
    if (moveLike && posDim && f.dimension === posDim.id) continue; // 位置变化交给坐标同步
    if (ent.states[f.dimension] !== f.from) continue;
    if (changed.has(`${ent.id}:${f.dimension}`)) continue;
    if (!hpGateOk(sc, ent, f)) continue;
    const arr = byDim.get(f.dimension) ?? [];
    arr.push(f);
    byDim.set(f.dimension, arr);
  }
  const hits = [...byDim.values()].map((arr) => arr[Math.floor(Math.random() * arr.length)]);
  if (!moveLike && hits.length === 0 && ev.effects.length > 0) return false;

  const stateBits: string[] = [];
  for (const f of hits) {
    ent.states[f.dimension] = f.to;
    changed.add(`${ent.id}:${f.dimension}`);
    stateBits.push(`${sc.dimensions.find((d) => d.id === f.dimension)?.name ?? ''} ${f.from}→${f.to}`);
    // 受控是限时状态：进入时记下拍号（开始倒计时），离开时清除
    const dimName = sc.dimensions.find((d) => d.id === f.dimension)?.name;
    if (dimName === '姿态') {
      if (f.to === '受控') ent.controlledSince = st.tick;
      if (f.from === '受控') ent.controlledSince = null;
    }
  }

  // 数值效果 + 坐标移动
  const numBits: string[] = [];
  let justLocked = false; // 本事件刚设下的蓄力锁，不能被下面的"离开状态即解除"当场清掉
  if (moveLike) applyMove(sc, ev, ent, target, st.entities, changed, numBits, stateBits);
  for (const n of ev.numeric) {
    if (n.kind === '扣血' && target) { target.hp = Math.max(0, target.hp - n.value); numBits.push(`${target.name} 扣血 ${n.value}（现 ${target.hp}）`); }
    if (n.kind === '回血') { ent.hp = Math.min(sc.balance.hpMax, ent.hp + n.value); numBits.push(`${ent.name} 回血 ${n.value}（现 ${ent.hp}）`); }
    if (n.kind === '蓄能') {
      // 蓄力类事件：进入蓄力状态后锁定该维度若干拍（约 value/40 拍，100 ≈ 3 拍），期间不可取消
      const ticks = Math.max(1, Math.round(n.value / 40));
      const dim = ev.effects[0]?.dimension;
      if (dim) { ent.chargeLock = { dim, until: st.tick + ticks }; justLocked = true; }
      ent.charge = n.value;
      numBits.push(`蓄力中（约 ${ticks} 拍后出脚）`);
    }
  }
  // 状态变化发生后，若蓄力锁定的维度被其他事件改变（例如「打断」），解除蓄力锁（位置移动不算）
  if (!justLocked && ent.chargeLock && hits.some((f) => f.dimension === ent.chargeLock?.dim)) ent.chargeLock = null;

  logs.push({
    tick: st.tick,
    text: `${ent.name} ${ev.trigger === '主动' ? '主动执行' : '被动触发'}「${ev.name}」${stateBits.length ? '：' + stateBits.join('；') : ''}${numBits.length ? (stateBits.length ? '｜' : '：') + numBits.join('；') : ''}`,
  });
  // 记录"谁触发了这条事件"：监听排队时，同种实体之间的监听只通知当事人
  const ids = firedBy.get(ev.name) ?? new Set<string>();
  ids.add(ent.id);
  firedBy.set(ev.name, ids);
  if (ev.cooldown > 0) st.cooldowns[`${ent.id}:${ev.id}`] = ev.cooldown;
  if (ent.kind === 'goal') {
    const gdim = sc.dimensions.find((d) => d.owner === 'goal');
    if (gdim && ent.states[gdim.id] === '结算') st.over = true;
  }

  // 球的坐标同步（球路状态变化后的位置解释）
  if (ent.kind === 'ball') {
    const goal = st.entities.find((e) => e.kind === 'goal');
    const pid = dimIdOf(sc, '球权');
    const holder = pid ? st.entities.find((e) => e.kind === 'player' && e.states[pid] === '持球') : undefined;
    const step1 = (tx: number, ty: number) => {
      ent.cx = clampCell(ent.cx + Math.sign(tx - ent.cx));
      ent.cy = clampCell(ent.cy + Math.sign(ty - ent.cy));
    };
    if (ev.name === '追踪队友') {
      const t = st.entities.find((e) => e.id === st.ballTargetId);
      if (t) step1(t.cx, t.cy);
    }
    if (ev.name === '滚向中心') step1(CENTER.x, CENTER.y);
    if (ev.name === '飞向球门' && goal) { ent.cx = goal.cx; ent.cy = goal.cy; }
    if (ev.name === '重新开出') { ent.cx = CENTER.x; ent.cy = CENTER.y; st.ballTargetId = null; }
    if (ev.name === '球被拿' && holder) { ent.cx = holder.cx; ent.cy = holder.cy; }
  }
  return true;
}

// 简单人机打分：从候选主动事件里挑一个（返回 null = 本拍不动）
function botPick(sc: Scenario2, st: SimState, p: SimEntity, cands: QiyuEvent[]): QiyuEvent | null {
  const pid = dimIdOf(sc, '球权');
  const sid = dimIdOf(sc, '射门');
  const ball = st.entities.find((e) => e.kind === 'ball')!;
  const goal = st.entities.find((e) => e.kind === 'goal')!;
  const holder = pid ? st.entities.find((e) => e.kind === 'player' && e.states[pid] === '持球') : undefined;
  const selfHold = !!pid && p.states[pid] === '持球';

  // 目标点：持球→球门；球没人拿→球；对家持球→持球者；队友持球→不挤球门，回自己的车道接应
  let tx = ball.cx, ty = ball.cy;
  if (selfHold) { tx = goal.cx; ty = goal.cy; }
  else if (holder && holder.team !== p.team) { tx = holder.cx; ty = holder.cy; }
  else if (holder && holder.team === p.team) { tx = 6; ty = p.homeY ?? CENTER.y; } // 前场本车道接应
  const d0 = cheb(p.cx, p.cy, tx, ty);

  const DIRS: Record<string, [number, number]> = { 前进: [1, 0], 后退: [-1, 0], 左移: [0, -1], 右移: [0, 1] };
  let best: QiyuEvent | null = null;
  let bestScore = 0.01;
  for (const ev of cands) {
    let s = 0;
    const dir = DIRS[ev.name];
    if (dir) {
      const d1 = cheb(p.cx + dir[0], p.cy + dir[1], tx, ty);
      s = (d0 - d1) * 2 + Math.random() * 0.3;
    } else if (ev.name === '冲刺') {
      const d1 = cheb(p.cx + 3, p.cy, tx, ty);
      s = (d0 - d1) * 2 + Math.random() * 0.3;
    } else if (ev.name === '拿球') s = 100;
    else if (ev.name === '冲击') s = 90;
    else if (ev.name === '蓄力') s = sid && p.states[sid] === '射门激活' ? 80 : 0;
    else if (ev.name === '传球') s = selfHold && cheb(p.cx, p.cy, goal.cx, goal.cy) > sc.balance.shootRange + 1 ? 0.8 + Math.random() * 2 : 0.2;
    else s = 1;
    if (s > bestScore) { bestScore = s; best = ev; }
  }
  // 少量随机探索，避免人机行为死板
  if (Math.random() < 0.06 && cands.length > 0) return cands[Math.floor(Math.random() * cands.length)];
  return best;
}

export function stepSim2(sc: Scenario2, prev: SimState): SimState {
  if (prev.over) return prev;
  const st: SimState = {
    tick: prev.tick + 1,
    entities: prev.entities.map((e) => ({ ...e, states: { ...e.states } })),
    pending: [],
    cooldowns: Object.fromEntries(Object.entries(prev.cooldowns).map(([k, v]) => [k, Math.max(0, v - 1)])),
    log: [...prev.log],
    over: false,
    ballTargetId: prev.ballTargetId,
  };
  const firedBy = new Map<string, Set<string>>(); // 事件名 -> 本拍触发过它的实体 id 集合
  const changed = new Set<string>(); // `${实体}:${维度}` 每 tick 只改一次
  const claimed = new Set<string>(); // 抢占类主动事件（前提涉及其他实体状态，如拿球/冲击）每拍同名限一次
  const offCd = (ev: QiyuEvent, ent: SimEntity) => (st.cooldowns[`${ent.id}:${ev.id}`] ?? 0) <= 0;
  // 蓄力锁：锁定期间，主动事件和持续检测事件不得改动被锁维度；监听类被动（如「打断」）不受限
  const lockBlocks = (ev: QiyuEvent, ent: SimEntity, phase: 'active' | 'listen' | 'detect') =>
    phase !== 'listen' && !!ent.chargeLock && st.tick < ent.chargeLock.until &&
    ev.effects.some((f) => f.dimension === ent.chargeLock?.dim);
  const moveLike = (ev: QiyuEvent) => {
    if (!ev.numeric.some((n) => n.kind === '位移')) return false;
    if (ev.affectsOthers) return true;
    const posDim = sc.dimensions.find((d) => d.name === '位置' && d.owner === 'player');
    return !!posDim && ev.effects.some((f) => f.dimension === posDim.id);
  };
  const canFire = (ev: QiyuEvent, ent: SimEntity, phase: 'active' | 'listen' | 'detect') =>
    offCd(ev, ent) &&
    !lockBlocks(ev, ent, phase) &&
    (moveLike(ev) ||
      ev.effects.some((f) => ent.states[f.dimension] === f.from && !changed.has(`${ent.id}:${f.dimension}`) && hpGateOk(sc, ent, f)) ||
      // 纯数值事件（没有状态变化，只有数值效果，如「回血」）：没有可命中的变化也算"有事可做"
      (ev.effects.length === 0 && ev.numeric.length > 0)) &&
    preStatesOk(sc, ev, ent, st.entities) &&
    simGate(sc, st, ev, ent);

  // 1. 被动阶段 A：上一拍排队的监听反应（先结算上一拍的反应，再处理本拍新动作——
  //    例如「拿球」后球在下一拍开始时就已"被持有"，别人本拍无法再抢）
  for (const job of prev.pending) {
    const ev = sc.events.find((e) => e.id === job.eventId);
    const ent = st.entities.find((e) => e.id === job.entityId);
    if (ev && ent && canFire(ev, ent, 'listen')) applyEvent(sc, st, ev, ent, firedBy, changed, st.log);
  }

  // 2. 主动阶段：简单人机按打分选事件
  //    蓄力中的角色不能行动（蓄力不可取消；蓄力锁到期的那一拍由被动「射门」出脚，而不是恢复自由行动）
  const shootDim = dimIdOf(sc, '射门');
  const isCharging = (p: SimEntity) => (shootDim ? p.states[shootDim] === '蓄力' : !!p.chargeLock);
  const players = [...st.entities.filter((e) => e.kind === 'player')].sort(() => Math.random() - 0.5);
  for (const p of players) {
    if (isCharging(p)) continue;
    const cands = sc.events.filter((ev) =>
      ev.trigger === '主动' && ev.owner === 'player' &&
      (ev.professions.length === 0 || ev.professions.includes(p.professionId ?? '')) &&
      !claimed.has(ev.name) &&
      canFire(ev, p, 'active'));
    if (cands.length === 0) continue;
    const picked = botPick(sc, st, p, cands);
    if (picked && applyEvent(sc, st, picked, p, firedBy, changed, st.log)) {
      // 传球时选定一名队友作为球的追踪目标
      if (picked.name === '传球') {
        const mates = st.entities.filter((e) => e.kind === 'player' && e.team === p.team && e.id !== p.id);
        st.ballTargetId = mates.length > 0 ? mates[Math.floor(Math.random() * mates.length)].id : null;
      }
      // 前提涉及其他实体状态的主动事件（抢占资源，如拿球/冲击）：同一拍内同名只发一次
      if (picked.preStates.some((pr) => sc.dimensions.find((d) => d.id === pr.dimension)?.owner !== picked.owner)) {
        claimed.add(picked.name);
      }
    }
  }

  // 3. 被动阶段 B：持续检测（无监听）事件
  for (const ev of sc.events.filter((e) => e.trigger === '被动' && e.listen.length === 0)) {
    for (const h of st.entities.filter((e) => e.kind === ev.owner)) {
      if (canFire(ev, h, 'detect')) applyEvent(sc, st, ev, h, firedBy, changed, st.log);
    }
  }

  // 球被持有时，球贴着持球者走
  const ballEnt = st.entities.find((e) => e.kind === 'ball');
  const pid = dimIdOf(sc, '球权');
  const bdim = dimIdOf(sc, '球路');
  const holderEnt = pid ? st.entities.find((e) => e.kind === 'player' && e.states[pid] === '持球') : undefined;
  if (ballEnt && holderEnt && bdim && ballEnt.states[bdim] === '球被持有') {
    ballEnt.cx = holderEnt.cx;
    ballEnt.cy = holderEnt.cy;
  }

  // 4. 汇总下一拍队列：监听了本拍执行事件的被动事件
  //    同种实体之间的监听（如角色听「受击」）只通知当事人自己；跨实体监听（球听「掉球」、球门听「射门」）照常广播
  for (const ev of sc.events) {
    if (ev.trigger !== '被动' || ev.listen.length === 0) continue;
    const listened = ev.listen.filter((l) => firedBy.has(l));
    if (listened.length === 0) continue;
    for (const h of st.entities.filter((e) => e.kind === ev.owner)) {
      const involved = listened.some((l) => {
        const src = sc.events.find((e) => e.name === l);
        // 来源事件和自己同属一种实体 → 只有当事人能收到；跨实体 → 都收到
        return src && src.owner === ev.owner ? firedBy.get(l)!.has(h.id) : true;
      });
      if (involved) st.pending.push({ entityId: h.id, eventId: ev.id });
    }
  }

  // 日志封顶
  if (st.log.length > LOG_CAP) st.log = st.log.slice(-LOG_CAP);
  if (st.entities.some((e) => e.kind === 'goal' && Object.values(e.states).includes('结算'))) st.over = true;
  return st;
}
