// 画布：逻辑图和总超图共用的渲染器
//   单维度模式（可编辑）：连线模式点起点→终点 = 挂到已有事件或新建事件（写回事件库）；
//     双击空白 = 新建状态；选中连线/状态后可删除（同样是写回事件库/维度，图只是展示）
//   总超图模式（只读）：合并视图，同名状态粘合成一个节点
// 着色：单维度模式按触发方式（主动=蓝实线，被动=橙虚线）；总超图按所属维度着色
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DerivedGraph } from '@/lib/derive2';
import type { EntityKind, Scenario2 } from '@/types/model2';
import { ENTITY_NAMES } from '@/types/model2';
import { describeEvent } from '@/lib/describe2';
import { layoutGraph } from '@/lib/layout2';

interface Props {
  sc: Scenario2;
  graph: DerivedGraph;
  mode: 'single' | 'total';
  colors: Record<string, string>; // 维度 id -> 颜色
  singleDimId?: string;
  dimOwner?: EntityKind;          // 单维度模式下当前维度归属（连线候选事件按它过滤）
  startKeys: string[];
  selectedEventId: string | null;
  selectedNodeKey: string | null;
  onSelectEvent: (id: string) => void;
  onSelectNode: (key: string | null) => void;
  // 写回事件库的操作（仅单维度模式传入）
  onAddState?: (name: string) => void;
  onLink?: (from: string, to: string, eventId: string | null, newName?: string) => void;
  onRemoveEffect?: (edgeId: string) => void;
  onRemoveState?: (nodeKey: string) => void;
}

const R = 30; // 节点半径
const COLOR_ACTIVE = '#2563eb'; // 主动=蓝
const COLOR_PASSIVE = '#ea580c'; // 被动=橙
const COLOR_UNKNOWN = '#64748b';

