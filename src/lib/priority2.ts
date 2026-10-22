// 优先级算法 v2（在事件库派生的总超图上计算）
//
// 每条事件的最终分 = 0.4 × 稳态概率分 + 0.3 × 主循环路径分（短环内 × 0.3 惩罚）+ 0.3 × 手动微调分
//   稳态概率分：把总超图当作状态转移系统做幂迭代（每条出边等概率 + 15% 随机跳跃防死角），
//              收敛后每个状态的"长期停留概率"，按最大值归一。长期越常停留的状态，其出边事件越重要。
//   主循环路径分：Tarjan 找环；主循环 = 成员最多的环。距主循环越近（0.6）+ 能到达的层越深（0.4），
//              主循环内的状态直接 = 1。鼓励"通往大循环的路上"的事件，抑制短死循环。
//   手动微调分：事件的"基础优先级" / 10，是给创作者的手动旋钮。
// 事件有多条状态变化时，取其中最高分的那条作为事件分。
import type { Scenario2 } from '@/types/model2';
import { buildTotalGraph } from './derive2';

export interface PriorityRow2 {
  eventId: string;
  name: string;
  trigger: '主动' | '被动';
  owner: string;
  score: number;        // 最终分
  steady: number;       // 稳态概率分（已按权重折算前的 0~1）
  path: number;         // 主循环路径分 0~1
  penalized: boolean;   // 是否被短环惩罚
  manual: number;       // 手动微调分 0~1
  bestFrom: string;     // 得分最高的那条变化的源状态
  inMainLoop: boolean;
  rank: number;
  explain: string;      // 一句话中文解释
}

export interface PriorityResult2 {
  rows: PriorityRow2[];
  mainLoop: string[];      // 主循环成员状态名
  smallCycles: string[][]; // 短环（成员状态名）
  iterations: number;      // 稳态迭代轮数
  stateCount: number;
  edgeCount: number;
}

const DAMP = 0.85;      // 阻尼系数（随机跳跃概率 15%）
const TAU = 4;          // 短环阈值：环成员 2~3 个算短环
const W_STEADY = 0.4;
const W_PATH = 0.3;
const W_MANUAL = 0.3;
const PENALTY = 0.3;

