import { useState } from 'react';
import type { Scenario, SkillKind, SkillTemplate } from '@/types/model';
import { SKILL_KIND_NAMES } from '@/types/model';
import { metersToCells } from '@/lib/defaultScenario';

interface Props {
  scenario: Scenario;
  onChange: (skills: SkillTemplate[]) => void;
  onLocate: (gid: string) => void; // 跳转到图编辑并选中某张逻辑图
}

let skSeq = 0;

const KIND_STYLE: Record<SkillKind, string> = {
  impact: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  signal: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  aux: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  damage: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  displacement: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
};

export default function SkillPanel({ scenario, onChange, onLocate }: Props) {
  const skills = scenario.skills;
  const [filter, setFilter] = useState('');

  // 图内全部事件（边）：直接从逻辑图派生，与图编辑天然同步
  const allEdges = Object.entries(scenario.graphs).flatMap(([gid, g]) =>
    g.edges.map((e) => ({
      gid, gname: g.name, edge: e,
      fromName: g.nodes.find((n) => n.id === e.from)?.name ?? '?',
      toName: g.nodes.find((n) => n.id === e.to)?.name ?? '?',
      skillName: scenario.skills.find((s) => s.id === e.skillId)?.name,
    })));

  const trigLabel = (e: (typeof allEdges)[number]['edge']) =>
    (e.listenEvents?.length ?? 0) > 0
      ? (e.trigger === 'passive' ? `仅级联·监听 ${e.listenEvents!.join('/')}` : `主动+级联·监听 ${e.listenEvents!.join('/')}`)
      : '主动';

  const add = (kind: SkillKind) => {
    onChange([...skills, {
      id: `sk_${Date.now()}_${skSeq++}`,
      name: `新${SKILL_KIND_NAMES[kind]}技能`,
      kind,
      damage: kind === 'impact' ? 15 : undefined,
      displacement: kind === 'impact' ? 12 : undefined,
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
        {s.kind === 'impact' && (
          <>
            <label>伤害
              <input type="number" className="mt-0.5 w-full border rounded px-2 py-1 bg-background" value={s.damage ?? 0}
                onChange={(e) => update(s.id, { damage: +e.target.value })} />
            </label>
            <label>位移（米）
              <input type="number" step={12} className="mt-0.5 w-full border rounded px-2 py-1 bg-background" value={s.displacement ?? 0}
                onChange={(e) => update(s.id, { displacement: +e.target.value })} />
              <span className="text-xs text-muted-foreground">= {+(metersToCells(s.displacement ?? 0)).toFixed(1)} 格（1 格 = 12m）</span>
            </label>
          </>
        )}
        {(s.kind === 'damage' || s.kind === 'displacement') && (
          <label>旧版数值
            <input type="number" className="mt-0.5 w-full border rounded px-2 py-1 bg-background" value={(s.damage ?? s.displacement) ?? 0}
              onChange={(e) => update(s.id, s.kind === 'damage' ? { damage: +e.target.value } : { displacement: +e.target.value })} />
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
      {(() => {
        const bound = allEdges.filter((b) => b.edge.skillId === s.id);
        if (bound.length === 0) return <div className="text-xs text-muted-foreground">未绑定任何逻辑图边</div>;
        return (
          <div className="text-xs border-t pt-1.5 space-y-0.5">
            <div className="text-muted-foreground">绑定 {bound.length} 条边（点击跳转图编辑）：</div>
            {bound.map((b) => (
              <button key={b.edge.id} onClick={() => onLocate(b.gid)}
                className="block w-full text-left px-1.5 py-0.5 rounded hover:bg-muted truncate">
                {b.gname} · {b.edge.event}（{b.fromName} → {b.toName}）
              </button>
            ))}
          </div>
        );
      })()}
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg">事件库</h3>
          <p className="text-sm text-muted-foreground">三类事件模板：冲击（伤害+位移合并）/ 信号（蓄力等）/ 辅助（治疗等）；事件 = 条件 + 执行的状态变化，支持主动触发与被动触发（监听其他事件，下一次判定加入队列）。已并入图编辑的事件编辑栏，可就地新建并绑定；下方可用 Kimi 生成新逻辑图。</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => add('impact')} className="px-3 py-1 border rounded text-sm bg-red-50 hover:bg-red-100 dark:bg-red-950">+ 冲击（伤害+位移）</button>
          <button onClick={() => add('signal')} className="px-3 py-1 border rounded text-sm bg-amber-50 hover:bg-amber-100 dark:bg-amber-950">+ 信号</button>
          <button onClick={() => add('aux')} className="px-3 py-1 border rounded text-sm bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950">+ 辅助</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {skills.map(card)}
      </div>

      <div className="border rounded p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="font-bold">图内事件总表（{allEdges.length} 条，与逻辑图实时同步）</h4>
          <input className="ml-auto border rounded px-2 py-1 text-xs bg-background w-52" placeholder="按事件名 / 图名筛选…"
            value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          事件 = 条件 + 执行的状态变化（超图边的限定描述）。本表由逻辑图直接派生——图编辑里改条件、改名、增删边都会即时反映在这里，无需手动同步。
        </p>
        <div className="space-y-1 max-h-96 overflow-auto">
          {allEdges
            .filter((b) => !filter || b.edge.event.includes(filter) || b.gname.includes(filter))
            .map((b) => (
              <div key={b.edge.id} className="flex items-center gap-2 text-xs border rounded px-2 py-1">
                <button onClick={() => onLocate(b.gid)} className="text-blue-600 hover:underline shrink-0">{b.gname}</button>
                <span className="font-medium shrink-0">{b.edge.event}</span>
                <span className="text-muted-foreground shrink-0">{b.fromName} → {b.toName}</span>
                <span className={`px-1.5 rounded shrink-0 ${b.edge.trigger === 'passive' ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'}`}>
                  {trigLabel(b.edge)}
                </span>
                {b.skillName && <span className="px-1.5 rounded bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300 shrink-0">{b.skillName}</span>}
                <span className="text-muted-foreground truncate" title={b.edge.condition}>{b.edge.condition}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
