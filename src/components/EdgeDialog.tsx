import { useEffect, useState } from 'react';
import type { DomainEdge, Profession, SkillKind, SkillTemplate } from '@/types/model';
import { SKILL_KIND_NAMES } from '@/types/model';
import { metersToCells } from '@/lib/defaultScenario';

interface Props {
  edge: DomainEdge | null;
  fromName: string;
  toName: string;
  skills: SkillTemplate[];
  professions: Profession[];
  showProfessions: boolean; // 仅角色实体逻辑域可限定职业
  onSave: (edge: DomainEdge) => void;
  onSkillsChange: (skills: SkillTemplate[]) => void; // 事件编辑栏内可直接新建技能模板
  onClose: () => void;
}

export default function EdgeDialog({ edge, fromName, toName, skills, professions, showProfessions, onSave, onSkillsChange, onClose }: Props) {
  const [form, setForm] = useState<DomainEdge | null>(edge);
  const [newKind, setNewKind] = useState<SkillKind>('damage');

  useEffect(() => setForm(edge), [edge]);
  if (!form) return null;

  const set = <K extends keyof DomainEdge>(k: K, v: DomainEdge[K]) => setForm({ ...form, [k]: v });
  const setP = (k: keyof DomainEdge['params'], v: number) =>
    setForm({ ...form, params: { ...form.params, [k]: v } });

  const boundSkill = skills.find((s) => s.id === form.skillId)
    ?? (form.skillKind ? skills.find((s) => s.kind === form.skillKind) : undefined);

  const applySkill = (id: string) => {
    const sk = skills.find((s) => s.id === id);
    if (!sk) { set('skillId', undefined); set('skillKind', undefined); return; }
    set('skillId', sk.id);
    set('skillKind', sk.kind);
    setP('cooldown', sk.cooldown);
  };

  // 在事件编辑栏内新建技能模板并绑定（技能模板已并入事件编辑）
  const createSkill = () => {
    const names: Record<SkillKind, string> = { damage: '新伤害技能', displacement: '新位移技能', signal: '新信号技能', aux: '新辅助技能' };
    const sk: SkillTemplate = {
      id: `sk_${Date.now()}`,
      name: names[newKind],
      kind: newKind,
      damage: newKind === 'damage' ? 15 : undefined,
      displacement: newKind === 'displacement' ? 12 : undefined,
      chargeMax: newKind === 'signal' ? 100 : undefined,
      effectValue: newKind === 'aux' ? 20 : undefined,
      cooldown: newKind === 'signal' ? 0 : 3,
      range: newKind === 'signal' ? 0 : 2,
      note: '',
    };
    onSkillsChange([...skills, sk]);
    set('skillId', sk.id);
    set('skillKind', sk.kind);
    setP('cooldown', sk.cooldown);
  };

  // 同步位移距离 ↔ 网格单位：把所选位移技能的格数写入条件
  const syncGridUnits = () => {
    if (form.skillKind !== 'displacement') return;
    const sk = skills.find((s) => s.id === form.skillId) ?? skills.find((s) => s.kind === 'displacement' && s.displacement !== undefined);
    if (!sk?.displacement) return;
    const cells = +metersToCells(sk.displacement).toFixed(1);
    const tag = `位移 ${sk.displacement}m = ${cells} 格（1 格=12m）`;
    set('condition', form.condition.includes('格（1 格=12m）')
      ? form.condition.replace(/位移 [^）]*格（1 格=12m）/, tag)
      : `${form.condition}（${tag}）`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-xl w-[480px] p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-lg">事件编辑栏</h3>
        <p className="text-sm text-muted-foreground">
          状态变化：<b>{fromName} → {toName}</b>　（事件 = 状态变化 + 状态前提 + 主动技能）
        </p>

        <label className="block text-sm">
          事件名
          <input className="mt-1 w-full border rounded px-2 py-1 bg-background" value={form.event}
            onChange={(e) => set('event', e.target.value)} />
        </label>

        <label className="block text-sm">
          状态前提（千星沙盒事件节点给出）
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

        {showProfessions && professions.length > 0 && (
          <div className="text-sm">
            <div className="mb-1">职业限定（同职业共享该事件；都不勾 = 全职业通用）</div>
            <div className="flex gap-3 flex-wrap">
              {professions.map((p) => {
                const cur = form.professionIds ?? [];
                const on = cur.includes(p.id);
                return (
                  <label key={p.id} className="flex items-center gap-1">
                    <input type="checkbox" checked={on}
                      onChange={(e) => set('professionIds', e.target.checked ? [...cur, p.id] : cur.filter((x) => x !== p.id))} />
                    {p.name}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="text-sm border rounded p-2 space-y-2 bg-muted/30">
          <div className="font-medium">主动技能（技能模板已并入事件编辑栏）</div>
          <select className="w-full border rounded px-2 py-1 bg-background"
            value={form.skillId ?? ''}
            onChange={(e) => applySkill(e.target.value)}>
            <option value="">（无主动技能）</option>
            {skills.map((s) => <option key={s.id} value={s.id}>{s.name}（{SKILL_KIND_NAMES[s.kind]}）</option>)}
          </select>
          {boundSkill && (
            <div className="text-xs text-muted-foreground">
              {boundSkill.kind === 'damage' && <>伤害 {boundSkill.damage} · 范围 {boundSkill.range}m</>}
              {boundSkill.kind === 'displacement' && <>位移 {boundSkill.displacement}m ≈ {+(metersToCells(boundSkill.displacement ?? 0)).toFixed(1)} 格</>}
              {boundSkill.kind === 'signal' && <>信号类：蓄能上限 {boundSkill.chargeMax}（不直接改状态，持续发出信号/充能）</>}
              {boundSkill.kind === 'aux' && <>辅助类：效果值 {boundSkill.effectValue}（治疗/护盾等）</>}
              {' '}· 冷却 {boundSkill.cooldown} tick{boundSkill.note ? ` · ${boundSkill.note}` : ''}
            </div>
          )}
          <div className="flex gap-2 items-center">
            <select className="border rounded px-2 py-1 bg-background flex-1" value={newKind}
              onChange={(e) => setNewKind(e.target.value as SkillKind)}>
              {(Object.keys(SKILL_KIND_NAMES) as SkillKind[]).map((k) => (
                <option key={k} value={k}>{SKILL_KIND_NAMES[k]}类</option>
              ))}
            </select>
            <button type="button" onClick={createSkill}
              className="px-3 py-1 border rounded text-xs hover:bg-muted whitespace-nowrap">
              ＋新建模板并绑定
            </button>
          </div>
        </div>

        {form.skillKind === 'displacement' && (
          <button type="button" onClick={syncGridUnits}
            className="w-full px-3 py-1 border rounded text-xs text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950">
            ⟳ 同步位移距离到网格单位（写入条件，1 格 = 12m）
          </button>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button className="px-4 py-1 border rounded" onClick={onClose}>取消</button>
          <button className="px-4 py-1 bg-primary text-primary-foreground rounded" onClick={() => { onSave(form); onClose(); }}>保存</button>
        </div>
      </div>
    </div>
  );
}
