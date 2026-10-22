// 事件库面板：整个应用的"数据源"界面
// 卡片列表 + 搜索 + 按触发方式/维度筛选；每张卡片一眼看清：怎么触发、要什么前提、改哪些状态
import { useMemo, useState } from 'react';
import type { EntityKind, QiyuEvent, Scenario2 } from '@/types/model2';
import { ENTITY_NAMES } from '@/types/model2';
import { dimNameOf, eventTouchesDimension } from '@/lib/derive2';

// 三种实体的徽章配色：角色=绿、球=天蓝、球门=琥珀
const OWNER_BADGE: Record<EntityKind, string> = {
  player: 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300',
  ball: 'bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300',
  goal: 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300',
};

interface Props {
  sc: Scenario2;
  selectedEventId: string | null;
  onSelect: (id: string | null) => void;
  onNew: () => void;
  onEdit: (ev: QiyuEvent) => void;
  onDuplicate: (ev: QiyuEvent) => void;
  onDelete: (ev: QiyuEvent) => void;
}

export default function EventLibrary2({ sc, selectedEventId, onSelect, onNew, onEdit, onDuplicate, onDelete }: Props) {
  const [q, setQ] = useState('');
  const [triggerFilter, setTriggerFilter] = useState<'全部' | '主动' | '被动'>('全部');
  const [dimFilter, setDimFilter] = useState<string>('');

  const filtered = useMemo(() => {
    return sc.events.filter((ev) => {
      if (triggerFilter !== '全部' && ev.trigger !== triggerFilter) return false;
      if (dimFilter && !eventTouchesDimension(ev, dimFilter)) return false;
      if (q && !(`${ev.name}${ev.note}${ev.condition}`.includes(q))) return false;
      return true;
    });
  }, [sc.events, q, triggerFilter, dimFilter]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b space-y-2">
        <button onClick={onNew}
          className="w-full py-1.5 rounded bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
          ＋ 新建事件
        </button>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索事件名 / 说明…"
          className="w-full border rounded px-2 py-1 text-sm bg-background" />
        <div className="flex gap-1">
          {(['全部', '主动', '被动'] as const).map((t) => (
            <button key={t} onClick={() => setTriggerFilter(t)}
              className={`flex-1 px-1 py-0.5 rounded text-xs border ${triggerFilter === t ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
              {t}
            </button>
          ))}
        </div>
        <select value={dimFilter} onChange={(e) => setDimFilter(e.target.value)}
          className="w-full border rounded px-2 py-1 text-sm bg-background">
          <option value="">全部维度</option>
          {sc.dimensions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-2">
        {filtered.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6">
            {sc.events.length === 0 ? '事件库是空的，点上面「新建事件」开始' : '没有符合筛选条件的事件'}
          </div>
        )}
        {filtered.map((ev) => {
          const isSel = ev.id === selectedEventId;
          return (
            <div key={ev.id}
              onClick={() => onSelect(isSel ? null : ev.id)}
              className={`border rounded-lg p-2 cursor-pointer transition-colors ${isSel ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30' : 'hover:bg-muted/60 bg-card'}`}>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-bold text-sm">{ev.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${OWNER_BADGE[ev.owner]}`}>
                  {ENTITY_NAMES[ev.owner]}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full text-white ${ev.trigger === '主动' ? 'bg-blue-600' : 'bg-orange-600'}`}>
                  {ev.trigger}
                </span>
                {ev.affectsOthers && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900 text-rose-700 dark:text-rose-300">作用于对方</span>
                )}
                {ev.trigger === '被动' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700">
                    {ev.listen.length > 0 ? `监听 ${ev.listen.join('、')}` : '持续检测'}
                  </span>
                )}
                {ev.professions.length > 0 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300">
                    {ev.professions.map((id) => sc.professions.find((p) => p.id === id)?.name ?? id).join('、')}
                  </span>
                )}
              </div>
              {ev.preStates.length > 0 && (
                <div className="text-[11px] text-muted-foreground mt-1">
                  前提：{ev.preStates.map((p) => `${dimNameOf(sc, p.dimension)}${p.not ? '≠' : '='}${p.state}`).join('；')}
                </div>
              )}
              {ev.condition && <div className="text-[11px] text-muted-foreground mt-0.5">条件：{ev.condition}</div>}
              {ev.effects.length > 0 && (
                <div className="text-[11px] mt-0.5 space-y-0">
                  {ev.effects.slice(0, 3).map((f, i) => (
                    <div key={i}>{dimNameOf(sc, f.dimension)}：{f.from} → {f.to}</div>
                  ))}
                  {ev.effects.length > 3 && <div className="text-muted-foreground">…共 {ev.effects.length} 条状态变化</div>}
                </div>
              )}
              {ev.effects.length === 0 && <div className="text-[11px] text-slate-500 mt-0.5">（纯数值/纯信号事件，不上图）</div>}
              {ev.numeric.length > 0 && (
                <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-0.5">
                  数值：{ev.numeric.map((n) => `${n.kind}${n.value}`).join('；')}
                </div>
              )}
              <div className="flex gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => onEdit(ev)} className="px-2 py-0.5 border rounded text-[11px] hover:bg-muted">编辑</button>
                <button onClick={() => onDuplicate(ev)} className="px-2 py-0.5 border rounded text-[11px] hover:bg-muted">复制</button>
                <button onClick={() => onDelete(ev)} className="px-2 py-0.5 border rounded text-[11px] text-red-600 hover:bg-red-50 dark:hover:bg-red-950">删除</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="p-2 border-t text-[11px] text-muted-foreground">
        共 {sc.events.length} 条事件（主动 {sc.events.filter((e) => e.trigger === '主动').length} · 被动 {sc.events.filter((e) => e.trigger === '被动').length}）
      </div>
    </div>
  );
}
