import { useMemo } from 'react';
import type { PriorityResult } from '@/lib/priority';
import { buildTotalGraph } from '@/lib/priority';
import type { DomainId, Scenario } from '@/types/model';
import { DOMAIN_NAMES } from '@/types/model';

const DOMAIN_COLORS: Record<DomainId, string> = {
  possession: '#16a34a',
  position: '#2563eb',
  control: '#9333ea',
  hp: '#dc2626',
  ballTrack: '#ea580c',
};

interface Props {
  scenario: Scenario;
  result: PriorityResult;
}

export default function TotalGraphPanel({ scenario, result }: Props) {
  const total = useMemo(() => buildTotalGraph(scenario), [scenario]);

  // 分层布局：节点位置取其在所属逻辑域 DFS 搜索树中的层深（复合 = 各域独立分层）
  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    const byLayer = new Map<number, string[]>();
    for (const n of total.nodes) {
      // 找第一个能为该节点给出 DFS 层深的逻辑域
      for (const d of n.domains) {
        const l = result.byDomain[d]?.dfs.depthOf.get(n.id);
        if (l !== undefined) {
          if (!byLayer.has(l)) byLayer.set(l, []);
          byLayer.get(l)!.push(n.id);
          break;
        }
      }
    }
    for (const [l, ids] of byLayer) {
      ids.forEach((id, i) => m.set(id, { x: 100 + l * 170, y: 60 + i * 92 }));
    }
    const maxL = Math.max(0, ...byLayer.keys());
    const un = total.nodes.filter((n) => !m.has(n.id));
    un.forEach((n, i) => m.set(n.id, { x: 100 + (maxL + 1) * 170, y: 60 + i * 92 }));
    return m;
  }, [total, result]);

  // 主循环成员：任一逻辑域的主循环
  const mainSet = new Set<string>();
  for (const d of Object.values(result.byDomain)) for (const n of d.cycles.mainCycle) mainSet.add(n);

  const layerOfNode = (id: string) => pos.get(id) ? (pos.get(id)!.x - 100) / 170 : 0;
  const maxLayer = Math.max(1, ...[...pos.values()].map((p) => Math.round((p.x - 100) / 170)));

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm text-muted-foreground">
        总状态逻辑超图：跨逻辑域的同名状态已粘合（glue），虚线为超边（多实体联合事件）。
        布局按 DFS 层深（球权逻辑起点=无球，其余域取首状态）从左到右展开。
        实体归属：球权/位置/姿态/血量挂角色实体（同职业共享职业技能边），球路挂球实体。
      </div>

      <div className="border rounded bg-slate-50 dark:bg-slate-900 overflow-auto max-h-[480px]">
        <svg width={Math.max(600, 260 + maxLayer * 170)} height={480}>
          {total.edges.map((e) => {
            const p1 = pos.get(e.from), p2 = pos.get(e.to);
            if (!p1 || !p2) return null;
            const col = DOMAIN_COLORS[e.domain];
            const back = layerOfNode(e.to) <= layerOfNode(e.from);
            return (
              <g key={e.id}>
                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                  stroke={col} strokeWidth={e.isHyper ? 3 : 1.5}
                  strokeDasharray={e.isHyper ? '8 4' : back ? '3 3' : undefined}
                  opacity={0.7} markerEnd={`url(#arr_${e.id})`} />
                <defs>
                  <marker id={`arr_${e.id}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 z" fill={col} />
                  </marker>
                </defs>
              </g>
            );
          })}
          {total.nodes.map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const inMain = mainSet.has(n.name);
            return (
              <g key={n.id}>
                <circle cx={p.x} cy={p.y} r={24}
                  fill={inMain ? '#ecfdf5' : '#ffffff'} stroke={inMain ? '#059669' : '#64748b'} strokeWidth={inMain ? 3 : 1.5} />
                <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={12} fontWeight={600} fill="#0f172a">{n.name}</text>
                <text x={p.x} y={p.y + 40} textAnchor="middle" fontSize={10} fill="#64748b">
                  {n.domains.map((d) => DOMAIN_NAMES[d]).join('+')}
                </text>
                {inMain && <text x={p.x} y={p.y - 30} textAnchor="middle" fontSize={10} fill="#059669">主循环</text>}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div className="border rounded p-3">
          <h4 className="font-bold mb-2">粘合记录（glue：同名状态节点合并）</h4>
          {total.gluedPairs.length === 0 && <p className="text-muted-foreground">跨域没有同名状态，未发生粘合。</p>}
          <ul className="list-disc pl-5 space-y-1">
            {[...new Set(total.gluedPairs)].map((g, i) => <li key={i}>{g} 与其他逻辑域同名状态合并</li>)}
          </ul>
        </div>
        <div className="border rounded p-3">
          <h4 className="font-bold mb-2">超边（多实体联合事件）</h4>
          {total.edges.filter((e) => e.isHyper).length === 0 && <p className="text-muted-foreground">暂无超边。</p>}
          <ul className="list-disc pl-5 space-y-1">
            {total.edges.filter((e) => e.isHyper).map((e) => (
              <li key={e.id}>{e.event}：{e.fromName} → {e.toName}（{DOMAIN_NAMES[e.domain]}）</li>
            ))}
          </ul>
          <h4 className="font-bold mb-2 mt-4">复合结构（compose：状态叠加，互不影响）</h4>
          <p className="text-muted-foreground">
            每个角色的总状态 = 球权 × 位置(网格) × 姿态 × 血量 四个维度叠加；球实体独立拥有球路逻辑。
            当前方案 {scenario.playersPerTeam}v{scenario.playersPerTeam}（{scenario.players.length} 角色 + 1 球）。
            多人位置联合状态数 = |网格|^角色数，即 12^{scenario.players.length} 种组合（完整状态空间还要 × 其他维度）。
            图替换式复合的可视化见「复合预览」标签页。
          </p>
        </div>
      </div>
    </div>
  );
}
