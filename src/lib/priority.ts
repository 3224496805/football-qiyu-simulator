// 核心算法：总超图构建（粘合/复合）+ DFS 有向搜索树 + 主循环识别 + 优先级评分
//
// 优先级语义（用户定稿）：
//   DFS 从起点（无球）生成有向搜索树；一个事件在搜索树的不同分支上可以处于不同层深。
//   目标 = 尽量避免状态陷入短死循环、让全局状态处于大的主循环中。
//   因此不是"层深大就优先"，而是"在通往深层/主循环路上的事件"优先：
//     路径分 = 距主循环越近越高（0.6 权重） + 子树能到达的层深越深越高（0.4 权重）
//   短环（<tau）内事件 ×0.3 惩罚；再叠加 α·手动分；同分按默认序（传>掉>射>蓄力更新>拿>激活>关闭）。
import type { DomainEdge, DomainId, Scenario } from '@/types/model';
import { defaultOrderIndex, DOMAIN_NAMES } from '@/types/model';

export interface MergedNode {
  id: string;          // 粘合后的节点 id（同名状态合并）
  name: string;        // 状态名
  domains: DomainId[]; // 来源逻辑域
  depths?: number[];   // DFS 首次访问层深（可能有多个来源域）
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

// ---------- 2. DFS 有向搜索树（起点 = 无球） ----------
export interface DfsResult {
  rootId: string;                        // 起点节点 id
  depthOf: Map<string, number>;          // 节点首次访问的 DFS 树层深
  parentOf: Map<string, string>;         // DFS 树父节点 id
  treeEdgeOf: Map<string, string>;       // 节点 -> 到达它的树边 id
  depthsOfEdge: Map<string, number[]>;   // 事件名 -> 出现过的层深集合（同一事件可多层）
  treeEdgeIds: Set<string>;              // 树边
  backEdgeIds: Set<string>;              // 回边（指向栈上祖先 = 成环证据）
  maxDepth: number;                      // 树的最大层深
  unreachable: string[];                 // 从起点不可达的状态
  visitOrder: string[];                  // 节点首次访问顺序
}

export function dfsFromFree(total: TotalGraph, startName = '无球'): DfsResult {
  const start = total.nodes.find((n) => n.name === startName) ?? total.nodes[0];
  const depthOf = new Map<string, number>();
  const parentOf = new Map<string, string>();
  const treeEdgeOf = new Map<string, string>();
  const depthsOfEdge = new Map<string, number[]>();
  const treeEdgeIds = new Set<string>();
  const backEdgeIds = new Set<string>();
  const visitOrder: string[] = [];

  const pushDepth = (event: string, d: number) => {
    const arr = depthsOfEdge.get(event) ?? [];
    if (!arr.includes(d)) arr.push(d);
    depthsOfEdge.set(event, arr);
  };

  // 邻接表（按事件名排序，保证 DFS 顺序确定、可复现）
  const adj = new Map<string, TotalEdge[]>();
  for (const n of total.nodes) adj.set(n.id, []);
  for (const e of total.edges) adj.get(e.from)!.push(e);
  for (const list of adj.values()) {
    list.sort((a, b) => a.event.localeCompare(b.event, 'zh') || a.toName.localeCompare(b.toName, 'zh'));
  }

  // 显式栈迭代 DFS（栈上集合用于识别回边）
  interface Frame { node: string; depth: number; iter: number }
  const onStack = new Set<string>();
  const stack: Frame[] = [{ node: start.id, depth: 0, iter: 0 }];
  depthOf.set(start.id, 0);
  onStack.add(start.id);
  visitOrder.push(start.id);

  while (stack.length) {
    const frame = stack[stack.length - 1];
    const list = adj.get(frame.node)!;
    if (frame.iter >= list.length) {
      onStack.delete(frame.node);
      stack.pop();
      continue;
    }
    const e = list[frame.iter++];
    pushDepth(e.event, frame.depth + 1);
    if (!depthOf.has(e.to)) {
      // 树边：首次访问
      depthOf.set(e.to, frame.depth + 1);
      parentOf.set(e.to, frame.node);
      treeEdgeOf.set(e.to, e.id);
      treeEdgeIds.add(e.id);
      visitOrder.push(e.to);
      onStack.add(e.to);
      stack.push({ node: e.to, depth: frame.depth + 1, iter: 0 });
    } else if (onStack.has(e.to)) {
      backEdgeIds.add(e.id); // 回边 → 环
    }
    // 其余为前向边/横边（指向已访问且不在栈上的节点），不参与树结构
  }

  const maxDepth = Math.max(0, ...[...depthOf.values()]);
  const unreachable = total.nodes.filter((n) => !depthOf.has(n.id)).map((n) => n.name);
  return { rootId: start.id, depthOf, parentOf, treeEdgeOf, depthsOfEdge, treeEdgeIds, backEdgeIds, maxDepth, unreachable, visitOrder };
}

// ---------- 3. 主循环识别（Tarjan SCC） ----------
export interface CycleInfo {
  mainCycle: string[];        // 主大循环节点名
  shortCycles: string[][];    // 短环（长度 < tau）
  sccOf: Map<string, number>; // 节点 -> SCC 编号
  sccs: string[][];           // 所有 SCC（节点名）
}

export function findCycles(total: TotalGraph, tau = 4, depthOf?: Map<string, number>): CycleInfo {
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
  // 主循环 = 节点数最多的 SCC（平局取 DFS 层深更深的）
  const depthRank = [...named.keys()].sort((a, b) => {
    if (named[b].length !== named[a].length) return named[b].length - named[a].length;
    const maxD = (idx: number) => Math.max(0, ...sccs[idx].map((id) => depthOf?.get(id) ?? 0));
    return maxD(b) - maxD(a);
  });
  const mainIdx = depthRank[0] ?? -1;
  const shortCycles = named.filter((s) => s.length >= 2 && s.length < tau);
  for (let i = 0; i < sccs.length; i++) for (const id of sccs[i]) sccOf.set(id, i);
  return { mainCycle: mainIdx >= 0 ? named[mainIdx] : [], shortCycles, sccOf, sccs: named };
}

// ---------- 4. 优先级评分（通往深层/主循环路上的事件高分，短环惩罚） ----------
export interface EdgeScore {
  edge: TotalEdge;
  depths: number[];      // DFS 搜索树中出现过的层深集合
  depthScore: number;    // 子树可达层深得分 0~1（越深越高）
  pathScore: number;     // 路径分 0~1（距主循环 + 子树深度合成）
  cyclePenalty: number;  // 短环惩罚
  structWeight: number;
  manualScore: number;   // 手动优先级归一分
  finalScore: number;
  rank: number;          // 全局名次（跨逻辑域合并排序）
  inMainCycle: boolean;
  inShortCycle: boolean;
  isBackEdge: boolean;   // 回边（成环边）
}

export interface DomainResult {
  domain: DomainId;
  scores: EdgeScore[];   // 域内排序
  dfs: DfsResult;
  cycles: CycleInfo;
  diameter: number;      // 距主循环的最远半径
  subtreeDepthOf: Map<string, number>; // 节点 DFS 子树可达最大层深
}

export interface PriorityResult {
  scores: EdgeScore[];                 // 全部逻辑域合并后的总排名
  byDomain: Record<DomainId, DomainResult>;
  alpha: number;
}

// 单图分析（DFS 搜索树 → 主循环 → 评分）
function analyzeGraph(total: TotalGraph, alpha: number, tau: number, domain: DomainId): DomainResult {
  const dfs = dfsFromFree(total);
  const cycles = findCycles(total, tau, dfs.depthOf);

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

  // 子树可达最大层深：按 DFS 访问逆序递推
  const subtreeDepthOf = new Map<string, number>();
  for (const id of dfs.visitOrder) subtreeDepthOf.set(id, dfs.depthOf.get(id)!);
  for (let i = dfs.visitOrder.length - 1; i >= 0; i--) {
    const id = dfs.visitOrder[i];
    const parent = dfs.parentOf.get(id);
    if (parent !== undefined) {
      subtreeDepthOf.set(parent, Math.max(subtreeDepthOf.get(parent)!, subtreeDepthOf.get(id)!));
    }
  }

  const shortSccIds = new Set<number>();
  for (let i = 0; i < cycles.sccs.length; i++) {
    if (cycles.sccs[i].length >= 2 && cycles.sccs[i].length < tau) shortSccIds.add(i);
  }

  const scores: EdgeScore[] = total.edges.map((edge) => {
    const depths = dfs.depthsOfEdge.get(edge.event) ?? [];
    const d = Math.min(dist.get(edge.from) ?? diameter, dist.get(edge.to) ?? diameter);
    const inMain = mainIds.has(edge.from) && mainIds.has(edge.to);
    const inShort = shortSccIds.has(cycles.sccOf.get(edge.from) ?? -1) &&
      (cycles.sccOf.get(edge.from) === cycles.sccOf.get(edge.to));
    const subDepth = subtreeDepthOf.get(edge.from) ?? dfs.depthOf.get(edge.from) ?? 0;
    const depthScore = dfs.maxDepth > 0 ? +(subDepth / dfs.maxDepth).toFixed(3) : 0;
    // 路径分：距主循环越近越高（0.6） + 子树可达层深越深越高（0.4）；主循环内 = 1
    const pathScore = inMain ? 1 : +Math.max(0, Math.min(1, 0.6 * (1 - d / diameter) + 0.4 * depthScore)).toFixed(3);
    const cyclePenalty = inShort ? 0.3 : 1;
    const structWeight = edge.params.structWeight;
    const manualScore = edge.params.basePriority / 10;
    const finalScore = +(pathScore * cyclePenalty * structWeight + alpha * manualScore).toFixed(4);
    const isBackEdge = dfs.backEdgeIds.has(edge.id);
    return { edge, depths, depthScore, pathScore, cyclePenalty, structWeight, manualScore: +manualScore.toFixed(3), finalScore, rank: 0, inMainCycle: inMain, inShortCycle: inShort, isBackEdge };
  });

  scores.sort((a, b) =>
    b.finalScore - a.finalScore ||
    b.edge.params.basePriority - a.edge.params.basePriority ||
    defaultOrderIndex(a.edge.event) - defaultOrderIndex(b.edge.event) ||
    a.edge.event.localeCompare(b.edge.event, 'zh'));

  return { domain, scores, dfs, cycles, diameter, subtreeDepthOf };
}

// 域图 → TotalGraph 结构（复合 = 各逻辑域独立叠加，分别 DFS）
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
  // 复合语义：球/位置/控制/血量各逻辑域互不影响，每域独立 DFS（起点=无球，无无球则从首节点）
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
  const byEvent = new Map<string, EdgeScore>();
  for (const s of result.scores) if (!byEvent.has(s.edge.event)) byEvent.set(s.edge.event, s);

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

// ---------- 6. 复合（compose：图替换式叠加，非笛卡尔积的显示） ----------
// 语义：把替换图 B 的副本嵌入宿主图 A 的每个状态点，A 的边保持连接各副本。
// 复合状态 = (A 状态, B 状态)，两图互不影响。
export interface CompositePlan {
  host: DomainId;
  guest: DomainId;
  hostNodeCount: number;
  guestNodeCount: number;
  guestEdgeCount: number;
  compositeNodeCount: number; // |V_A| × |V_B|
  compositeEdgeCount: number; // A 边 × |V_B| + |V_A| × B 边
}

export function compositeStats(sc: Scenario, host: DomainId, guest: DomainId): CompositePlan {
  const A = sc.graphs[host];
  const B = sc.graphs[guest];
  const aN = A.nodes.length, bN = B.nodes.length, bE = B.edges.length;
  const aE = A.edges.length;
  return {
    host, guest,
    hostNodeCount: aN,
    guestNodeCount: bN,
    guestEdgeCount: bE,
    compositeNodeCount: aN * bN,
    compositeEdgeCount: aE * bN + aN * bE,
  };
}
