import type { Scenario, SkillTemplate } from '@/types/model';

interface Props {
  scenario: Scenario;
  onChange: (skills: SkillTemplate[]) => void;
}

let skSeq = 0;

export default function SkillPanel({ scenario, onChange }: Props) {
  const skills = scenario.skills;

  const add = (kind: SkillTemplate['kind']) => {
    onChange([...skills, {
      id: `sk_${Date.now()}_${skSeq++}`,
      name: kind === 'damage' ? '新伤害技能' : '新位移技能',
      kind,
      damage: kind === 'damage' ? 15 : undefined,
      displacement: kind === 'displacement' ? 5 : undefined,
      cooldown: 3,
      range: 2,
      note: '',
    }]);
  };

  const update = (id: string, patch: Partial<SkillTemplate>) =>
    onChange(skills.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const remove = (id: string) => onChange(skills.filter((s) => s.id !== id));

  const card = (s: SkillTemplate) => (
    <div key={s.id} className="border rounded p-3 text-sm space-y-2 bg-card">
      <div className="flex items-center gap-2">
        <input className="font-medium border rounded px-2 py-1 flex-1 bg-background" value={s.name}
          onChange={(e) => update(s.id, { name: e.target.value })} />
        <span className={`text-xs px-2 py-0.5 rounded ${s.kind === 'damage' ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'}`}>
          {s.kind === 'damage' ? '伤害事件' : '位移事件'}
        </span>
        <button onClick={() => remove(s.id)} className="text-muted-foreground hover:text-red-600">✕</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {s.kind === 'damage' ? (
          <label>伤害大小
            <input type="number" className="mt-0.5 w-full border rounded px-2 py-1 bg-background" value={s.damage ?? 0}
              onChange={(e) => update(s.id, { damage: +e.target.value })} />
          </label>
        ) : (
          <label>位移距离
            <input type="number" className="mt-0.5 w-full border rounded px-2 py-1 bg-background" value={s.displacement ?? 0}
              onChange={(e) => update(s.id, { displacement: +e.target.value })} />
          </label>
        )}
        <label>冷却 tick
          <input type="number" className="mt-0.5 w-full border rounded px-2 py-1 bg-background" value={s.cooldown}
            onChange={(e) => update(s.id, { cooldown: +e.target.value })} />
        </label>
        <label>作用范围
          <input type="number" step={0.5} className="mt-0.5 w-full border rounded px-2 py-1 bg-background" value={s.range ?? 0}
            onChange={(e) => update(s.id, { range: +e.target.value })} />
        </label>
      </div>
      <input className="w-full border rounded px-2 py-1 text-xs bg-background" placeholder="备注（触发方式、限制等）" value={s.note ?? ''}
        onChange={(e) => update(s.id, { note: e.target.value })} />
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg">技能事件模板（自由设计，暂未接入游戏）</h3>
          <p className="text-sm text-muted-foreground">在图编辑中打开事件编辑对话框可将模板挂载到转换边上。</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => add('damage')} className="px-3 py-1 border rounded text-sm bg-red-50 hover:bg-red-100 dark:bg-red-950">+ 伤害事件模板</button>
          <button onClick={() => add('displacement')} className="px-3 py-1 border rounded text-sm bg-blue-50 hover:bg-blue-100 dark:bg-blue-950">+ 位移事件模板</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {skills.map(card)}
      </div>
    </div>
  );
}
