// 复合（compose）结果显示：把替换图嵌入宿主图的每个状态点（图替换式叠加，非笛卡尔积连线）
import { useMemo, useState } from 'react';
import { compositeStats } from '@/lib/priority';
import type { Scenario } from '@/types/model';
import { ENTITY_NAMES } from '@/types/model';

const COLORS: Record<string, string> = {
  possession: '#16a34a',
  position: '#2563eb',
  control: '#9333ea',
  hp: '#dc2626',
  ballTrack: '#ea580c',
};

interface Props {
  scenario: Scenario;
}

export default function CompositePanel({ scenario }: Props) {
  const [host, setHost] = useState<string>('possession');
  const [guest, setGuest] = useState<string>('position');

  const A = scenario.graphs[host];
  const B = scenario.graphs[guest];
  const stats = useMemo(() => compositeStats(scenario, host, guest), [scenario, host, guest]);

  // 布局：宿主节点按原坐标缩放到左侧网格；每个宿主节点内嵌一个小号替换图
  const layout = useMemo(() => {
    const CELL_W = 240, CELL_H = 200, X0 = 130, Y0 = 130;
    const miniR = 13;
    // 宿主图坐标归一化到网格
    const xs = A.nodes.map((n) => n.x), ys = A.nodes.map((n) => n.y);
    const minX = Math.min(...xs, 0), maxX = Math.max(...xs, 1);
    const minY = Math.min(...ys, 0), maxY = Math.max(...ys, 1);
    const cells = A.nodes.map((n) => ({
      node: n,
      x: X0 + ((n.x - minX) / Math.max(1, maxX - minX)) * (CELL_W * 2),
      y: Y0 + ((n.y - minY) / Math.max(1, maxY - minY)) * (CELL_H * 2),
    }));
    // 替换图缩略坐标（圆排布，最多显示前 8 个状态）
    const showB = B.nodes.slice(0, 8);
    const minis = showB.map((n, i) => {
      const ang = (2 * Math.PI * i) / Math.max(1, showB.length) - Math.PI / 2;
      return { node: n, dx: Math.cos(ang) * 62, dy: Math.sin(ang) * 62 };
    });
    const hostPos = new Map(cells.map((c) => [c.node.id, c]));
    const width = Math.max(760, X0 * 2 + CELL_W * 2 + 200);
    const height = Math.max(520, Y0 * 2 + CELL_H * 2 + 120);
    return { cells, minis, hostPos, miniR, width, height };
  }, [A, B]);

  const same = host === guest;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3 text-sm flex-wrap">
        <span>宿主图（每个状态点被替换）：</span>
        <select value={host} onChange={(e) => setHost(e.target.value)}
          className="border rounded px-2 py-1 bg-background">
          {Object.values(scenario.graphs).map((g) => <option key={g.id} value={g.id}>{g.name}（{ENTITY_NAMES[g.owner]}）</option>)}
        </select>
        <span>替换图（嵌入副本）：</span>
        <select value={guest} onChange={(e) => setGuest(e.target.value)}
          className="border rounded px-2 py-1 bg-background">
          {Object.values(scenario.graphs).map((g) => <option key={g.id} value={g.id}>{g.name}（{ENTITY_NAMES[g.owner]}）</option>)}
        </select>
        {same && <span className="text-amber-600">宿主与替换相同：每个状态点嵌入自身副本（自复合）</span>}
      </div>

      <div className="text-sm text-muted-foreground">
        复合语义（图替换式叠加）：复合状态 = (宿主状态, 替换状态)，两图互不影响。
        复合节点数 = {stats.hostNodeCount} × {stats.guestNodeCount} = <b className="text-foreground">{stats.compositeNodeCount}</b>；
        复合边数 = 宿主边 × {stats.guestNodeCount} + 宿主节点 × 替换边 = <b className="text-foreground">{stats.compositeEdgeCount}</b>。
      </div>

      <div className="border rounded bg-slate-50 dark:bg-slate-900 overflow-auto max-h-[540px]">
        <svg width={layout.width} height={layout.height}>
          {/* 宿主边 */}
          {A.edges.map((e) => {
            const p1 = layout.hostPos.get(e.from), p2 = layout.hostPos.get(e.to);
            if (!p1 || !p2) return null;
            return (
              <g key={e.id}>
                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={COLORS[host]}
                  strokeWidth={e.isHyper ? 3 : 1.5} strokeDasharray={e.isHyper ? '8 4' : undefined}
                  opacity={0.55} markerEnd={`url(#carr_${e.id})`} />
                <defs>
                  <marker id={`carr_${e.id}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                    <path d="M0,0 L7,3.5 L0,7 z" fill={COLORS[host]} />
                  </marker>
                </defs>
              </g>
            );
          })}
          {/* 宿主节点 + 内嵌替换图副本 */}
          {layout.cells.map((c) => (
            <g key={c.node.id}>
              <circle cx={c.x} cy={c.y} r={92} fill="#ffffff" opacity={0.6} stroke={COLORS[host]} strokeWidth={1.5} strokeDasharray="3 3" />
              <text x={c.x} y={c.y - 100} textAnchor="middle" fontSize={12} fontWeight={700} fill={COLORS[host]}>
                {c.node.name.length > 10 ? c.node.name.slice(0, 10) : c.node.name}
              </text>
              {/* 替换图缩略（副本） */}
              {layout.minis.map((m) => (
                <g key={m.node.id}>
                  <line x1={c.x} y1={c.y} x2={c.x + m.dx} y2={c.y + m.dy} stroke={COLORS[guest]} strokeWidth={0.8} opacity={0.4} />
                  <circle cx={c.x + m.dx} cy={c.y + m.dy} r={layout.miniR} fill="#fff" stroke={COLORS[guest]} strokeWidth={1.2} />
                  <text x={c.x + m.dx} y={c.y + m.dy + 3} textAnchor="middle" fontSize={8} fill="#0f172a">
                    {m.node.name.length > 4 ? m.node.name.slice(0, 4) : m.node.name}
                  </text>
                </g>
              ))}
              <circle cx={c.x} cy={c.y} r={7} fill={COLORS[host]} />
              <title>{`${c.node.name} × ${scenario.graphs[guest]?.name ?? guest}（${stats.guestNodeCount} 个替换状态）`}</title>
            </g>
          ))}
        </svg>
      </div>

      <div className="border rounded p-3 text-sm">
        <h4 className="font-bold mb-2">如何理解这个结果</h4>
        <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
          <li>每个<b>虚线大圆</b> = 宿主图的一个状态点，里面整幅小图是替换图的副本。</li>
          <li>复合后单个实体的完整状态 = 大圆名 + 小圆名，例如「持球 × 中圈 (60,40)」。</li>
          <li>替换图的内部事件（小图内部流转）与宿主图事件（大圆之间）互不触发，保持各自独立节奏。</li>
          <li>跨逻辑域的同名状态会在「总超图」中再经过一次粘合（glue），与这里的复合（compose）是两种不同变换。</li>
        </ul>
      </div>
    </div>
  );
}
