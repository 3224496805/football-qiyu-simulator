// DFS 有向搜索树可视化
// 权威视图 = 总状态逻辑超图的 DFS（全部逻辑图粘合后统一搜索）
// 单图视图 = 某张逻辑图独立的 DFS（参考）
import { useMemo, useState } from 'react';
import { analyzeSingleGraph } from '@/lib/priority';
import type { DomainResult, PriorityResult } from '@/lib/priority';
import type { Scenario } from '@/types/model';
import { ENTITY_NAMES } from '@/types/model';

const GRAPH_COLORS = ['#16a34a', '#2563eb', '#9333ea', '#dc2626', '#ea580c', '#0891b2', '#be185d', '#a16207'];

interface Props {
  scenario: Scenario;
  result: PriorityResult;
  alpha: number;
}

export default function SearchTreePanel({ scenario, result, alpha }: Props) {
  const graphIds = Object.keys(scenario.graphs);
  const [sel, setSel] = useState<string>('__total__');
  const single: DomainResult | null = useMemo(
    () => (sel === '__total__' ? null : analyzeSingleGraph(scenario, sel, alpha)),
    [scenario, sel, alpha],
  );
  const color = sel === '__total__'
    ? '#0f766e'
    : GRAPH_COLORS[Math.max(0, graphIds.indexOf(sel)) % GRAPH_COLORS.length];

  // 统一视图数据
  const view = single ?? {
    domain: '__total__',
    graphName: '总状态逻辑超图（全部逻辑图粘合）',
    scores: result.scores,
    dfs: result.dfs,
    cycles: result.cycles,
    diameter: 0,
    subtreeDepthOf: new Map<string, number>(),
  };
  const dfs = view.dfs;
  const scores = view.scores;

  // 布局：每层一列，列内按访问顺序排列
  const { pos, width, height } = useMemo(() => {
    const byDepth = new Map<number, string[]>();
    for (const id of dfs.visitOrder) {
      const d = dfs.depthOf.get(id) ?? 0;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(id);
    }
    const m = new Map<string, { x: number; y: number; depth: number }>();
    const GX = 185, GY = 80, X0 = 110, Y0 = 80;
    let maxCount = 1;
    for (const ids of byDepth.values()) maxCount = Math.max(maxCount, ids.length);
    for (const [d, ids] of byDepth) {
      ids.forEach((id, i) => m.set(id, { x: X0 + d * GX, y: Y0 + i * GY, depth: d }));
    }
    const maxD = Math.max(0, ...byDepth.keys());
    return {
      pos: m,
      width: Math.max(640, X0 * 2 + maxD * GX),
      height: Math.max(300, Y0 * 2 + (maxCount - 1) * GY),
    };
  }, [dfs]);

  // 节点 id → 状态名（从边引用反查）
  const nodeName = (id: string) =>
    scores.find((s) => s.edge.from === id)?.edge.fromName ??
    scores.find((s) => s.edge.to === id)?.edge.toName ??
    (id === dfs.rootId ? '（根）' : id);

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-1 flex-wrap items-center">
        <button onClick={() => setSel('__total__')}
          className={`px-3 py-1 rounded text-sm border font-bold ${sel === '__total__' ? 'text-white' : 'bg-background'}`}
          style={sel === '__total__' ? { background: '#0f766e' } : { borderColor: '#0f766e', color: '#0f766e' }}>
          总超图（权威）
        </button>
        {graphIds.map((gid, i) => (
          <button key={gid} onClick={() => setSel(gid)}
            className={`px-3 py-1 rounded text-sm border ${sel === gid ? 'text-white' : 'bg-background'}`}
            style={sel === gid ? { background: GRAPH_COLORS[i % GRAPH_COLORS.length] } : { borderColor: GRAPH_COLORS[i % GRAPH_COLORS.length], color: GRAPH_COLORS[i % GRAPH_COLORS.length] }}>
            {scenario.graphs[gid].name}
          </button>
        ))}
      </div>
      <div className="text-xs text-muted-foreground">
        {sel === '__total__'
          ? '权威视图：跨逻辑图同名状态已粘合，DFS 在此总超图上统一生成搜索树，优先级排名以此为准。'
          : `参考视图：单张逻辑图独立的 DFS（${ENTITY_NAMES[scenario.graphs[sel].owner]}），不参与权威排名。`}
        {' '}DFS 从「{nodeName(dfs.rootId)}」出发 · 最大层深 {dfs.maxDepth} · 树边 {dfs.treeEdgeIds.size} · 回边 {dfs.backEdgeIds.size}（回边 = 成环证据）
        {dfs.unreachable.length > 0 && <> · <span className="text-amber-600">不可达 {dfs.unreachable.length} 个：{dfs.unreachable.slice(0, 12).join('、')}{dfs.unreachable.length > 12 ? '…' : ''}</span></>}
      </div>

      <div className="border rounded bg-slate-50 dark:bg-slate-900 overflow-auto max-h-[520px]">
        <svg width={width} height={height}>
          {[...new Set([...pos.values()].map((p) => p.depth))].sort((a, b) => a - b).map((d) => {
            const x = 110 + d * 185;
            return (
              <g key={d}>
                <line x1={x} y1={30} x2={x} y2={height - 20} stroke="#94a3b8" strokeWidth={0.5} strokeDasharray="2 6" opacity={0.5} />
                <text x={x} y={24} textAnchor="middle" fontSize={11} fill="#64748b">层深 {d}</text>
              </g>
            );
          })}
          {scores.map((s) => {
            const p1 = pos.get(s.edge.from), p2 = pos.get(s.edge.to);
            if (!p1 || !p2) return null;
            const isTree = dfs.treeEdgeIds.has(s.edge.id);
            const isBack = dfs.backEdgeIds.has(s.edge.id);
            if (!isTree && !isBack) return null;
            const col = isBack ? '#dc2626' : color;
            const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2 - 18;
            return (
              <g key={s.edge.id}>
                <path d={`M ${p1.x} ${p1.y} Q ${mx} ${my} ${p2.x} ${p2.y}`} fill="none"
                  stroke={col} strokeWidth={isBack ? 2.5 : 2}
                  strokeDasharray={isBack ? '6 4' : undefined}
                  opacity={isBack ? 0.9 : 0.75}
                  markerEnd={`url(#arr_${s.edge.id})`} />
                <defs>
                  <marker id={`arr_${s.edge.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill={col} />
                  </marker>
                </defs>
                <text x={mx} y={my - 4} textAnchor="middle" fontSize={11} fill={col}
                  stroke="#fff" strokeWidth={3} paintOrder="stroke">{s.edge.event}</text>
              </g>
            );
          })}
          {dfs.visitOrder.map((id) => {
            const p = pos.get(id);
            if (!p) return null;
            const nm = nodeName(id);
            const inMain = view.cycles.mainCycle.includes(nm);
            return (
              <g key={id}>
                <circle cx={p.x} cy={p.y} r={24}
                  fill={inMain ? '#ecfdf5' : '#fff'}
                  stroke={inMain ? '#059669' : color} strokeWidth={inMain ? 3 : 2} />
                <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="#0f172a">
                  {nm.length > 6 ? nm.slice(0, 6) : nm}
                </text>
                <text x={p.x} y={p.y + 42} textAnchor="middle" fontSize={10} fill="#64748b">
                  d={p.depth}{inMain ? ' · 主循环' : ''}
                </text>
                <title>{nm}（层深 {p.depth}）</title>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div className="border rounded p-3">
          <h4 className="font-bold mb-2">事件 → DFS 层深（同一事件可在不同分支处于不同层深）</h4>
          <div className="max-h-64 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted sticky top-0">
                <tr><th className="p-1 text-left">事件</th><th className="p-1 text-left">转换</th><th className="p-1 text-left">层深集合</th></tr>
              </thead>
              <tbody>
                {[...dfs.depthsOfEdge.entries()].sort((a, b) => a[1][0] - b[1][0]).map(([ev, ds]) => {
                  const s = scores.find((x) => x.edge.event === ev);
                  return (
                    <tr key={ev} className="border-t">
                      <td className="p-1 font-medium">{ev}{s?.isBackEdge ? ' ↩' : ''}</td>
                      <td className="p-1 text-muted-foreground">{s ? `${s.edge.fromName} → ${s.edge.toName}` : '—'}</td>
                      <td className="p-1 font-mono">{'{'}{[...ds].sort((a, b) => a - b).join(', ')}{'}'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="border rounded p-3">
          <h4 className="font-bold mb-2">DFS 统计</h4>
          <ul className="list-disc pl-5 space-y-1 text-xs">
            <li>起点（根）：{nodeName(dfs.rootId)}</li>
            <li>访问节点 {dfs.visitOrder.length}，最大层深 {dfs.maxDepth}</li>
            <li>树边 {dfs.treeEdgeIds.size} 条，回边 {dfs.backEdgeIds.size} 条（回边构成环）</li>
            <li>主循环（最大 SCC）：{view.cycles.mainCycle.length > 0 ? view.cycles.mainCycle.slice(0, 20).join('→') + (view.cycles.mainCycle.length > 20 ? '…' : '') : '（无环）'}</li>
            <li className={view.cycles.shortCycles.length > 0 ? 'text-red-600' : ''}>
              短环（&lt;4）：{view.cycles.shortCycles.length > 0 ? view.cycles.shortCycles.slice(0, 8).map((c) => c.join('→')).join('；') : '无'}
            </li>
            <li className="text-muted-foreground">优先级语义：通往深层/主循环路上的事件高分，短环内事件 ×0.3 惩罚</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
