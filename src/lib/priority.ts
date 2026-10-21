// 核心算法：总超图构建（粘合/复合）+ BFS + 主循环识别 + 优先级评分
import type { DomainEdge, DomainId, Scenario } from '@/types/model';
import { defaultOrderIndex, DOMAIN_NAMES } from '@/types/model';

export interface MergedNode {
  id: string;          // 粘合后的节点 id（同名状态合并）
  name: string;        // 状态名
  domains: DomainId[]; // 来源逻辑域
  layers?: number[];   // BFS 出现的层（可能有多个）
}

export interface TotalEdge extends DomainEdge {
  fromName: string;
  toName: string;
  domain: DomainId;
}

export interface TotalGraph {
  nodes: MergedNode[];
  edges: TotalEdge[];
  gluedPairs: string[]; // 粘合说明（"持球@球逻辑 ~ 持球@控制逻辑"）
}

// ---------- 1. 总超图构建：跨域同名状态粘合（glue） ----------
export function buildTotalGraph(sc: Scenario): TotalGraph {
  const byName = new Map<string, MergedNode>();
  const edges: TotalEdge[] = [];
  const gluedPairs: string[] = [];

  for (const domain of Object.keys(sc.graphs) as DomainId[]) {
    const g = sc.graphs[domain];
    for (const n of g.nodes) {
      const exist = byName.get(n.name);
      if (exist) {
        if (!exist.domains.includes(domain)) {
          exist.domains.push(domain);
          gluedPairs.push(`${n.name} @${g.name}`);
        }
      } else {
        byName.set(n.name, { id: `n_${n.name}`, name: n.name, domains: [domain] });
      }
    }
    for (const e of g.edges) {
      const from = g.nodes.find((n) => n.id === e.from);
      const to = g.nodes.find((n) => n.id === e.to);
      if (!from || !to) continue;
      edges.push({ ...e, from: `n_${from.name}`, to: `n_${to.name}`, fromName: from.name, toName: to.name, domain });
    }
  }
  return { nodes: [...byName.values()], edges, gluedPairs };
}

// ---------- 2. BFS（起点 = 无球） ----------
export interface BfsResult {
  layerOf: Map<string, number>;       // 节点最早层
  layersOfEdge: Map<string, number[]>; // 事件出现的层数集合（同一事件可在多分支/多层）
  unreachable: string[];              // 从无球不可达的状态
}

export function bfsFromFree(total: TotalGraph, startName = '无球'): BfsResult {
  const start = total.nodes.find((n) => n.name === startName) ?? total.nodes[0];
  const layerOf = new Map<string, number>();
  const layersOfEdge = new Map<string, number[]>();
  const visited = new Set<string>();
  const queue: string[] = [start.id];
  layerOf.set(start.id, 0);
  visited.add(start.id);

  // 事件名归并：同名事件跨分支/多层出现
  const pushEdge = (event: string, layer: number) => {
    const arr = layersOfEdge.get(event) ?? [];
    if (!arr.includes(layer)) arr.push(layer);
    layersOfEdge.set(event, arr);
  };

  while (queue.length) {
    const cur = queue.shift()!;
    const layer = layerOf.get(cur)!;
    for (const e of total.edges) {
      if (e.from !== cur) continue;
      pushEdge(e.event, layer + 1);
      if (!visited.has(e.to)) {
        visited.add(e.to);
        layerOf.set(e.to, layer + 1);
        queue.push(e.to);
      }
    }
  }
  const unreachable = total.nodes.filter((n) => !visited.has(n.id)).map((n) => n.name);
  return { layerOf, layersOfEdge, unreachable };
}

// ---------- 3. 主循环识别（Tarjan SCC） ----------
export interface CycleInfo {
  mainCycle: string[];        // 主大循环节点名
  shortCycles: string[][];    // 短环（长度 < tau）
  sccOf: Map<string, number>; // 节点 -> SCC 编号
  sccs: string[][];           // 所有 SCC（节点名）
}

export function findCycles(total: TotalGraph, tau = 4): CycleInfo {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccOf = new Map<string, number>();
  const sccs: string[][] = [];
  let counter = 0;

  const adj = new Map<string, string[]>();
  for (const n of total.nodes) adj.set(n.id, []);
  for (const e of total.edges) adj.get(e.from)!.push(e.to);

  const strongconnect = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj.get(v)!) {
      if (!index.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  };
  for (const n of total.nodes) if (!index.has(n.id)) strongconnect(n.id);

  const named = sccs.map((s) => s.map((id) => total.nodes.find((n) => n.id === id)?.name ?? id));
  // 主循环 = 节点数最多的 SCC（平局取含 BFS 最深层节点的）
  const sizeRank = [...named.keys()].sort((a, b) => named[b].length - named[a].length);
  const mainIdx = sizeRank[0] ?? -1;
  const shortCycles = named.filter((s) => s.length >= 2 && s.length < tau);
  for (let i = 0; i < sccs.length; i++) for (const id of sccs[i]) sccOf.set(id, i);
  return { mainCycle: mainIdx >= 0 ? named[mainIdx] : [], shortCycles, sccOf, sccs: named };
}

