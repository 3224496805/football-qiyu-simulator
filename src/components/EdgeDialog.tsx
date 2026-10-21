import { useEffect, useState } from 'react';
import type { DomainEdge, SkillTemplate } from '@/types/model';

interface Props {
  edge: DomainEdge | null;
  fromName: string;
  toName: string;
  skills: SkillTemplate[];
  onSave: (edge: DomainEdge) => void;
  onClose: () => void;
}

export default function EdgeDialog({ edge, fromName, toName, skills, onSave, onClose }: Props) {
  const [form, setForm] = useState<DomainEdge | null>(edge);

  useEffect(() => setForm(edge), [edge]);
  if (!form) return null;

  const set = <K extends keyof DomainEdge>(k: K, v: DomainEdge[K]) => setForm({ ...form, [k]: v });
  const setP = (k: keyof DomainEdge['params'], v: number) =>
    setForm({ ...form, params: { ...form.params, [k]: v } });

  const applySkill = (id: string) => {
    const sk = skills.find((s) => s.id === id);
    if (!sk) { set('skillKind', undefined); return; }
    set('skillKind', sk.kind);
    setP('cooldown', sk.cooldown);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-[480px] p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-lg">编辑事件（转换边）</h3>
        <p className="text-sm text-muted-foreground">{fromName} → {toName}</p>

        <label className="block text-sm">
          事件名
          <input className="mt-1 w-full border rounded px-2 py-1 bg-background" value={form.event}
            onChange={(e) => set('event', e.target.value)} />
        </label>

        <label className="block text-sm">
          条件（千星沙盒事件节点给出）
          <textarea className="mt-1 w-full border rounded px-2 py-1 bg-background" rows={2} value={form.condition}
            onChange={(e) => set('condition', e.target.value)} />
        </label>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <label>基础优先级
            <input type="number" className="mt-1 w-full border rounded px-2 py-1 bg-background" value={form.params.basePriority}
              onChange={(e) => setP('basePriority', +e.target.value)} />
          </label>
          <label>冷却 tick
            <input type="number" className="mt-1 w-full border rounded px-2 py-1 bg-background" value={form.params.cooldown}
              onChange={(e) => setP('cooldown', +e.target.value)} />
          </label>
          <label>结构权重
            <input type="number" step={0.1} className="mt-1 w-full border rounded px-2 py-1 bg-background" value={form.params.structWeight}
              onChange={(e) => setP('structWeight', +e.target.value)} />
          </label>
        </div>

        <div className="flex gap-4 text-sm items-center">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={form.isHyper} onChange={(e) => set('isHyper', e.target.checked)} />
            多实体联合事件（超边）
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={form.affectsOthers} onChange={(e) => set('affectsOthers', e.target.checked)} />
            影响其他实体
          </label>
        </div>

        <label className="block text-sm">
          挂载技能模板（未接入游戏，仅标记）
          <select className="mt-1 w-full border rounded px-2 py-1 bg-background"
            value={skills.find((s) => s.kind === form.skillKind)?.id ?? ''}
            onChange={(e) => applySkill(e.target.value)}>
            <option value="">（无）</option>
            {skills.map((s) => <option key={s.id} value={s.id}>{s.name}（{s.kind === 'damage' ? '伤害' : '位移'}）</option>)}
          </select>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button className="px-4 py-1 border rounded" onClick={onClose}>取消</button>
          <button className="px-4 py-1 bg-primary text-primary-foreground rounded" onClick={() => { onSave(form); onClose(); }}>保存</button>
        </div>
      </div>
    </div>
  );
}
