// 动态模拟引擎（二期）：100ms tick 事件队列 + 同刻冲突按权威优先级裁决 + 短环滞留检测
//
// 模型：
//   每个实体在每张逻辑图上各有一个当前状态；每 tick 每条主动边以小概率被「世界」触发
//   （概率 = 活跃度 × structWeight × 0.1，冷却期内不可触发；职业限定边只对该职业实体开放）。
//   被动边（trigger=passive）不参与随机：其监听的事件在该实体上执行后，于下一次判定加入队列，
//   直接参与竞争（跳过随机触发）；若入队后前提已失效（当前状态不在边的起点/冷却中/职业不符）则判定失效。
//   同一实体同一张图在同一 tick 触发多条边 = 同刻冲突，只执行权威排名最高的一条，其余计入抑制数。
import type { PriorityResult } from './priority';
import type { Scenario } from '@/types/model';

export interface EntityState {
  kind: 'player' | 'ball';
  name: string;
  professionId?: string;
  states: Record<string, string>; // graphId -> 状态名
}

export interface SimEvent {
  tick: number;
  entity: string;
  graphId: string;
  event: string;
  from: string;
  to: string;
  outcome: 'executed' | 'suppressed' | 'cooldown' | 'missed' | 'queued';
  reason?: string;
}

export interface SimStats {
  tick: number;
  fired: Record<string, number>;        // event -> 执行次数
  suppressed: Record<string, number>; // event -> 同刻冲突被抑制次数
  queued: Record<string, number>;       // event -> 被动触发入队次数
  cycleTrap: Record<string, number>;    // entity -> 连续处于短环内的 tick 数
  log: SimEvent[];
  contradiction: string[];              // 矛盾/死锁检测
}

export interface SimState {
  entities: EntityState[];
  stats: SimStats;
}

// 初始状态：按方案阵型摆位（两队分居两侧），其余图取 startState
export function initSim(sc: Scenario): SimState {
  const spotOf = (id: string) => sc.formation?.find((f) => f.id === id);
  const entities: EntityState[] = sc.players.map((p) => {
    const spot = spotOf(p.id);
    return {
      kind: 'player',
      name: p.name,
      professionId: p.professionId,
      states: {
        possession: sc.startState?.possession ?? '无球',
        holding: sc.startState?.holding ?? '射门未激活',
        position: spot ? `(${spot.col},${spot.row})` : (sc.startState?.position ?? '(2,4)'),
        control: sc.startState?.control ?? '自由',
        hp: sc.startState?.hp ?? '血量≥50',
      },
    };
  });
  entities.push({ kind: 'ball', name: '球', states: { ballTrack: sc.startState?.ballTrack ?? '自由球' } });
  return {
    entities,
    stats: { tick: 0, fired: {}, suppressed: {}, queued: {}, cycleTrap: {}, log: [], contradiction: [] },
  };
}