// ---------- 4. 优先级评分（修正语义：通往主循环路上的事件高分，短环惩罚） ----------
export interface EdgeScore {
  edge: TotalEdge;
  layers: number[];      // BFS 层数集合
  pathScore: number;     // 通往主循环路径分 0~1
  cyclePenalty: number;  // 短环惩罚
  structWeight: number;
  manualScore: number;   // 手动优先级归一分
  finalScore: number;
  rank: number;          // 全局名次（跨逻辑域合并排序）
  inMainCycle: boolean;
  inShortCycle: boolean;
}

export interface DomainResult {
  domain: DomainId;
  scores: EdgeScore[];   // 域内排序
  bfs: BfsResult;
  cycles: CycleInfo;
  diameter: number;
}

export interface PriorityResult {
  scores: EdgeScore[];                 // 全部逻辑域合并后的总排名
  byDomain: Record<DomainId, DomainResult>;
  alpha: number;
}

// 单图分析（BFS → 主循环 → 评分）
function analyzeGraph(total: TotalGraph, alpha: number, tau: number, domain: DomainId): DomainResult {
  const bfs = bfsFromFree(total);
  const cycles = findCycles(total, tau);

  // dist(node, 主循环)：反向 BFS
  const dist = new Map<string, number>();
  const mainIds = new Set<string>();
  for (const name of cycles.mainCycle) {
    const node = total.nodes.find((n) => n.name === name);
    if (node) { mainIds.add(node.id); dist.set(node.id, 0); }
  }
  const prev = new Map<string, string[]>();
  for (const n of total.nodes) prev.set(n.id, []);
  for (const e of total.edges) prev.get(e.to)!.push(e.from);
  const q = [...mainIds];
  while (q.length) {
    const cur = q.shift()!;
    for (const p of prev.get(cur)!) {
      if (!dist.has(p)) { dist.set(p, dist.get(cur)! + 1); q.push(p); }
    }
  }
  const diameter = Math.max(1, ...[...dist.values()]);

  const shortSccIds = new Set<number>();
  for (let i = 0; i < cycles.sccs.length; i++) {
    if (cycles.sccs[i].length >= 2 && cycles.sccs[i].length < tau) shortSccIds.add(i);
  }

  const scores: EdgeScore[] = total.edges.map((edge) => {
    const layers = bfs.layersOfEdge.get(edge.event) ?? [];
    const d = Math.min(dist.get(edge.from) ?? diameter, dist.get(edge.to) ?? diameter);
    const inMain = mainIds.has(edge.from) && mainIds.has(edge.to);
    const inShort = shortSccIds.has(cycles.sccOf.get(edge.from) ?? -1) &&
      (cycles.sccOf.get(edge.from) === cycles.sccOf.get(edge.to));
    const pathScore = inMain ? 1 : Math.max(0, 1 - d / diameter);
    const cyclePenalty = inShort ? 0.3 : 1;
    const structWeight = edge.params.structWeight;
    const manualScore = edge.params.basePriority / 10;
    const finalScore = +(pathScore * cyclePenalty * structWeight + alpha * manualScore).toFixed(4);
    return { edge, layers, pathScore: +pathScore.toFixed(3), cyclePenalty, structWeight, manualScore: +manualScore.toFixed(3), finalScore, rank: 0, inMainCycle: inMain, inShortCycle: inShort };
  });

  scores.sort((a, b) =>
    b.finalScore - a.finalScore ||
    b.edge.params.basePriority - a.edge.params.basePriority ||
    defaultOrderIndex(a.edge.event) - defaultOrderIndex(b.edge.event) ||
    a.edge.event.localeCompare(b.edge.event, 'zh'));

  return { domain, scores, bfs, cycles, diameter };
}

