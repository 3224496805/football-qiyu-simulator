// 优先级算法 v2（在事件库派生的总超图上计算）
//
// 每条事件的最终分 = 稳态权重 × 稳态概率分 + 路径权重 × 主循环路径分（短环内 × 惩罚系数）+ 手动权重 × 手动微调分
//   四个权重和短环惩罚、随机跳转概率都可以在优先级页顶部用滑杆实时调整（存在方案里，随导出携带）。
//   稳态概率分：把总超图当作状态转移系统做幂迭代（每条出边等概率 + 随机跳转防死角），
//              收敛后每个状态的"长期停留概率"，按最大值归一。长期越常停留的状态，其出边事件越重要。
//   主循环路径分：Tarjan 找环；主循环 = 成员最多的环。距主循环越近（0.6）+ 能到达的层越深（0.4），
//              主循环内的状态直接 = 1。鼓励"通往大循环的路上"的事件，抑制短死循环。
//   手动微调分：事件的"基础优先级" / 10，是给创作者的手动旋钮。
// 复合事件：填了同一个"复合组名"的跨实体事件（如角色的「拿球」+ 球的「球被拿」）
//   在排名里合并成一行，状态变化取全组的并集，手动微调取组内最高，分数按合并后的结果算。
import type { PriorityWeights, QiyuEvent, Scenario2 } from '@/types/model2';
import { DEFAULT_PRIORITY_WEIGHTS } from '@/types/model2';
import { buildTotalGraph } from './derive2';

export interface PriorityRow2 {
  eventId: string;
  name: string;
  trigger: '主动' | '被动' | '复合';  // 复合 = 复合事件里既有主动也有被动
  owner: string;
  members?: { id: string; name: string; owner: string; trigger: '主动' | '被动' }[]; // 复合事件的成员
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
  weights: PriorityWeights; // 本次计算实际用的权重（供界面回显）
}

const TAU = 4;          // 短环阈值：环成员 2~3 个算短环

export function computePriorities2(sc: Scenario2, w: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS): PriorityResult2 {
  const g = buildTotalGraph(sc);
  const keys = g.nodes.map((n) => n.key);
  const N = keys.length;
  if (N === 0) return { rows: [], mainLoop: [], smallCycles: [], iterations: 0, stateCount: 0, edgeCount: 0, weights: w };

  // 阻尼系数 = 1 − 随机跳转概率（跳转概率钳在 0~0.95，防止极端输入把迭代弄坏）
  const jump = Math.min(0.95, Math.max(0, w.jump));
  const DAMP = 1 - jump;

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

  // ---------- 事件评分（复合组先合并成一条"复合事件"再算分） ----------
  // 分组：有 group 的按组名聚，没填的各自一行
  const groups = new Map<string, QiyuEvent[]>();
  for (const ev of sc.events) {
    const key = ev.group?.trim() ? `g:${ev.group.trim()}` : `e:${ev.id}`;
    const arr = groups.get(key) ?? [];
    arr.push(ev);
    groups.set(key, arr);
  }

  const rows: PriorityRow2[] = [...groups.values()].map((members) => {
    const ev0 = members[0];
    const isComposite = members.length > 1 && !!ev0.group?.trim();
    const allEffects = members.flatMap((m) => m.effects);
    let best = 0;
    let bestFrom = '';
    let bestPenalized = false;
    let anchored = false; // 纯数值事件按前提锚点评分
    for (const f of allEffects) {
      if (!steadyOf.has(f.from)) continue;
      const penalized = smallSet.has(f.from) && smallSet.has(f.to);
      const raw = w.wSteady * steadyOf.get(f.from)! + w.wPath * pathOf(f.from);
      const v = penalized ? raw * w.penalty : raw;
      if (v > best || bestFrom === '') { best = v; bestFrom = f.from; bestPenalized = penalized; }
    }
    if (allEffects.length === 0) {
      // 纯数值事件（冲击/回血这类：只改数值、不改状态）在状态图上看不到边，
      // 改用它的「肯定前提」状态当锚点：前提出现在哪个状态，这条事件就在哪个状态有意义。
      // 纯数值事件不造成状态迁移，短环惩罚不适用。
      anchored = true;
      const anchors = new Set<string>();
      for (const m of members) for (const p of m.preStates) if (!p.not) anchors.add(p.state);
      for (const a of anchors) {
        if (!steadyOf.has(a)) continue;
        const v = w.wSteady * steadyOf.get(a)! + w.wPath * pathOf(a);
        if (v > best || bestFrom === '') { best = v; bestFrom = a; }
      }
    }
    const manual = Math.min(1, Math.max(...members.map((m) => m.basePriority)) / 10);
    const score = +(best + w.wManual * manual).toFixed(4);
    const steady = bestFrom ? +(steadyOf.get(bestFrom) ?? 0).toFixed(3) : 0;
    const path = bestFrom ? +pathOf(bestFrom).toFixed(3) : 0;
    const bits: string[] = [];
    if (isComposite) bits.push(`复合事件：${members.map((m) => `${m.name}（${m.owner === 'player' ? '角色' : m.owner === 'ball' ? '球' : '球门'}·${m.trigger}）`).join(' + ')}`);
    bits.push(bestFrom
      ? (anchored
        ? `纯数值事件，按前提锚点「${bestFrom}」的出现频率评分：稳态 ${(steady * w.wSteady).toFixed(3)} + 路径 ${(path * w.wPath).toFixed(3)}`
        : `主要靠源状态「${bestFrom}」：稳态 ${(steady * w.wSteady).toFixed(3)} + 路径 ${(path * w.wPath).toFixed(3)}`)
      : '没有状态变化也没有肯定前提，只有手动分');
    if (bestPenalized) bits.push(`在短环内，×${w.penalty} 惩罚`);
    bits.push(`手动微调 +${(w.wManual * manual).toFixed(3)}`);
    return {
      eventId: ev0.id, name: isComposite ? ev0.group!.trim() : ev0.name,
      trigger: isComposite ? '复合' : ev0.trigger,
      owner: isComposite ? 'multi' : ev0.owner,
      members: isComposite ? members.map((m) => ({ id: m.id, name: m.name, owner: m.owner, trigger: m.trigger })) : undefined,
      score, steady, path, penalized: bestPenalized, manual,
      bestFrom, inMainLoop: mainSet.has(bestFrom), rank: 0,
      explain: bits.join('；'),
    };
  });
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh'));
  rows.forEach((r, i) => { r.rank = i + 1; });

  return { rows, mainLoop, smallCycles, iterations, stateCount: N, edgeCount: g.edges.length, weights: w };
}
