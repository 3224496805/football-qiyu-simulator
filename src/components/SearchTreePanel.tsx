// DFS 有向搜索树可视化：树边实线、回边虚线（成环证据），节点按首次访问层深分列
import { useMemo, useState } from 'react';
import type { DomainResult, PriorityResult } from '@/lib/priority';
import type { DomainId } from '@/types/model';
import { DOMAIN_IDS, DOMAIN_NAMES } from '@/types/model';

const COLORS: Record<DomainId, string> = {
  possession: '#16a34a',
  position: '#2563eb',
  control: '#9333ea',
  hp: '#dc2626',
  ballTrack: '#ea580c',
};

interface Props {
  result: PriorityResult;
}

export default function SearchTreePanel({ result }: Props) {
  const [domain, setDomain] = useState<DomainId>('possession');
  const r: DomainResult = result.byDomain[domain];
  const dfs = r.dfs;

  // 布局：每层一列，列内按访问顺序排列
  const { pos, width, height } = useMemo(() => {
    const byDepth = new Map<number, string[]>();
    for (const id of dfs.visitOrder) {
      const d = dfs.depthOf.get(id) ?? 0;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(id);
    }
    const m = new Map<string, { x: number; y: number; depth: number; order: number }>();
    const GX = 190, GY = 84, X0 = 110, Y0 = 80;
    let maxCount = 1;
    for (const ids of byDepth.values()) maxCount = Math.max(maxCount, ids.length);
    for (const [d, ids] of byDepth) {
      ids.forEach((id, i) => m.set(id, { x: X0 + d * GX, y: Y0 + i * GY, depth: d, order: i }));
    }
    const maxD = Math.max(0, ...byDepth.keys());
    return {
      pos: m,
      width: Math.max(640, X0 * 2 + maxD * GX),
      height: Math.max(300, Y0 * 2 + (maxCount - 1) * GY),
    };
  }, [dfs]);

  // 节点 id → 状态名（从边引用反查；根节点也从出边反查）
  const nodeName = (id: string) =>
    r.scores.find((s) => s.edge.from === id)?.edge.fromName ??
    r.scores.find((s) => s.edge.to === id)?.edge.toName ??
    id;

  const short = r.cycles.shortCycles.flat().join('、');

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-1 flex-wrap items-center">
        {DOMAIN_IDS.map((d) => (
          <button key={d} onClick={() => setDomain(d)}
            className={`px-3 py-1 rounded text-sm border ${domain === d ? 'text-white' : 'bg-background'}`}
            style={domain === d ? { background: COLORS[d] } : { borderColor: COLORS[d], color: COLORS[d] }}>
            {DOMAIN_NAMES[d]}
          </button>
        ))}
        <span className="text-xs text-muted-foreground ml-2">
          DFS 从「{nodeName(dfs.rootId)}」出发生成有向搜索树 ·
          最大层深 {dfs.maxDepth} · 树边 {dfs.treeEdgeIds.size} · 回边 {dfs.backEdgeIds.size}（回边 = 成环证据）
          {dfs.unreachable.length > 0 && <> · <span className="text-amber-600">不可达：{dfs.unreachable.join('、')}</span></>}
        </span>
      </div>

      <div className="border rounded bg-slate-50 dark:bg-slate-900 overflow-auto max-h-[520px]">
        <svg width={width} height={height}>
          {/* 层深参考线 */}
          {[...new Set([...pos.values()].map((p) => p.depth))].sort((a, b) => a - b).map((d) => {
            const x = 110 + d * 190;
            return (
              <g key={d}>
                <line x1={x} y1={30} x2={x} y2={height - 20} stroke="#94a3b8" strokeWidth={0.5} strokeDasharray="2 6" opacity={0.5} />
                <text x={x} y={24} textAnchor="middle" fontSize={11} fill="#64748b">层深 {d}</text>
              </g>
            );
          })}
          {/* 边：树边实线，回边红色虚线 */}
          {r.scores.map((s) => {
            const p1 = pos.get(s.edge.from), p2 = pos.get(s.edge.to);
            if (!p1 || !p2) return null;
            const isTree = dfs.treeEdgeIds.has(s.edge.id);
            const isBack = dfs.backEdgeIds.has(s.edge.id);
            if (!isTree && !isBack) return null; // 前向/横边不在树上显示
            const col = isBack ? '#dc2626' : COLORS[domain];
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
          {/* 节点 */}
          {dfs.visitOrder.map((id) => {
            const p = pos.get(id);
            if (!p) return null;
            const inMain = r.cycles.mainCycle.includes(nodeName(id));
            return (
              <g key={id}>
                <circle cx={p.x} cy={p.y} r={24}
                  fill={inMain ? '#ecfdf5' : '#fff'}
                  stroke={inMain ? '#059669' : COLORS[domain]} strokeWidth={inMain ? 3 : 2} />
                <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="#0f172a">
                  {nodeName(id).length > 6 ? nodeName(id).slice(0, 6) : nodeName(id)}
                </text>
                <text x={p.x} y={p.y + 42} textAnchor="middle" fontSize={10} fill="#64748b">
                  d={p.depth}{inMain ? ' · 主循环' : ''}
                </text>
                <title>{nodeName(id)}（层深 {p.depth}）</title>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div className="border rounded p-3">
          <h4 className="font-bold mb-2">事件 → DFS 层深（同一事件可在不同分支处于不同层深）</h4>
          <table className="w-full text-xs">
            <thead className="bg-muted">
              <tr><th className="p-1 text-left">事件</th><th className="p-1 text-left">转换</th><th className="p-1 text-left">层深集合</th></tr>
            </thead>
            <tbody>
              {[...dfs.depthsOfEdge.entries()].sort((a, b) => a[1][0] - b[1][0]).map(([ev, ds]) => {
                const s = r.scores.find((x) => x.edge.event === ev);
                return (
                  <tr key={ev} className="border-t">
                    <td className="p-1 font-medium">{ev}{s?.isBackEdge ? ' ↩' : ''}</td>
                    <td className="p-1 text-muted-foreground">{s ? `${s.edge.fromName} → ${s.edge.toName}` : '—'}</td>
                    <td className="p-1 font-mono">{'{'}{ds.sort((a, b) => a - b).join(', ')}{'}'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border rounded p-3">
          <h4 className="font-bold mb-2">DFS 统计</h4>
          <ul className="list-disc pl-5 space-y-1 text-xs">
            <li>起点（根）：{nodeName(dfs.rootId)}</li>
            <li>访问节点 {dfs.visitOrder.length} / {r.scores.length ? dfs.visitOrder.length + dfs.unreachable.length : 0}，最大层深 {dfs.maxDepth}</li>
            <li>树边 {dfs.treeEdgeIds.size} 条，回边 {dfs.backEdgeIds.size} 条（回边构成环）</li>
            <li>主循环（最大 SCC）：{r.cycles.mainCycle.length > 0 ? r.cycles.mainCycle.join('→') : '（无环）'}</li>
            <li className={r.cycles.shortCycles.length > 0 ? 'text-red-600' : ''}>
              短环（&lt;4）：{r.cycles.shortCycles.length > 0 ? r.cycles.shortCycles.map((c) => c.join('→')).join('；') : '无'}
            </li>
            {short && <li>优先级语义：通往深层/主循环路上的事件高分，短环内事件 ×0.3 惩罚</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