// 域图 → TotalGraph 结构（复合 = 各逻辑域独立叠加，分别 BFS）
function buildDomainTotal(g: Scenario['graphs'][DomainId]): TotalGraph {
  const nodes: MergedNode[] = g.nodes.map((n) => ({ id: `n_${n.name}`, name: n.name, domains: [g.domain] }));
  const edges: TotalEdge[] = g.edges
    .filter((e) => g.nodes.some((n) => n.id === e.from) && g.nodes.some((n) => n.id === e.to))
    .map((e) => ({
      ...e,
      from: `n_${g.nodes.find((n) => n.id === e.from)!.name}`,
      to: `n_${g.nodes.find((n) => n.id === e.to)!.name}`,
      fromName: g.nodes.find((n) => n.id === e.from)!.name,
      toName: g.nodes.find((n) => n.id === e.to)!.name,
      domain: g.domain,
    }));
  return { nodes, edges, gluedPairs: [] };
}

export function computePriorities(sc: Scenario, alpha = 0.5, tau = 4): PriorityResult {
  // 复合语义：球/位置/控制/血量各逻辑域互不影响，每域独立 BFS（起点=无球，无无球则从首节点）
  const byDomain = {} as Record<DomainId, DomainResult>;
  for (const domain of Object.keys(sc.graphs) as DomainId[]) {
    byDomain[domain] = analyzeGraph(buildDomainTotal(sc.graphs[domain]), alpha, tau, domain);
  }

  // 合并全部事件，全局排名（冲突裁决依据）
  const merged = Object.values(byDomain).flatMap((d) => d.scores);
  merged.sort((a, b) =>
    b.finalScore - a.finalScore ||
    b.edge.params.basePriority - a.edge.params.basePriority ||
    defaultOrderIndex(a.edge.event) - defaultOrderIndex(b.edge.event) ||
    a.edge.event.localeCompare(b.edge.event, 'zh'));
  merged.forEach((s, i) => { s.rank = i + 1; });

  return { scores: merged, byDomain, alpha };
}

// ---------- 5. 参数调整建议 ----------
export interface Suggestion {
  target: string;        // 事件/参数描述
  kind: '短环破除' | '流量引导' | '参数平衡';
  advice: string;
  expect: string;
}

export function suggest(sc: Scenario, result: PriorityResult): Suggestion[] {
  const out: Suggestion[] = [];

  // 短环破除：对短环内事件提高冷却/降低结构权重
  for (const d of Object.values(result.byDomain)) {
    for (const cyc of d.cycles.shortCycles) {
      const evs = new Set<string>();
      for (const e of d.scores) {
        if (cyc.includes(e.edge.fromName) && cyc.includes(e.edge.toName)) evs.add(e.edge.event);
      }
      for (const ev of evs) {
        out.push({
          target: `事件「${ev}」（${DOMAIN_NAMES[d.domain]}短环 ${cyc.join('→')} 内）`,
          kind: '短环破除',
          advice: `建议提高该事件 cooldown +2 tick，或将其 structWeight 降至 0.5 以下`,
          expect: '降低陷入短死循环的概率，把状态流量赶入主大循环',
        });
      }
    }
  }

  // 流量引导：主循环上优先级偏低的事件
  for (const d of Object.values(result.byDomain)) {
    for (const s of d.scores) {
      if (s.inMainCycle && s.finalScore < 0.5) {
        out.push({
          target: `事件「${s.edge.event}」（${DOMAIN_NAMES[d.domain]}主循环内但优先级偏低）`,
          kind: '流量引导',
          advice: `建议将 basePriority 提高 1~2 档（当前 ${s.edge.params.basePriority}）`,
          expect: '主循环内事件执行更稳定，全局状态停留在大循环中',
        });
      }
    }
  }

  // 参数平衡：结合全局平衡参数
  const b = sc.balance;
  for (const s of result.scores) {
    if (s.edge.skillKind === 'damage') {
      out.push({
        target: `伤害事件「${s.edge.event}」`,
        kind: '参数平衡',
        advice: `当前全局伤害基准 ${b.damage}、血量上限 ${b.hpMax}、掉球阈值 ${b.hpDropThreshold}；若要减少掉球频率，可降低伤害基准或提高掉球阈值`,
        expect: '掉球事件触发频率下降，持球状态更稳定',
      });
    }
    if (s.edge.skillKind === 'displacement') {
      out.push({
        target: `位移事件「${s.edge.event}」`,
        kind: '参数平衡',
        advice: `当前位移基准 ${b.displacement}；位移距离影响位置逻辑图的流转速度，过大会缩短位置状态停留时间`,
        expect: '位置状态图节奏与球逻辑图更同步',
      });
    }
  }

  // 去重（target+kind）
  const seen = new Set<string>();
  return out.filter((s) => { const k = s.target + s.kind; if (seen.has(k)) return false; seen.add(k); return true; });
}
