import { useCallback, useEffect, useRef, useState } from 'react';
import type { DomainGraph } from '@/types/model';

interface Props {
  graph: DomainGraph;
  onChange: (g: DomainGraph) => void;
  onEditEdge: (edgeId: string) => void;
  color: string;
}

const NODE_R = 26;

export default function GraphCanvas({ graph, onChange, onEditEdge, color }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 920, h: 560 });
  const [dragId, setDragId] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState(false);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  // 实测容器尺寸，让 SVG 用户坐标与屏幕像素 1:1 对应（避免不同窗口/缩放下图元漂移或放大）
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: Math.max(600, el.clientWidth), h: Math.max(400, el.clientHeight) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toLocal = useCallback((e: React.MouseEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const nodeById = (id: string) => graph.nodes.find((n) => n.id === id);

  // ---------- 拖拽 ----------
  const onNodeMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (linkMode) {
      if (!linkFrom) { setLinkFrom(id); return; }
      if (linkFrom !== id) {
        const eventName = window.prompt('事件名（如：传 / 掉 / 射）', '新事件');
        if (eventName) {
          onChange({
            ...graph,
            edges: [...graph.edges, {
              id: `e_${Date.now()}`,
              event: eventName,
              from: linkFrom,
              to: id,
              condition: '（待编辑条件）',
              isHyper: false,
              affectsOthers: false,
              params: { basePriority: 1, cooldown: 0, structWeight: 1 },
            }],
          });
        }
      }
      setLinkFrom(null);
      return;
    }
    setDragId(id);
    setSelectedNode(id);
    setSelectedEdge(null);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragId) return;
    const { x, y } = toLocal(e);
    onChange({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === dragId ? { ...n, x, y } : n)),
    });
  };

  const onMouseUp = () => setDragId(null);

  // ---------- 空白双击：新建状态 ----------
  const onDoubleClick = (e: React.MouseEvent) => {
    if (linkMode) return;
    const { x, y } = toLocal(e);
    const name = window.prompt('状态名（如：无球 / 持球 / 蓄力）');
    if (!name) return;
    if (graph.nodes.some((n) => n.name === name)) { alert('同名状态将被粘合，请确认这是有意为之'); }
    onChange({
      ...graph,
      nodes: [...graph.nodes, { id: `n_${Date.now()}`, name, x, y }],
    });
  };

  // ---------- 视图复位：把全部节点收纳进当前视野 ----------
  const resetView = () => {
    if (graph.nodes.length === 0) return;
    const xs = graph.nodes.map((n) => n.x), ys = graph.nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(1, maxX - minX), spanY = Math.max(1, maxY - minY);
    const pad = 90;
    const availW = Math.max(200, size.w - pad * 2), availH = Math.max(200, size.h - pad * 2);
    const k = Math.min(availW / spanX, availH / spanY, 1.5); // 放大不超过 1.5 倍
    const offX = (size.w - spanX * k) / 2, offY = (size.h - spanY * k) / 2;
    onChange({
      ...graph,
      nodes: graph.nodes.map((n) => ({
        ...n,
        x: offX + (n.x - minX) * k,
        y: offY + (n.y - minY) * k,
      })),
    });
  };

  // ---------- 删除 ----------
  const deleteSelected = () => {
    if (selectedNode) {
      onChange({
        ...graph,
        nodes: graph.nodes.filter((n) => n.id !== selectedNode),
        edges: graph.edges.filter((ed) => ed.from !== selectedNode && ed.to !== selectedNode),
      });
      setSelectedNode(null);
    } else if (selectedEdge) {
      onChange({ ...graph, edges: graph.edges.filter((ed) => ed.id !== selectedEdge) });
      setSelectedEdge(null);
    }
  };

  // ---------- 渲染边 ----------
  const renderEdge = (ed: typeof graph.edges[number]) => {
    const f = nodeById(ed.from)!, t = nodeById(ed.to)!;
    const mx = (f.x + t.x) / 2, my = (f.y + t.y) / 2 - 30;
    const sel = selectedEdge === ed.id;
    const stroke = sel ? '#f59e0b' : color;
    return (
      <g key={ed.id} onClick={(e) => { e.stopPropagation(); setSelectedEdge(ed.id); setSelectedNode(null); onEditEdge(ed.id); }}>
        <path
          d={`M ${f.x} ${f.y} Q ${mx} ${my} ${t.x} ${t.y}`}
          fill="none"
          stroke={stroke}
          strokeWidth={sel ? 4 : ed.isHyper ? 3.5 : 2}
          strokeDasharray={ed.isHyper ? '8 4' : undefined}
          opacity={sel ? 1 : 0.75}
          markerEnd={`url(#arrow_${ed.id})`}
          className="cursor-pointer hover:opacity-100"
        />
        <text x={mx} y={my - 6} textAnchor="middle" fontSize={12} fill={stroke} className="pointer-events-none select-none">
          {ed.event}{ed.isHyper ? ' ⇄' : ''}
        </text>
        <defs>
          <marker id={`arrow_${ed.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={stroke} />
          </marker>
        </defs>
      </g>
    );
  };

  return (
    <div ref={wrapRef} className="relative w-full h-full overflow-hidden">
      <div className="absolute top-2 left-2 z-10 flex gap-2">
        <button
          onClick={() => { setLinkMode(!linkMode); setLinkFrom(null); }}
          className={`px-3 py-1 rounded text-sm border ${linkMode ? 'bg-amber-500 text-black' : 'bg-background/80'}`}
        >
          {linkMode ? '连线模式：点击起点→终点（退出）' : '进入连线模式'}
        </button>
        <button onClick={deleteSelected} className="px-3 py-1 rounded text-sm border bg-background/80 hover:bg-destructive hover:text-white">
          删除选中
        </button>
        <button onClick={resetView} className="px-3 py-1 rounded text-sm border bg-background/80 hover:bg-muted">
          视图复位
        </button>
        <span className="px-3 py-1 text-xs text-muted-foreground">双击空白 = 新建状态 · 点击边 = 编辑事件 · 拖拽 = 移动</span>
      </div>
      <svg
        width={size.w}
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        className="bg-slate-50 dark:bg-slate-900 rounded-lg"
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onDoubleClick={onDoubleClick}
        onClick={() => { setSelectedNode(null); setSelectedEdge(null); }}
      >
        {graph.edges.map(renderEdge)}
        {graph.nodes.map((n) => (
          <g key={n.id} onMouseDown={(e) => onNodeMouseDown(e, n.id)} className="cursor-grab active:cursor-grabbing">
            <circle
              cx={n.x} cy={n.y} r={NODE_R}
              fill={linkFrom === n.id ? '#fbbf24' : selectedNode === n.id ? '#f59e0b' : '#ffffff'}
              stroke={color} strokeWidth={3}
            />
            <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize={13} fontWeight={600} fill="#0f172a" className="pointer-events-none select-none">
              {n.name.length > 4 ? n.name.slice(0, 4) : n.name}
            </text>
            {n.note && <title>{n.note}</title>}
          </g>
        ))}
      </svg>
    </div>
  );
}
