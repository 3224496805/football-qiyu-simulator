import { useEffect, useState } from 'react';
import type { DomainGraph, StateNode } from '@/types/model';

interface Props {
  node: StateNode | null;
  graph: DomainGraph;
  onSave: (node: StateNode) => void;
  onClose: () => void;
}

// 状态编辑：名称 / 备注 / 时限（时限类型到期自动触发指定出边；不勾选 = 无限状态）
export default function NodeDialog({ node, graph, onSave, onClose }: Props) {
  const [form, setForm] = useState<StateNode | null>(node);

  useEffect(() => setForm(node ? { ...node } : null), [node]);
  if (!form) return null;

  const outEdges = graph.edges.filter((e) => e.from === form.id);
  const timed = form.timeLimit !== undefined;

  const setTL = (patch: Partial<NonNullable<StateNode['timeLimit']>>) =>
    setForm({ ...form, timeLimit: { ticks: 3, timeoutEvent: outEdges[0]?.event, ...form.timeLimit, ...patch } });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-[420px] p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-lg">编辑状态</h3>

        <label className="block text-sm">
          状态名（跨逻辑图同名状态将自动粘合）
          <input className="mt-1 w-full border rounded px-2 py-1 bg-background" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>

        <label className="block text-sm">
          备注
          <input className="mt-1 w-full border rounded px-2 py-1 bg-background" value={form.note ?? ''}
            onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </label>

        <div className="border rounded p-2 space-y-2 bg-muted/30 text-sm">
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" checked={timed}
              onChange={(e) => setForm({ ...form, timeLimit: e.target.checked ? { ticks: 3, timeoutEvent: outEdges[0]?.event } : undefined })} />
            时限状态（到期自动触发出边；不勾选 = 无限状态）
          </label>
          {timed && (
            <div className="grid grid-cols-2 gap-2">
              <label>时限（tick）
                <input type="number" min={1} className="mt-0.5 w-full border rounded px-2 py-1 bg-background"
                  value={form.timeLimit?.ticks ?? 3}
                  onChange={(e) => setTL({ ticks: Math.max(1, +e.target.value) })} />
              </label>
              <label>到期触发事件
                <select className="mt-0.5 w-full border rounded px-2 py-1 bg-background"
                  value={form.timeLimit?.timeoutEvent ?? ''}
                  onChange={(e) => setTL({ timeoutEvent: e.target.value })}>
                  <option value="">（未指定）</option>
                  {outEdges.map((e) => <option key={e.id} value={e.event}>{e.event}（→ {graph.nodes.find((n) => n.id === e.to)?.name ?? '?'}）</option>)}
                </select>
              </label>
            </div>
          )}
          {timed && outEdges.length === 0 && (
            <p className="text-xs text-amber-600">该状态没有出边：时限到期后无处可去，请先在图上为该状态添加出边。</p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="px-4 py-1 border rounded" onClick={onClose}>取消</button>
          <button className="px-4 py-1 bg-primary text-primary-foreground rounded" onClick={() => { onSave(form); onClose(); }}>保存</button>
        </div>
      </div>
    </div>
  );
}
