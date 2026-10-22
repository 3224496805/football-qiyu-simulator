// 动态模拟器 v2：直接跑事件库（不再跑图）
// 规则：
//   每个实体（6 名角色 + 球 + 球门）各自持有"属于自己维度"的当前状态，初值 = 方案的起始状态
//   每 tick：
//     1. 反应阶段：上一拍事件引发的监听类被动事件先结算（球被拿、飞向球门等）
//     2. 主动阶段：每名角色有小概率执行一条主动事件（按基础优先级加权随机；
//        前提 = 状态变化里至少一条"从状态"命中 + 全部状态前提满足；文字前提不判定，仅提示；
//        前提涉及其他实体状态的抢占类事件每拍同名限一次，如「拿球」）
//     3. 检测阶段：无监听的持续检测被动事件每拍检查一次；
//        监听了本拍执行事件的被动事件进入"下一拍"队列（无同拍无限级联）
//   每实体每维度每 tick 最多改一次状态；同维度多条变化命中时随机挑一条（如移动选方向）；
//   带"蓄能"数值的事件进入蓄力锁：锁定维度若干拍（约 蓄能值/40 拍），期间主动/检测事件不可取消；冷却按事件记录
//   数值效果：扣血/回血/蓄能作用在自己身上；"作用于对方"则随机挑一名对方角色
// 事件日志全程记录：谁在什么时候执行了什么、状态怎么变
import type { EntityKind, QiyuEvent, Scenario2 } from '@/types/model2';

export interface SimEntity {
  id: string;
  name: string;
  kind: EntityKind;
  team?: 'A' | 'B';
  professionId?: string;
  states: Record<string, string>; // 维度 id -> 当前状态
  hp: number;
  charge: number;
  chargeLock?: { dim: string; until: number } | null; // 蓄力中：锁定该维度直到指定拍（蓄力不可取消）
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
  over: boolean; // 球门进入结算 = 比赛结束
}

const ACTIVE_PROB = 0.35; // 每名角色每拍主动出手概率
const LOG_CAP = 300;

function pickWeighted<T>(items: T[], weight: (t: T) => number): T | null {
  const ws = items.map((t) => Math.max(0.01, weight(t)));
  const sum = ws.reduce((a, b) => a + b, 0);
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1] ?? null;
}

