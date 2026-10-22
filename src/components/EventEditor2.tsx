// 事件编辑弹窗：一条事件的全部字段都在这里改
//   触发方式：主动（玩家操作从客户端发出）/ 被动（检测到状态变化后触发）
//   被动事件可勾选监听哪些事件；都不勾 = 持续检测
//   状态变化里写新的状态名，保存时会自动补进该维度的状态列表（不用先建状态再连线）
import { useEffect, useMemo, useState } from 'react';
import type { QiyuEvent, Scenario2 } from '@/types/model2';
import { ENTITY_KINDS, ENTITY_NAMES, NUMERIC_KINDS } from '@/types/model2';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  initial: QiyuEvent; // 打开时由外层给好的草稿（新建 = 空白事件）
  sc: Scenario2;
  onSave: (ev: QiyuEvent) => void;
  onClose: () => void;
}

export default function EventEditor2({ open, initial, sc, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<QiyuEvent>(initial);
  useEffect(() => { if (open) setDraft(JSON.parse(JSON.stringify(initial)) as QiyuEvent); }, [open, initial]);

  const otherEventNames = useMemo(
    () => [...new Set(sc.events.filter((e) => e.id !== draft.id).map((e) => e.name))],
    [sc.events, draft.id],
  );

  const set = <K extends keyof QiyuEvent>(k: K, v: QiyuEvent[K]) => setDraft({ ...draft, [k]: v });

  const firstDim = sc.dimensions[0]?.id ?? '';

  const save = () => {
    if (!draft.name.trim()) { alert('请给事件起个名字'); return; }
    const cleaned: QiyuEvent = {
      ...draft,
      name: draft.name.trim(),
      // 清掉空行：没填完整的行直接丢弃
      preStates: draft.preStates.filter((p) => p.dimension && p.state.trim()),
      effects: draft.effects.filter((f) => f.dimension && f.from.trim() && f.to.trim()),
      listen: draft.trigger === '被动' ? draft.listen : [],
    };
    onSave(cleaned);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{sc.events.some((e) => e.id === draft.id) ? '编辑事件' : '新建事件'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* 名称 + 触发方式 */}
          <div className="flex gap-3 flex-wrap">
            <label className="flex-1 min-w-[200px]">
              <span className="text-xs text-muted-foreground">事件名</span>
              <input value={draft.name} onChange={(e) => set('name', e.target.value)}
                className="w-full border rounded px-2 py-1 bg-background" placeholder="如：传球 / 掉球 / 受击" />
            </label>
            <div>
              <span className="text-xs text-muted-foreground">触发方式</span>
              <div className="flex gap-1 mt-0.5">
                {(['主动', '被动'] as const).map((t) => (
                  <button key={t} onClick={() => set('trigger', t)}
                    className={`px-3 py-1 rounded border ${draft.trigger === t ? (t === '主动' ? 'bg-blue-600 text-white border-blue-600' : 'bg-orange-600 text-white border-orange-600') : 'hover:bg-muted'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">这条事件属于谁</span>
              <div className="flex gap-1 mt-0.5">
                {ENTITY_KINDS.map((k) => (
                  <button key={k} onClick={() => set('owner', k)}
                    className={`px-3 py-1 rounded border ${draft.owner === k ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-muted'}`}>
                    {ENTITY_NAMES[k]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            主动 = 玩家操作从客户端发出；被动 = 检测到状态变化后触发（千星沙箱的「当……时」）。
            每个实体只能改自己的状态：想让球或对方球员跟着动，请另建一条「被动监听本事件」的事件。
          </p>

          {/* 监听（仅被动） */}
          {draft.trigger === '被动' && (
            <div className="border rounded p-2 bg-orange-50/50 dark:bg-orange-950/20">
              <div className="text-xs font-bold mb-1">监听哪些事件？（信号全局可达：被监听的事件执行后，本事件加入下一次判定）</div>
              <div className="flex gap-1 flex-wrap">
                {otherEventNames.length === 0 && <span className="text-xs text-muted-foreground">事件库里还没有别的事件</span>}
                {otherEventNames.map((n) => (
                  <button key={n}
                    onClick={() => set('listen', draft.listen.includes(n) ? draft.listen.filter((x) => x !== n) : [...draft.listen, n])}
                    className={`px-2 py-0.5 rounded-full border text-xs ${draft.listen.includes(n) ? 'bg-orange-600 text-white border-orange-600' : 'hover:bg-muted'}`}>
                    {n}
                  </button>
                ))}
              </div>
              <div className="text-[11px] text-muted-foreground mt-1">一个都不勾 = 持续检测（每次判定都检查前提是否满足）</div>
            </div>
          )}

          {/* 前提状态 */}
          <div>
            <div className="text-xs font-bold mb-1">前提状态（判定前必须满足；可跨维度，可没有）</div>
            {draft.preStates.map((p, i) => (
              <div key={i} className="flex gap-1 items-center mb-1 flex-wrap">
                <select value={p.dimension} onChange={(e) => {
                  const next = [...draft.preStates]; next[i] = { ...p, dimension: e.target.value }; set('preStates', next);
                }} className="border rounded px-1 py-0.5 bg-background">
                  {sc.dimensions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <button onClick={() => {
                  const next = [...draft.preStates]; next[i] = { ...p, not: !p.not }; set('preStates', next);
                }} className={`px-2 py-0.5 rounded border text-xs ${p.not ? 'bg-red-100 border-red-400 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-green-100 border-green-400 text-green-700 dark:bg-green-950 dark:text-green-300'}`}>
                  {p.not ? '不处于' : '处于'}
                </button>
                <input value={p.state} list={`dl-st-${p.dimension}`} placeholder="状态名"
                  onChange={(e) => {
                    const next = [...draft.preStates]; next[i] = { ...p, state: e.target.value }; set('preStates', next);
                  }} className="border rounded px-2 py-0.5 bg-background w-28" />
                <button onClick={() => set('preStates', draft.preStates.filter((_, j) => j !== i))}
                  className="text-red-600 px-1">✕</button>
              </div>
            ))}
            <button onClick={() => set('preStates', [...draft.preStates, { dimension: firstDim, state: '' }])}
              className="px-2 py-0.5 border border-dashed rounded text-xs text-muted-foreground hover:bg-muted">
              ＋添加前提状态
            </button>
          </div>

          {/* 状态变化 */}
          <div>
            <div className="text-xs font-bold mb-1">状态变化（执行后哪个维度 从哪状态 转到哪状态；同一维度写多行 = 从任一源状态出发都可以）</div>
            {draft.effects.map((f, i) => (
              <div key={i} className="flex gap-1 items-center mb-1 flex-wrap">
                <select value={f.dimension} onChange={(e) => {
                  const next = [...draft.effects]; next[i] = { ...f, dimension: e.target.value }; set('effects', next);
                }} className="border rounded px-1 py-0.5 bg-background">
                  {sc.dimensions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <input value={f.from} list={`dl-st-${f.dimension}`} placeholder="从状态"
                  onChange={(e) => {
                    const next = [...draft.effects]; next[i] = { ...f, from: e.target.value }; set('effects', next);
                  }} className="border rounded px-2 py-0.5 bg-background w-28" />
                <span>→</span>
                <input value={f.to} list={`dl-st-${f.dimension}`} placeholder="到状态"
                  onChange={(e) => {
                    const next = [...draft.effects]; next[i] = { ...f, to: e.target.value }; set('effects', next);
                  }} className="border rounded px-2 py-0.5 bg-background w-28" />
                <button onClick={() => set('effects', draft.effects.filter((_, j) => j !== i))}
                  className="text-red-600 px-1">✕</button>
              </div>
            ))}
            <button onClick={() => set('effects', [...draft.effects, { dimension: firstDim, from: '', to: '' }])}
              className="px-2 py-0.5 border border-dashed rounded text-xs text-muted-foreground hover:bg-muted">
              ＋添加状态变化
            </button>
            {draft.effects.length === 0 && (
              <div className="text-[11px] text-muted-foreground mt-1">不写状态变化 = 纯数值/纯信号事件，不会在图上出现</div>
            )}
          </div>

          {/* 数值效果 */}
          <div>
            <div className="text-xs font-bold mb-1">数值效果（可空：扣血/回血/位移/蓄能）</div>
            {draft.numeric.map((n, i) => (
              <div key={i} className="flex gap-1 items-center mb-1">
                <select value={n.kind} onChange={(e) => {
                  const next = [...draft.numeric]; next[i] = { ...n, kind: e.target.value as typeof n.kind }; set('numeric', next);
                }} className="border rounded px-1 py-0.5 bg-background">
                  {NUMERIC_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <input type="number" value={n.value} onChange={(e) => {
                  const next = [...draft.numeric]; next[i] = { ...n, value: +e.target.value }; set('numeric', next);
                }} className="border rounded px-2 py-0.5 bg-background w-24" />
                <button onClick={() => set('numeric', draft.numeric.filter((_, j) => j !== i))}
                  className="text-red-600 px-1">✕</button>
              </div>
            ))}
            <button onClick={() => set('numeric', [...draft.numeric, { kind: '扣血', value: 10 }])}
              className="px-2 py-0.5 border border-dashed rounded text-xs text-muted-foreground hover:bg-muted">
              ＋添加数值效果
            </button>
            {draft.numeric.length > 0 && (
              <label className="flex items-center gap-1.5 mt-1 text-xs cursor-pointer">
                <input type="checkbox" checked={draft.affectsOthers}
                  onChange={(e) => set('affectsOthers', e.target.checked)} />
                这些数值作用在对方身上（如攻击命中扣对方的血）
              </label>
            )}
          </div>

          {/* 其他前提 + 职业 + 参数 */}
          <label className="block">
            <span className="text-xs text-muted-foreground">其他前提（距离、数值门槛等状态表达不了的，用文字写清楚）</span>
            <input value={draft.condition} onChange={(e) => set('condition', e.target.value)}
              className="w-full border rounded px-2 py-1 bg-background" placeholder="如：与球距离 ≤ 2 格" />
          </label>

          {sc.professions.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">职业限制（不选 = 全职业通用）</span>
              <div className="flex gap-1 mt-0.5 flex-wrap">
                {sc.professions.map((p) => (
                  <button key={p.id}
                    onClick={() => set('professions', draft.professions.includes(p.id) ? draft.professions.filter((x) => x !== p.id) : [...draft.professions, p.id])}
                    className={`px-2 py-0.5 rounded-full border text-xs ${draft.professions.includes(p.id) ? 'bg-emerald-600 text-white border-emerald-600' : 'hover:bg-muted'}`}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <label>
              <span className="text-xs text-muted-foreground">基础优先级</span>
              <input type="number" value={draft.basePriority} onChange={(e) => set('basePriority', +e.target.value)}
                className="w-full border rounded px-2 py-1 bg-background" />
            </label>
            <label>
              <span className="text-xs text-muted-foreground">冷却（tick）</span>
              <input type="number" value={draft.cooldown} onChange={(e) => set('cooldown', +e.target.value)}
                className="w-full border rounded px-2 py-1 bg-background" />
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-muted-foreground">说明（写给自己看的备注）</span>
            <textarea value={draft.note} onChange={(e) => set('note', e.target.value)} rows={2}
              className="w-full border rounded px-2 py-1 bg-background" />
          </label>
        </div>

        {/* 状态名输入的自动候选：每个维度一份 */}
        {sc.dimensions.map((d) => (
          <datalist key={d.id} id={`dl-st-${d.id}`}>
            {d.states.map((s) => <option key={s} value={s} />)}
          </datalist>
        ))}

        <DialogFooter>
          <button onClick={onClose} className="px-3 py-1.5 border rounded hover:bg-muted">取消</button>
          <button onClick={save} className="px-3 py-1.5 rounded bg-primary text-primary-foreground hover:opacity-90">保存</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
