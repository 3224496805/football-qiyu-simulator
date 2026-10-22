import type { Scenario, SkillKind, SkillTemplate } from '@/types/model';
import { SKILL_KIND_NAMES } from '@/types/model';
import { metersToCells } from '@/lib/defaultScenario';

interface Props {
  scenario: Scenario;
  onChange: (skills: SkillTemplate[]) => void;
}

let skSeq = 0;

const KIND_STYLE: Record<SkillKind, string> = {
  damage: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  displacement: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  signal: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  aux: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
};

export default function SkillPanel({ scenario, onChange }: Props) {
  const skills = scenario.skills;

  const add = (kind: SkillKind) => {
    onChange([...skills, {
      id: `sk_${Date.now()}_${skSeq++}`,
      name: `新${SKILL_KIND_NAMES[kind]}技能`,
      kind,
      damage: kind === 'damage' ? 15 : undefined,
      displacement: kind === 'displacement' ? 12 : undefined,
      chargeMax: kind === 'signal' ? 100 : undefined,
      effectValue: kind === 'aux' ? 20 : undefined,
      cooldown: kind === 'signal' ? 0 : 3,
      range: kind === 'signal' ? 0 : 2,
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
        <span className={`text-xs px-2 py-0.5 rounded ${KIND_STYLE[s.kind]}`}>
          {SKILL_KIND_NAMES[s.kind]}技能
        </span>
        <button onClick={() => remove(s.id)} className="text-muted-foreground hover:text-red-600">✕</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {s.kind === 'damage' && (
          <label>伤害大小
            <input type="number" className="mt-0.5 w-full border rounded px-2 py-1 bg-background" value={s.damage ?? 0}
              onChange={(e) => update(s.id, { damage: +e.target.value })} />
          </label>
        )}
        {s.kind === 'displacement' && (
          <label>位移距离（米）
            <input type="number" step={12} className="mt-0.5 w-full border rounded px-2 py-1 bg-background" value={s.displacement ?? 0}
              onChange={(e) => update(s.id, { displacement: +e.target.value })} />
            <span className="text-xs text-muted-foreground">= {+(metersToCells(s.displacement ?? 0)).toFixed(1)} 格（1 格 = 12m）</span>
          </label>
        )}
        {s.kind === 'signal' && (
          <label>蓄能上限
            <input type="number" className="mt-0.5 w-full border rounded px-2 py-1 bg-background" value={s.chargeMax ?? 0}
              onChange={(e) => update(s.id, { chargeMax: +e.target.value })} />
            <span className="text-xs text-muted-foreground">信号类：充能到上限后触发后续事件</span>
          </label>
        )}
        {s.kind === 'aux' && (
          <label>效果值
            <input type="number" className="mt-0.5 w-full border rounded px-2 py-1 bg-background" value={s.effectValue ?? 0}
              onChange={(e) => update(s.id, { effectValue: +e.target.value })} />
            <span className="text-xs text-muted-foreground">辅助类：治疗/护盾等效果量</span>
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
          <h3 className="font-bold text-lg">技能事件模板库</h3>
          <p className="text-sm text-muted-foreground">四类模板：伤害 / 位移 / 信号（蓄力等）/ 辅助（治疗等）；已并入图编辑的事件编辑栏，可直接在边对话框中新建并绑定。</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => add('damage')} className="px-3 py-1 border rounded text-sm bg-red-50 hover:bg-red-100 dark:bg-red-950">+ 伤害</button>
          <button onClick={() => add('displacement')} className="px-3 py-1 border rounded text-sm bg-blue-50 hover:bg-blue-100 dark:bg-blue-950">+ 位移</button>
          <button onClick={() => add('signal')} className="px-3 py-1 border rounded text-sm bg-amber-50 hover:bg-amber-100 dark:bg-amber-950">+ 信号</button>
          <button onClick={() => add('aux')} className="px-3 py-1 border rounded text-sm bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950">+ 辅助</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {skills.map(card)}
      </div>
    </div>
  );
}