export function initSim2(sc: Scenario2): SimState {
  const entities: SimEntity[] = [];
  const startOf = (owner: EntityKind) => {
    const out: Record<string, string> = {};
    for (const d of sc.dimensions.filter((x) => x.owner === owner)) {
      out[d.id] = sc.startState[d.id] ?? d.states[0] ?? '';
    }
    return out;
  };
  for (const p of sc.players) {
    entities.push({
      id: p.id, name: p.name, kind: 'player', team: p.team, professionId: p.professionId,
      states: startOf('player'), hp: sc.balance.hpMax, charge: 0, chargeLock: null,
    });
  }
  entities.push({ id: 'ball', name: '球', kind: 'ball', states: startOf('ball'), hp: 0, charge: 0, chargeLock: null });
  entities.push({ id: 'goal', name: '球门', kind: 'goal', states: startOf('goal'), hp: 0, charge: 0, chargeLock: null });
  return { tick: 0, entities, pending: [], cooldowns: {}, log: [], over: false };
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

function applyEvent(sc: Scenario2, st: SimState, ev: QiyuEvent, ent: SimEntity, fired: Set<string>, changed: Set<string>, logs: SimLog[]) {
  // 命中的状态变化：同一维度若有多条"从状态"命中（如「移动」从一个区域可去多个方向），随机挑一条
  const byDim = new Map<string, QiyuEvent['effects']>();
  for (const f of ev.effects) {
    const dim = sc.dimensions.find((d) => d.id === f.dimension);
    if (!dim || dim.owner !== ent.kind) continue;
    if (ent.states[f.dimension] !== f.from) continue;
    if (changed.has(`${ent.id}:${f.dimension}`)) continue;
    const arr = byDim.get(f.dimension) ?? [];
    arr.push(f);
    byDim.set(f.dimension, arr);
  }
  const hits = [...byDim.values()].map((arr) => arr[Math.floor(Math.random() * arr.length)]);
  if (hits.length === 0 && ev.effects.length > 0) return false;
  for (const f of hits) {
    ent.states[f.dimension] = f.to;
    changed.add(`${ent.id}:${f.dimension}`);
  }
  // 数值效果
  const target = ev.affectsOthers
    ? (() => {
        const foes = st.entities.filter((e) => e.kind === 'player' && e.team !== ent.team);
        return foes[Math.floor(Math.random() * foes.length)] ?? ent;
      })()
    : ent;
  const numBits: string[] = [];
  let justLocked = false; // 本事件刚设下的蓄力锁，不能被下面的"离开状态即解除"当场清掉
  for (const n of ev.numeric) {
    if (n.kind === '扣血') { target.hp = Math.max(0, target.hp - n.value); numBits.push(`${target.name} 扣血 ${n.value}（现 ${target.hp}）`); }
    if (n.kind === '回血') { target.hp = Math.min(sc.balance.hpMax, target.hp + n.value); numBits.push(`${target.name} 回血 ${n.value}（现 ${target.hp}）`); }
    if (n.kind === '蓄能') {
      // 蓄力类事件：进入蓄力状态后锁定该维度若干拍（约 value/40 拍，100 ≈ 3 拍），期间不可取消
      const ticks = Math.max(1, Math.round(n.value / 40));
      const dim = ev.effects[0]?.dimension;
      if (dim) { ent.chargeLock = { dim, until: st.tick + ticks }; justLocked = true; }
      ent.charge = n.value;
      numBits.push(`蓄力中（约 ${ticks} 拍后出脚）`);
    }
    if (n.kind === '位移') numBits.push(`位移 ${n.value}m（坐标暂不模拟）`);
  }
  // 状态变化发生后，若蓄力锁定的维度被其他事件改变（例如「打断」），解除蓄力锁
  if (!justLocked && ent.chargeLock && hits.some((f) => f.dimension === ent.chargeLock?.dim)) ent.chargeLock = null;
  const stateBits = hits.map((f) => `${sc.dimensions.find((d) => d.id === f.dimension)?.name ?? ''} ${f.from}→${f.to}`);
  logs.push({
    tick: st.tick,
    text: `${ent.name} ${ev.trigger === '主动' ? '主动执行' : '被动触发'}「${ev.name}」${stateBits.length ? '：' + stateBits.join('；') : ''}${numBits.length ? '｜' + numBits.join('；') : ''}`,
  });
  fired.add(ev.name);
  if (ev.cooldown > 0) st.cooldowns[`${ent.id}:${ev.id}`] = ev.cooldown;
  if (ent.kind === 'goal') {
    const gdim = sc.dimensions.find((d) => d.owner === 'goal');
    if (gdim && ent.states[gdim.id] === '结算') st.over = true;
  }
  return true;
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
  };
  const fired = new Set<string>();
  const changed = new Set<string>(); // `${实体}:${维度}` 每 tick 只改一次
  const claimed = new Set<string>(); // 抢占类主动事件（前提涉及其他实体状态，如拿球）每拍同名限一次
  const offCd = (ev: QiyuEvent, ent: SimEntity) => (st.cooldowns[`${ent.id}:${ev.id}`] ?? 0) <= 0;
  // 蓄力锁：锁定期间，主动事件和持续检测事件不得改动被锁维度；监听类被动（如「打断」）不受限
  const lockBlocks = (ev: QiyuEvent, ent: SimEntity, phase: 'active' | 'listen' | 'detect') =>
    phase !== 'listen' && !!ent.chargeLock && st.tick < ent.chargeLock.until &&
    ev.effects.some((f) => f.dimension === ent.chargeLock?.dim);
  const canFire = (ev: QiyuEvent, ent: SimEntity, phase: 'active' | 'listen' | 'detect') =>
    offCd(ev, ent) &&
    !lockBlocks(ev, ent, phase) &&
    ev.effects.some((f) => ent.states[f.dimension] === f.from && !changed.has(`${ent.id}:${f.dimension}`)) &&
    preStatesOk(sc, ev, ent, st.entities);

  // 1. 被动阶段 A：上一拍排队的监听反应（先结算上一拍的反应，再处理本拍新动作——
  //    例如「拿球」后球在下一拍开始时就已"被持有"，别人本拍无法再抢）
  for (const job of prev.pending) {
    const ev = sc.events.find((e) => e.id === job.eventId);
    const ent = st.entities.find((e) => e.id === job.entityId);
    if (ev && ent && canFire(ev, ent, 'listen')) applyEvent(sc, st, ev, ent, fired, changed, st.log);
  }

  // 2. 主动阶段：角色按基础优先级加权随机
  const players = [...st.entities.filter((e) => e.kind === 'player')].sort(() => Math.random() - 0.5);
  for (const p of players) {
    if (Math.random() > ACTIVE_PROB) continue;
    const cands = sc.events.filter((ev) =>
      ev.trigger === '主动' && ev.owner === 'player' &&
      (ev.professions.length === 0 || ev.professions.includes(p.professionId ?? '')) &&
      !claimed.has(ev.name) &&
      canFire(ev, p, 'active'));
    const picked = pickWeighted(cands, (ev) => ev.basePriority);
    if (picked && applyEvent(sc, st, picked, p, fired, changed, st.log)) {
      // 前提涉及其他实体状态的主动事件（抢占资源，如拿球）：同一拍内同名只发一次
      if (picked.preStates.some((pr) => sc.dimensions.find((d) => d.id === pr.dimension)?.owner !== picked.owner)) {
        claimed.add(picked.name);
      }
    }
  }

  // 3. 被动阶段 B：持续检测（无监听）事件
  for (const ev of sc.events.filter((e) => e.trigger === '被动' && e.listen.length === 0)) {
    const holders = st.entities.filter((e) => e.kind === ev.owner);
    const ok = holders.filter((h) => canFire(ev, h, 'detect'));
    // 角色类持续检测每拍最多挑一个，避免全员同帧齐跳；球/球门只有一个实体
    const chosen = ev.owner === 'player' && ok.length > 1 ? [ok[Math.floor(Math.random() * ok.length)]] : ok;
    for (const h of chosen) applyEvent(sc, st, ev, h, fired, changed, st.log);
  }

  // 4. 汇总下一拍队列：监听了本拍执行事件的被动事件
  for (const ev of sc.events) {
    if (ev.trigger !== '被动' || ev.listen.length === 0) continue;
    if (!ev.listen.some((l) => fired.has(l))) continue;
    for (const h of st.entities.filter((e) => e.kind === ev.owner)) {
      st.pending.push({ entityId: h.id, eventId: ev.id });
    }
  }

  // 日志封顶
  if (st.log.length > LOG_CAP) st.log = st.log.slice(-LOG_CAP);
  if (st.entities.some((e) => e.kind === 'goal' && Object.values(e.states).includes('结算'))) st.over = true;
  return st;
}