export function computePriorities2(sc: Scenario2): PriorityResult2 {
  const g = buildTotalGraph(sc);
  const keys = g.nodes.map((n) => n.key);
  const N = keys.length;
  if (N === 0) return { rows: [], mainLoop: [], smallCycles: [], iterations: 0, stateCount: 0, edgeCount: 0 };

  // ---------- 稳态分布（幂迭代） ----------
  const out = new Map<string, string[]>();
  for (const k of keys) out.set(k, []);
  for (const e of g.edges) if (out.has(e.from) && out.has(e.to)) out.get(e.from)!.push(e.to);

  let dist = new Map<string, number>();
  for (const k of keys) dist.set(k, 1 / N);
  let iterations = 0;
  for (let it = 0; it < 300; it++) {
    const next = new Map<string, number>();
    for (const k of keys) next.set(k, (1 - DAMP) / N);
    for (const k of keys) {
      const targets = out.get(k)!;
      const v = dist.get(k)! * DAMP;
      if (targets.length === 0) {
        for (const m of keys) next.set(m, next.get(m)! + v / N);
      } else {
        for (const t of targets) next.set(t, next.get(t)! + v / targets.length);
      }
    }
    let delta = 0;
    for (const k of keys) delta = Math.max(delta, Math.abs(next.get(k)! - dist.get(k)!));
    dist = next;
    iterations = it + 1;
    if (delta < 1e-9) break;
  }
  const maxP = Math.max(1e-12, ...dist.values());
  const steadyOf = new Map<string, number>();
  for (const k of keys) steadyOf.set(k, dist.get(k)! / maxP); // 归一到 0~1

  // ---------- Tarjan 找环 ----------
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;
  const strongconnect = (v: string) => {
    index.set(v, counter); low.set(v, counter); counter++;
    stack.push(v); onStack.add(v);
    for (const w of out.get(v)!) {
      if (!index.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w = '';
      do { w = stack.pop()!; onStack.delete(w); scc.push(w); } while (w !== v);
      sccs.push(scc);
    }
  };
  for (const k of keys) if (!index.has(k)) strongconnect(k);

  const mainLoop = sccs.length > 0 ? sccs.reduce((a, b) => (b.length > a.length ? b : a)) : [];
  const mainSet = new Set(mainLoop);
  const smallCycles = sccs.filter((s) => s.length >= 2 && s.length < TAU && s !== mainLoop);
  const smallSet = new Set(smallCycles.flat());

  // ---------- 路径分：距主循环（反向 BFS）0.6 + 可达深度（正向 BFS 层数）0.4 ----------
  const prev = new Map<string, string[]>();
  for (const k of keys) prev.set(k, []);
  for (const e of g.edges) if (prev.has(e.to) && out.has(e.from)) prev.get(e.to)!.push(e.from);

  const distToLoop = new Map<string, number>();
  const queue: string[] = [];
  for (const k of mainSet) { distToLoop.set(k, 0); queue.push(k); }
  while (queue.length) {
    const cur = queue.shift()!;
    for (const p of prev.get(cur)!) {
      if (!distToLoop.has(p)) { distToLoop.set(p, distToLoop.get(cur)! + 1); queue.push(p); }
    }
  }
  const diameter = Math.max(1, ...distToLoop.values());

  const reachDepthOf = new Map<string, number>();
  for (const k of keys) {
    const seen = new Set([k]);
    let frontier = [k];
    let depth = 0;
    while (frontier.length) {
      const nextF: string[] = [];
      for (const u of frontier) {
        for (const v of out.get(u)!) {
          if (!seen.has(v)) { seen.add(v); nextF.push(v); }
        }
      }
      frontier = nextF;
      if (frontier.length) depth++;
    }
    reachDepthOf.set(k, depth);
  }
  const maxDepth = Math.max(1, ...reachDepthOf.values());

  const pathOf = (k: string): number => {
    if (mainSet.has(k)) return 1;
    const d = distToLoop.get(k) ?? diameter;
    const near = 0.6 * (1 - d / diameter);
    const deep = 0.4 * (reachDepthOf.get(k)! / maxDepth);
    return Math.max(0, Math.min(1, near + deep));
  };

  // ---------- 事件评分 ----------
  const rows: PriorityRow2[] = sc.events.map((ev) => {
    let best = 0;
    let bestFrom = '';
    let bestPenalized = false;
    for (const f of ev.effects) {
      if (!steadyOf.has(f.from)) continue;
      const penalized = smallSet.has(f.from) && smallSet.has(f.to);
      const raw = W_STEADY * steadyOf.get(f.from)! + W_PATH * pathOf(f.from);
      const v = penalized ? raw * PENALTY : raw;
      if (v > best || bestFrom === '') { best = v; bestFrom = f.from; bestPenalized = penalized; }
    }
    const manual = Math.min(1, ev.basePriority / 10);
    const score = +(best + W_MANUAL * manual).toFixed(4);
    const steady = bestFrom ? +(steadyOf.get(bestFrom) ?? 0).toFixed(3) : 0;
    const path = bestFrom ? +pathOf(bestFrom).toFixed(3) : 0;
    const bits: string[] = [];
    bits.push(bestFrom
      ? `主要靠源状态「${bestFrom}」：稳态 ${(steady * W_STEADY).toFixed(3)} + 路径 ${(path * W_PATH).toFixed(3)}`
      : '没有状态变化，只有手动分');
    if (bestPenalized) bits.push('在短环内，×0.3 惩罚');
    bits.push(`手动微调 +${(W_MANUAL * manual).toFixed(3)}`);
    return {
      eventId: ev.id, name: ev.name, trigger: ev.trigger, owner: ev.owner,
      score, steady, path, penalized: bestPenalized, manual,
      bestFrom, inMainLoop: mainSet.has(bestFrom), rank: 0,
      explain: bits.join('；'),
    };
  });
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh'));
  rows.forEach((r, i) => { r.rank = i + 1; });

  return { rows, mainLoop, smallCycles, iterations, stateCount: N, edgeCount: g.edges.length };
}
