// 检查器（右栏）：
//   选中事件 → 完整的中文详情 + 编辑按钮
//   选中状态 → 它出现在哪些维度、哪些事件让它进来/出去（点事件名可跳转）
//   都没选   → 方案体检：提醒、画不上图的纯数值事件、整体统计
import type { DerivedGraph } from '@/lib/derive2';
import { describeEvent } from '@/lib/describe2';
import type { Scenario2 } from '@/types/model2';

export type Selection = { kind: 'event' | 'node'; id: string } | null;

interface Props {
  sc: Scenario2;
  graph: DerivedGraph;
  selection: Selection;
  onSelectEvent: (id: string) => void;
  onEditEvent: (ev: Scenario2['events'][number]) => void;
}

export default function Inspector2({ sc, graph, selection, onSelectEvent, onEditEvent }: Props) {
  // ---------- 选中事件 ----------
  if (selection?.kind === 'event') {
    const ev = sc.events.find((e) => e.id === selection.id);
    if (!ev) return <div className="p-3 text-sm text-muted-foreground">事件已被删除</div>;
    return (
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-bold">{ev.name}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full text-white ${ev.trigger === '主动' ? 'bg-blue-600' : 'bg-orange-600'}`}>
            {ev.trigger}
          </span>
          <button onClick={() => onEditEvent(ev)} className="ml-auto px-2 py-0.5 border rounded text-xs hover:bg-muted">编辑</button>
        </div>
        <pre className="whitespace-pre-wrap text-xs leading-relaxed bg-muted/50 border rounded p-2 font-sans">
          {describeEvent(sc, ev)}
        </pre>
      </div>
    );
  }

  // ---------- 选中状态 ----------
  if (selection?.kind === 'node') {
    const node = graph.nodes.find((n) => n.key === selection.id);
    if (!node) return <div className="p-3 text-sm text-muted-foreground">状态已不存在</div>;
    const inEdges = graph.edges.filter((e) => e.to === node.key);
    const outEdges = graph.edges.filter((e) => e.from === node.key);
    const chip = (eventId: string, label: string, dir: string) => (
      <button key={eventId + dir + label} onClick={() => onSelectEvent(eventId)}
        className="px-2 py-0.5 border rounded-full text-xs hover:bg-amber-100 dark:hover:bg-amber-900">
        {label}
      </button>
    );
    return (
      <div className="p-3 space-y-3">
        <div className="font-bold">状态「{node.name}」</div>
        <div className="text-xs space-y-1">
          <div>出现维度：{node.dims.map((d) => sc.dimensions.find((x) => x.id === d)?.name ?? d).join('、')}</div>
          {node.glued && <div className="text-amber-600 dark:text-amber-400">跨维度同名粘合状态</div>}
          {node.isStart && <div className="text-green-600 dark:text-green-400">起始状态</div>}
          {!node.declared && <div className="text-slate-500">（只在事件里出现，还没在维度里正式声明）</div>}
        </div>
        <div>
          <div className="text-xs font-bold mb-1">让它发生的事件（{inEdges.length}）</div>
          <div className="flex gap-1 flex-wrap">
            {[...new Map(inEdges.map((e) => [e.eventId, e])).values()].map((e) => chip(e.eventId, e.event, 'in'))}
            {inEdges.length === 0 && <span className="text-xs text-muted-foreground">无</span>}
          </div>
        </div>
        <div>
          <div className="text-xs font-bold mb-1">从它出发的事件（{outEdges.length}）</div>
          <div className="flex gap-1 flex-wrap">
            {[...new Map(outEdges.map((e) => [e.eventId, e])).values()].map((e) => chip(e.eventId, e.event, 'out'))}
            {outEdges.length === 0 && <span className="text-xs text-muted-foreground">无</span>}
          </div>
        </div>
      </div>
    );
  }

  // ---------- 未选中：方案体检 ----------
  const active = sc.events.filter((e) => e.trigger === '主动').length;
  const passive = sc.events.length - active;
  return (
    <div className="p-3 space-y-3">
      <div className="text-xs text-muted-foreground leading-relaxed">
        点左边的事件卡片，或点图上的状态/连线，这里会显示详情。
      </div>
      <div className="grid grid-cols-2 gap-2 text-center">
        {[
          ['事件', `${sc.events.length}`],
          ['主动 / 被动', `${active} / ${passive}`],
          ['维度', `${sc.dimensions.length}`],
          ['图上状态', `${graph.nodes.length}`],
        ].map(([k, v]) => (
          <div key={k} className="border rounded p-2">
            <div className="text-lg font-bold">{v}</div>
            <div className="text-[11px] text-muted-foreground">{k}</div>
          </div>
        ))}
      </div>
      {graph.warnings.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded p-2">
          <div className="text-xs font-bold text-amber-700 dark:text-amber-300 mb-1">⚠ 体检提醒（{graph.warnings.length}）</div>
          <ul className="list-disc ml-4 text-[11px] space-y-1">
            {graph.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      {graph.pureNumeric.length > 0 && (
        <div>
          <div className="text-xs font-bold mb-1">画不上图的事件（没有状态变化，{graph.pureNumeric.length}）</div>
          <div className="flex gap-1 flex-wrap">
            {graph.pureNumeric.map((e) => (
              <button key={e.id} onClick={() => onSelectEvent(e.id)}
                className="px-2 py-0.5 border rounded-full text-xs hover:bg-muted">{e.name}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