// 推进一个 tick；priorityByEdgeId 提供权威名次（名次越小越优先）
export function stepSim(
  sc: Scenario,
  result: PriorityResult,
  state: SimState,
  activity = 1,
  tau = 4,
): SimState {
  const tick = state.stats.tick + 1;
  const fired = { ...state.stats.fired };
  const suppressed = { ...state.stats.suppressed };
  const queued = { ...state.stats.queued };
  const cycleTrap = { ...state.stats.cycleTrap };
  const log: SimEvent[] = [];
  const contradiction: string[] = [];

  const rankOf = new Map<string, number>();
  for (const s of result.scores) rankOf.set(s.edge.id, s.rank);

  // 冷却表：edgeId -> 剩余 tick（跨实体独立冷却）
  const cds = (state as unknown as { __cds?: Record<string, number> }).__cds ?? {};

  // 被动触发待判定队列：`实体@图` -> edgeId[]（上一 tick 由监听事件入队，本 tick 判定后清空）
  const pendingAll = (state as unknown as { __pending?: Record<string, string[]> }).__pending ?? {};
  // 本 tick 新入队的 passive 边，统一在实体循环结束后合并（保证「下一次判定」）
  const newPending: Record<string, string[]> = {};

  const entities = state.entities.map((ent) => {
    const states = { ...ent.states };
    // 跨图状态前提：事件要求该实体在另一张图上处于/不处于某状态（条件的一部分）
    const preOk = (e: { preStates?: { graph: string; state: string; not?: boolean }[] }) =>
      !(e.preStates ?? []).some((p) => {
        const cur = states[p.graph];
        if (cur === undefined) return false; // 该实体无此图，前提视为满足
        return p.not ? cur === p.state : cur !== p.state;
      });
    for (const [gid, g] of Object.entries(sc.graphs)) {
      if (g.owner !== ent.kind) continue;
      const curName = states[gid];
      const cur = g.nodes.find((n) => n.name === curName);
      if (!cur) { contradiction.push(`${ent.name} 在「${g.name}」中处于未知状态「${curName}」`); continue; }
      // 候选出边：职业限定过滤 + 冷却过滤（冷却内的边不计入竞争，只记日志）
      const out = g.edges.filter((e) => e.from === cur.id);
      if (out.length === 0) {
        // 死锁检测：无出边的非终止状态
        contradiction.push(`${ent.name}「${g.name}·${curName}」无可用事件（死锁）`);
        continue;
      }
      const eligible = out.filter((e) => {
        if (e.trigger === 'passive') return false; // 被动边不走随机触发
        if (!preOk(e)) return false; // 跨图状态前提
        if (e.professionIds && ent.professionId && !e.professionIds.includes(ent.professionId)) return false;
        return (cds[e.id] ?? 0) <= 0;
      });
      for (const e of out) {
        if ((cds[e.id] ?? 0) > 0) cds[e.id] = cds[e.id] - 1;
      }
      // 每边独立小概率触发
      const triggered = eligible.filter(() => Math.random() < Math.min(0.9, activity * 0.12));

      // 被动队列判定：入队边直接参与竞争；前提已失效的记 missed
      const pkey = `${ent.name}@${gid}`;
      const queuedIds = pendingAll[pkey] ?? [];
      delete pendingAll[pkey];
      for (const qid of queuedIds) {
        const qe = g.edges.find((e) => e.id === qid);
        if (!qe) continue;
        const toNm = g.nodes.find((n) => n.id === qe.to)?.name ?? '?';
        const profOk = !(qe.professionIds && ent.professionId && !qe.professionIds.includes(ent.professionId));
        if (qe.from !== cur.id) {
          log.push({ tick, entity: ent.name, graphId: gid, event: qe.event, from: curName, to: toNm, outcome: 'missed', reason: '被动入队后前提已失效（当前状态不在事件起点）' });
        } else if (!preOk(qe)) {
          log.push({ tick, entity: ent.name, graphId: gid, event: qe.event, from: curName, to: toNm, outcome: 'missed', reason: '被动入队后跨图状态前提不符' });
        } else if (!profOk) {
          log.push({ tick, entity: ent.name, graphId: gid, event: qe.event, from: curName, to: toNm, outcome: 'missed', reason: '被动入队后职业前提不符' });
        } else if ((cds[qe.id] ?? 0) > 0) {
          log.push({ tick, entity: ent.name, graphId: gid, event: qe.event, from: curName, to: toNm, outcome: 'missed', reason: '被动入队后处于冷却' });
        } else {
          triggered.push(qe);
        }
      }

      if (triggered.length === 0) continue;
      // 同刻冲突：按权威排名裁决
      triggered.sort((a, b) => (rankOf.get(a.id) ?? 9999) - (rankOf.get(b.id) ?? 9999));
      const win = triggered[0];
      const toNode = g.nodes.find((n) => n.id === win.to);
      if (!toNode) continue;
      states[gid] = toNode.name;
      if (win.params.cooldown > 0) cds[win.id] = win.params.cooldown;
      fired[win.event] = (fired[win.event] ?? 0) + 1;
      log.push({ tick, entity: ent.name, graphId: gid, event: win.event, from: curName, to: toNode.name, outcome: 'executed' });
      for (const lose of triggered.slice(1)) {
        suppressed[lose.event] = (suppressed[lose.event] ?? 0) + 1;
        log.push({ tick, entity: ent.name, graphId: gid, event: lose.event, from: curName, to: g.nodes.find((n) => n.id === lose.to)?.name ?? '?', outcome: 'suppressed', reason: `同刻冲突输给「${win.event}」（权威名次 #${rankOf.get(win.id)}）` });
      }
      // 级联：该实体上监听本事件的 passive 边入队，于下一次判定参与竞争
      for (const [gid2, g2] of Object.entries(sc.graphs)) {
        if (g2.owner !== ent.kind) continue;
        for (const e2 of g2.edges) {
          if (e2.trigger !== 'passive' || !e2.listenEvents?.includes(win.event)) continue;
          const k = `${ent.name}@${gid2}`;
          if (!newPending[k]) newPending[k] = [];
          if (!newPending[k].includes(e2.id)) {
            newPending[k].push(e2.id);
            queued[e2.event] = (queued[e2.event] ?? 0) + 1;
          }
        }
      }
    }
    return { ...ent, states };
  });

  // 短环滞留检测：实体在任一图内连续 K tick 于少于 tau 个状态间打转
  const prevStates = (state as unknown as { __hist?: Record<string, string[]> }).__hist ?? {};
  const hist: Record<string, string[]> = {};
  for (const ent of entities) {
    for (const [gid, nm] of Object.entries(ent.states)) {
      const key = `${ent.name}@${gid}`;
      const h = [...(prevStates[key] ?? []), nm].slice(-(tau + 1));
      hist[key] = h;
      const uniq = new Set(h);
      if (h.length >= tau && uniq.size < tau) {
        cycleTrap[ent.name] = (cycleTrap[ent.name] ?? 0) + 1;
        if (cycleTrap[ent.name] === 50) {
          contradiction.push(`${ent.name} 在「${sc.graphs[gid]?.name}」短状态集 {${[...uniq].join('、')}} 内滞留 50+ tick（短死循环嫌疑）`);
        }
      } else {
        cycleTrap[ent.name] = 0;
      }
    }
  }

  const next: SimState = {
    entities,
    stats: {
      tick,
      fired,
      suppressed,
      queued,
      cycleTrap,
      log: [...state.stats.log, ...log].slice(-300),
      contradiction: [...state.stats.contradiction, ...contradiction].slice(-100),
    },
  };
  (next as unknown as { __cds?: Record<string, number> }).__cds = cds;
  (next as unknown as { __hist?: Record<string, string[]> }).__hist = hist;
  // 合并本 tick 新入队的被动事件（下一 tick 判定）
  (next as unknown as { __pending?: Record<string, string[]> }).__pending = { ...pendingAll, ...newPending };
  return next;
}