export default function GraphView2(props: Props) {
  const { sc, graph, mode, colors, singleDimId, startKeys } = props;
  const editable = mode === 'single' && !!props.onLink;
  const [scale, setScale] = useState(1);
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [chooser, setChooser] = useState<{ from: string; to: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const panSuppress = useRef(false); // 拖拽平移后抑制紧随其后的点击（避免误取消选中）

  // Ctrl/⌘ + 滚轮 = 缩放画布（需要原生监听才能阻止浏览器整页缩放）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setScale((s) => Math.min(2, Math.max(0.4, +(s + (e.deltaY < 0 ? 0.15 : -0.15)).toFixed(2))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 按住空白处拖拽 = 平移画布（移动超过 4 像素才算拖拽，否则仍是点击）
  const onPanStart = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.target !== e.currentTarget || linkMode) return;
    const el = scrollRef.current;
    if (!el) return;
    pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPanMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = pan.current;
    const el = scrollRef.current;
    if (!p || !el) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 4) return;
    p.moved = true;
    el.scrollLeft = p.left - dx;
    el.scrollTop = p.top - dy;
  };
  const onPanEnd = () => {
    if (pan.current?.moved) panSuppress.current = true;
    pan.current = null;
  };

  const layout = useMemo(
    () => layoutGraph(graph.nodes.map((n) => n.key), graph.edges, startKeys),
    [graph, startKeys],
  );

  // 同一对节点（含反向）之间的多条边按"车道"错开，避免标签叠在一起
  const lane = useMemo(() => {
    const pairKey = (a: string, b: string) => [a, b].sort().join('~');
    const total = new Map<string, number>();
    const idx = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const e of graph.edges) {
      const k = pairKey(e.from, e.to);
      total.set(k, (total.get(k) ?? 0) + 1);
      idx.set(e.id, seen.get(k) ?? 0);
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return { pairKey, total, idx };
  }, [graph.edges]);

  const eventById = useMemo(() => new Map(sc.events.map((e) => [e.id, e])), [sc.events]);

  // 连线候选事件：归属实体和当前维度一致的事件才能挂
  const candidates = useMemo(
    () => (props.dimOwner ? sc.events.filter((e) => e.owner === props.dimOwner) : []),
    [sc.events, props.dimOwner],
  );

  const edgeColor = (dimId: string, trigger: '主动' | '被动') =>
    mode === 'single' ? (trigger === '主动' ? COLOR_ACTIVE : COLOR_PASSIVE) : (colors[dimId] ?? COLOR_UNKNOWN);

  const nodeColor = (dims: string[]) => {
    if (mode === 'single') return singleDimId ? (colors[singleDimId] ?? COLOR_UNKNOWN) : COLOR_UNKNOWN;
    return dims.length === 1 ? (colors[dims[0]] ?? COLOR_UNKNOWN) : '#d97706'; // 粘合状态=琥珀色双圈
  };

  const selEvent = props.selectedEventId;
  const selNode = props.selectedNodeKey;
  const fading = selEvent !== null;

  // ---------- 写回操作 ----------
  const onNodeClick = (key: string) => {
    if (!linkMode) return;
    if (!linkFrom) { setLinkFrom(key); return; }
    setChooser({ from: linkFrom, to: key });
    setLinkFrom(null);
  };
  const pickEvent = (eventId: string | null) => {
    if (!chooser || !props.onLink) return;
    props.onLink(chooser.from, chooser.to, eventId, eventId === null ? newName : undefined);
    setChooser(null);
    setNewName('');
  };
  const deleteSelected = () => {
    if (selectedEdgeId && props.onRemoveEffect) {
      props.onRemoveEffect(selectedEdgeId);
      setSelectedEdgeId(null);
    } else if (selNode && props.onRemoveState) {
      props.onRemoveState(selNode);
    }
  };
  const onDoubleClickBlank = () => {
    if (!editable || !props.onAddState || linkMode) return;
    const name = window.prompt('新状态名（加入当前维度）', '');
    if (name) props.onAddState(name);
  };

  const renderEdge = (ed: DerivedGraph['edges'][number]) => {
    const f = layout.pos.get(ed.from);
    const t = layout.pos.get(ed.to);
    if (!f || !t) return null;
    const ev = eventById.get(ed.eventId);
    const isSelEdge = selectedEdgeId === ed.id;
    const stroke = isSelEdge || selEvent === ed.eventId ? '#f59e0b' : edgeColor(ed.dimId, ed.trigger);
    const isSel = selEvent === ed.eventId;
    const dim = fading && !isSel && !isSelEdge ? 0.22 : 0.85;
    const dashed = ed.trigger === '被动';
    const tip = ev ? describeEvent(sc, ev) : ed.event;
    const clickEdge = (e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedEdgeId(ed.id);
      props.onSelectEvent(ed.eventId);
    };
    const label = ed.event.length > 8 ? ed.event.slice(0, 8) : ed.event;
    const marker = (
      <defs>
        <marker id={`arr_${ed.id}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill={stroke} />
        </marker>
      </defs>
    );

    if (ed.from === ed.to) {
      const d = `M ${f.x} ${f.y - R} C ${f.x + 62} ${f.y - R - 74} ${f.x - 62} ${f.y - R - 74} ${f.x - 4} ${f.y - R - 4}`;
      return (
        <g key={ed.id} opacity={dim} onClick={clickEdge} className="cursor-pointer">
          <path d={d} fill="none" stroke={stroke} strokeWidth={isSel || isSelEdge ? 4 : 2}
            strokeDasharray={dashed ? '7 5' : undefined} markerEnd={`url(#arr_${ed.id})`} />
          <text x={f.x} y={f.y - R - 58} textAnchor="middle" fontSize={12} fill={stroke}
            stroke="#ffffff" strokeWidth={4} paintOrder="stroke" className="pointer-events-none select-none">
            {label}
          </text>
          <title>{tip}</title>
          {marker}
        </g>
      );
    }

    const dx = t.x - f.x, dy = t.y - f.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len, py = dx / len;
    const k = lane.pairKey(ed.from, ed.to);
    const n = lane.total.get(k) ?? 1;
    const laneIdx = (lane.idx.get(ed.id) ?? 0) - (n - 1) / 2;
    const off = laneIdx * 60;
    const lift = n === 1 ? 26 : 0;
    const cx = (f.x + t.x) / 2 + px * off;
    const cy = (f.y + t.y) / 2 + py * off - lift;
    const sx = f.x + (dx / len) * R, sy = f.y + (dy / len) * R;
    const ex = t.x - (dx / len) * (R + 4), ey = t.y - (dy / len) * (R + 4);
    return (
      <g key={ed.id} opacity={dim} onClick={clickEdge} className="cursor-pointer hover:opacity-100">
        <path d={`M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`} fill="none" stroke={stroke}
          strokeWidth={isSel || isSelEdge ? 4 : ed.crossDim ? 3 : 2} strokeDasharray={dashed ? '7 5' : undefined}
          markerEnd={`url(#arr_${ed.id})`} />
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={12} fill={stroke}
          stroke="#ffffff" strokeWidth={4} paintOrder="stroke" strokeLinejoin="round"
          className="pointer-events-none select-none">
          {label}{ed.crossDim && mode === 'total' ? ' ⇄' : ''}
        </text>
        <title>{tip}</title>
        {marker}
      </g>
    );
  };

  const legendItems = mode === 'single'
    ? [
        { color: COLOR_ACTIVE, label: '主动事件（实线）' },
        { color: COLOR_PASSIVE, label: '被动事件（虚线）' },
      ]
    : sc.dimensions.map((d) => ({ color: colors[d.id] ?? COLOR_UNKNOWN, label: d.name }));

  return (
    <div ref={scrollRef} className="relative w-full h-full overflow-auto bg-slate-50 dark:bg-slate-900">
      <div className="sticky top-0 left-0 z-10 pointer-events-none">
        <div className="absolute top-2 left-2 flex flex-col gap-1 pointer-events-auto max-w-[640px]">
          <div className="flex gap-1 items-center bg-background/90 border rounded px-2 py-1 w-fit flex-wrap">
            <button onClick={() => setScale((s) => Math.min(2, +(s + 0.2).toFixed(2)))}
              className="px-2 py-0.5 border rounded text-sm hover:bg-muted">＋</button>
            <button onClick={() => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(2)))}
              className="px-2 py-0.5 border rounded text-sm hover:bg-muted">－</button>
            <button onClick={() => setScale(1)} className="px-2 py-0.5 border rounded text-xs hover:bg-muted">
              {Math.round(scale * 100)}%
            </button>
            {editable && (
              <>
                <button onClick={() => { setLinkMode(!linkMode); setLinkFrom(null); setChooser(null); }}
                  className={`px-2 py-0.5 border rounded text-sm ${linkMode ? 'bg-amber-500 text-black border-amber-500' : 'hover:bg-muted'}`}>
                  {linkMode ? '连线中：点起点→终点（再点退出）' : '进入连线模式'}
                </button>
                <button onClick={deleteSelected}
                  className="px-2 py-0.5 border rounded text-sm hover:bg-red-50 dark:hover:bg-red-950 text-red-600">
                  删除选中
                </button>
              </>
            )}
            <span className="text-xs text-muted-foreground ml-1">
              {graph.nodes.length} 个状态 · {graph.edges.length} 条变化{mode === 'total' ? ' · ⇄ = 跨维度事件' : ''}
            </span>
          </div>
          <div className="flex gap-2 items-center bg-background/90 border rounded px-2 py-1 w-fit flex-wrap">
            {legendItems.map((it) => (
              <span key={it.label} className="flex items-center gap-1 text-xs">
                <i className="inline-block w-3 h-3 rounded-full" style={{ background: it.color }} />{it.label}
              </span>
            ))}
            {mode === 'total' && <span className="text-xs text-muted-foreground">虚线 = 被动 · 双圈 = 同名粘合</span>}
          </div>
          <div className="text-[11px] text-muted-foreground bg-background/80 rounded px-2 py-0.5 w-fit">
            {editable
              ? '双击空白 = 新建状态 · 连线模式 = 点起点再点终点 · 点连线/状态后用「删除选中」移除 · 一切修改都写回左栏事件库'
              : '总超图是合并视图，只读；要修改请切到某个单维度图'}
            {' · 按住空白拖拽 = 平移 · Ctrl+滚轮 = 缩放'}
          </div>
        </div>
      </div>

      {/* 连线后的归属选择：挂到已有事件，还是新建一条事件 */}
      {chooser && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 w-[380px] bg-card border rounded-lg shadow-lg p-3">
          <div className="text-sm font-bold mb-2">
            连线：{chooser.from} → {chooser.to}
          </div>
          <div className="text-xs text-muted-foreground mb-1">挂到已有事件（该事件会多出这条状态变化）：</div>
          <div className="max-h-40 overflow-auto space-y-1 mb-2">
            {candidates.length === 0 && <div className="text-xs text-muted-foreground">（还没有{ENTITY_NAMES[props.dimOwner ?? 'player']}的事件）</div>}
            {candidates.map((e) => (
              <button key={e.id} onClick={() => pickEvent(e.id)}
                className="w-full text-left px-2 py-1 border rounded text-xs hover:bg-muted flex items-center gap-1.5">
                <span className="font-medium">{e.name}</span>
                <span className={`text-[10px] px-1 rounded-full text-white ${e.trigger === '主动' ? 'bg-blue-600' : 'bg-orange-600'}`}>{e.trigger}</span>
                <span className="text-[10px] text-muted-foreground ml-auto">已有 {e.effects.length} 条变化</span>
              </button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground mb-1">或者新建一条事件：</div>
          <div className="flex gap-1">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新事件名"
              className="flex-1 border rounded px-2 py-1 text-sm bg-background"
              onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) pickEvent(null); }} />
            <button onClick={() => pickEvent(null)} disabled={!newName.trim()}
              className="px-2 py-1 rounded bg-primary text-primary-foreground text-sm disabled:opacity-40">
              新建
            </button>
          </div>
          <button onClick={() => { setChooser(null); setNewName(''); }}
            className="mt-2 w-full px-2 py-1 border rounded text-xs hover:bg-muted">取消</button>
        </div>
      )}

      <svg width={layout.width * scale} height={layout.height * scale}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="cursor-grab"
        onClick={() => { if (panSuppress.current) { panSuppress.current = false; return; } props.onSelectNode(null); setSelectedEdgeId(null); }}
        onDoubleClick={onDoubleClickBlank}
        onPointerDown={onPanStart}
        onPointerMove={onPanMove}
        onPointerUp={onPanEnd}
        onPointerCancel={onPanEnd}>
        {graph.edges.map(renderEdge)}
        {graph.nodes.map((n) => {
          const p = layout.pos.get(n.key);
          if (!p) return null;
          const stroke = n.declared ? nodeColor(n.dims) : '#94a3b8';
          const isSel = selNode === n.key;
          return (
            <g key={n.key}
              onClick={(e) => { e.stopPropagation(); if (linkMode) { onNodeClick(n.key); } else { setSelectedEdgeId(null); props.onSelectNode(n.key); } }}
              className="cursor-pointer">
              {n.glued && mode === 'total' && (
                <circle cx={p.x} cy={p.y} r={R + 6} fill="none" stroke="#d97706" strokeWidth={2} strokeDasharray="5 4" />
              )}
              <circle cx={p.x} cy={p.y} r={R}
                fill={linkFrom === n.key ? '#fbbf24' : isSel ? '#fef3c7' : '#ffffff'}
                stroke={isSel ? '#f59e0b' : stroke} strokeWidth={isSel ? 4 : 3}
                strokeDasharray={n.declared ? undefined : '5 4'} />
              <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize={n.name.length > 5 ? 11 : 13} fontWeight={600}
                fill="#0f172a" className="pointer-events-none select-none">
                {n.name.length > 7 ? n.name.slice(0, 7) : n.name}
              </text>
              {n.isStart && (
                <g className="pointer-events-none">
                  <circle cx={p.x - R * 0.75} cy={p.y - R * 0.75} r={10} fill="#16a34a" stroke="#ffffff" strokeWidth={1.5} />
                  <text x={p.x - R * 0.75} y={p.y - R * 0.75 + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#ffffff">起</text>
                </g>
              )}
              <title>{`${n.name}${n.glued ? `\n同名粘合：出现在 ${n.dims.map((d) => sc.dimensions.find((x) => x.id === d)?.name ?? d).join('、')} 中` : ''}${n.isStart ? '\n起始状态' : ''}${n.declared ? '' : '\n（未在维度里正式声明）'}`}</title>
            </g>
          );
        })}
        {graph.nodes.length === 0 && (
          <text x={320} y={200} textAnchor="middle" fontSize={14} fill="#94a3b8">
            还没有内容：双击空白新建状态，或在左侧事件库里新建事件
          </text>
        )}
      </svg>
    </div>
  );
}
