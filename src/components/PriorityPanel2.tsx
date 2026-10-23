// 优先级面板 v2：全部事件的权威排名（在总超图上计算）
// 公式：最终分 = 稳态权重 × 稳态概率 + 路径权重 × 主循环路径分（短环内 × 惩罚）+ 手动权重 × 手动微调
// 顶部滑杆可以实时调整公式里的每个数，改完排名立刻重算，并随方案一起保存/导出
// 每一行都能点开看"分数是哪来的"，拒绝黑箱
import { Fragment, useMemo, useState } from 'react';
import { computePriorities2 } from '@/lib/priority2';
import { collectCoexist, collectConflicts } from '@/lib/derive2';
import type { PriorityWeights, Scenario2 } from '@/types/model2';
import { DEFAULT_PRIORITY_WEIGHTS, ENTITY_NAMES } from '@/types/model2';

interface Props {
  sc: Scenario2;
  onChange?: (sc: Scenario2) => void;
}

// 一条滑杆：标签 + 当前值 + 拖动条
function WeightSlider({ label, tip, value, min, max, step, onSlide }: {
  label: string; tip: string; value: number; min: number; max: number; step: number;
  onSlide: (v: number) => void;
}) {
  return (
    <label className="text-xs space-y-1 block" title={tip}>
      <div className="flex justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono font-bold">{value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onSlide(Number(e.target.value))}
        className="w-full accent-primary cursor-pointer" />
      <div className="text-[10px] text-muted-foreground leading-snug">{tip}</div>
    </label>
  );
}

export default function PriorityPanel2({ sc, onChange }: Props) {
  const w = sc.weights ?? DEFAULT_PRIORITY_WEIGHTS;
  const result = useMemo(() => computePriorities2(sc, w), [sc, w]);
  const conflicts = useMemo(() => collectConflicts(sc), [sc]);
  const coexists = useMemo(() => collectCoexist(sc), [sc]);
  const [openId, setOpenId] = useState<string | null>(null);
  const maxScore = Math.max(0.0001, ...result.rows.map((r) => r.score));

  // 改某个权重：写回方案（自动保存），界面随 sc 变化实时重算
  const setWeight = (key: keyof PriorityWeights, value: number) => {
    if (!onChange) return;
    const draft = JSON.parse(JSON.stringify(sc)) as Scenario2;
    draft.weights = { ...w, [key]: value };
    onChange(draft);
  };
  const resetWeights = () => {
    if (!onChange) return;
    const draft = JSON.parse(JSON.stringify(sc)) as Scenario2;
    delete draft.weights;
    onChange(draft);
  };
  const isDefault = !sc.weights;

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
        {[
          ['总超图状态', `${result.stateCount}`],
          ['状态变化', `${result.edgeCount}`],
          ['稳态迭代', `${result.iterations} 轮收敛`],
          ['主循环', `${result.mainLoop.length} 个状态`],
        ].map(([k, v]) => (
          <div key={k} className="border rounded p-2 bg-card">
            <div className="text-lg font-bold">{v}</div>
            <div className="text-[11px] text-muted-foreground">{k}</div>
          </div>
        ))}
      </div>

      {/* 公式调节滑杆：公式里的每个数都能拖，排名立刻重算，随方案保存 */}
      <div className="border rounded-lg bg-card">
        <div className="px-3 py-2 bg-muted/50 flex items-center justify-between">
          <span className="font-bold text-xs">打分公式调节</span>
          <button onClick={resetWeights} disabled={isDefault}
            className="px-2 py-0.5 border rounded text-xs hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
            恢复默认（0.4 / 0.3 / 0.3 / 短环×0.3 / 跳转0.15）
          </button>
        </div>
        <div className="p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-3">
          <WeightSlider label="稳态概率权重" value={w.wSteady} min={0} max={1} step={0.05}
            tip="长期运行下停留越多的状态，它发出的变化越重要。想突出“常发生”的事件就调高。"
            onSlide={(v) => setWeight('wSteady', v)} />
          <WeightSlider label="主循环路径权重" value={w.wPath} min={0} max={1} step={0.05}
            tip="离主循环越近、能到达的层越深越高分。想突出“通往大循环路上”的事件就调高。"
            onSlide={(v) => setWeight('wPath', v)} />
          <WeightSlider label="手动微调权重" value={w.wManual} min={0} max={1} step={0.05}
            tip="事件编辑里「基础优先级 ÷ 10」占的比重。想让自己填的基础优先级说了算就调高。"
            onSlide={(v) => setWeight('wManual', v)} />
          <WeightSlider label="短环惩罚（得分×几）" value={w.penalty} min={0} max={1} step={0.05}
            tip="落在短环（2~3 个状态的小死循环）里的变化，得分乘以这个数。0 = 完全压掉，1 = 不惩罚。"
            onSlide={(v) => setWeight('penalty', v)} />
          <WeightSlider label="随机跳转概率" value={w.jump} min={0} max={0.5} step={0.05}
            tip="算稳态时每一步随机跳到任意状态的几率，防止死角状态永远轮不到。一般 0.1~0.2，别超过 0.5。"
            onSlide={(v) => setWeight('jump', v)} />
        </div>
        <div className="px-3 pb-2 text-[10px] text-muted-foreground">
          三个权重之和不必等于 1（只影响分数的整体刻度，不影响谁高谁低的相对比较）；拖动后排名实时重算，并随方案一起保存、导出。
        </div>
      </div>

      <div className="border rounded p-3 bg-muted/40 text-xs leading-relaxed">
        <b>打分公式（在总超图上算）：</b>最终分 = {w.wSteady.toFixed(2)} × 稳态概率 + {w.wPath.toFixed(2)} × 主循环路径分 + {w.wManual.toFixed(2)} × 手动微调（基础优先级 ÷ 10）。
        稳态概率 = 长期运行下状态的停留概率（幂迭代收敛，每步 {Math.round(w.jump * 100)}% 几率随机跳转防死角）；路径分 = 距主循环越近、能到达的层越深越高，主循环内 = 1；
        落在短环（2~3 个状态的小圈）里的变化 × {w.penalty.toFixed(2)} 惩罚。事件有多条变化时按最高分的那条计；
        没有状态变化的纯数值事件（如冲击/回血）改用它的前提状态当锚点评分——前提在哪个状态出现得多，这条事件就在哪重要。
        主循环成员：{result.mainLoop.length > 0 ? result.mainLoop.join('、') : '（无）'}
      </div>

      {result.smallCycles.length > 0 && (
        <div className="border border-amber-300 bg-amber-50 dark:bg-amber-950/40 rounded p-2 text-xs">
          <b className="text-amber-700 dark:text-amber-300">⚠ 短环（容易陷入小死循环，已罚分）：</b>
          {result.smallCycles.map((c, i) => (
            <span key={i} className="inline-block mr-2 mt-1 px-1.5 py-0.5 border border-amber-300 rounded">{c.join(' ⇄ ')}</span>
          ))}
        </div>
      )}

      {/* 矛盾分栏：同一状态有多个去向 = 岔路口；不同去向之间两两矛盾，同一去向的多条事件是共存 */}
      {(conflicts.length > 0 || coexists.length > 0) && (
        <div className="border rounded-lg bg-card">
          <div className="px-3 py-2 bg-muted/50 font-bold text-xs">
            矛盾分栏（{conflicts.length} 个岔路口）
            <span className="ml-2 font-normal text-muted-foreground">
              栏内不同去向之间两两矛盾；同一去向框在一起的是共存卡牌（不矛盾）
            </span>
          </div>
          <div className="p-3 space-y-2 max-h-72 overflow-auto">
            {conflicts.map((g) => (
              <div key={`${g.dimId}|${g.from}`} className="border rounded p-2 text-xs">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-bold">{g.dimName} · {g.from}</span>
                  <span className={`px-1.5 rounded-full text-[10px] text-white ${
                    g.risk === '被动撞车' ? 'bg-amber-600' : g.risk === '混合' ? 'bg-sky-600' : 'bg-slate-400'
                  }`}>{g.risk}</span>
                  {g.risk === '被动撞车' && (
                    <span className="text-[10px] text-amber-700 dark:text-amber-300">多条被动事件可能同时满足前提，系统会随机挑一条——确认是否故意</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.branches.map((b) => (
                    <div key={b.to} className={`rounded px-2 py-1 ${b.events.length > 1 ? 'border-2 border-violet-500 bg-violet-50 dark:bg-violet-950/40' : 'border bg-muted/40'}`}>
                      <span className="text-muted-foreground">→ {b.to}：</span>
                      {b.events.map((e) => (
                        <span key={e.id} className="inline-block mr-1 px-1 rounded bg-background border">
                          {e.group ?? e.name}
                          <span className={`ml-0.5 text-[9px] ${e.trigger === '主动' ? 'text-blue-600' : 'text-orange-600'}`}>{e.trigger}</span>
                        </span>
                      ))}
                      {b.events.length > 1 && <span className="text-[10px] text-violet-600 dark:text-violet-300 ml-0.5">共存</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {coexists.length > 0 && (
            <div className="px-3 pb-2 text-[10px] text-muted-foreground">
              纯共存点（多条事件做同一个变化，不矛盾，可考虑合并）：
              {coexists.map((c) => (
                <span key={`${c.dimId}|${c.from}|${c.to}`} className="inline-block mr-2 mt-1 px-1.5 py-0.5 border border-violet-300 rounded">
                  {c.dimName}·{c.from}→{c.to}：{c.events.map((e) => e.group ?? e.name).join('、')}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <table className="w-full text-sm border rounded overflow-hidden bg-card">
        <thead>
          <tr className="bg-muted text-xs">
            <th className="px-2 py-1.5 text-left w-10">名次</th>
            <th className="px-2 py-1.5 text-left">事件</th>
            <th className="px-2 py-1.5 text-left w-56">最终分</th>
            <th className="px-2 py-1.5 text-left w-44">构成（稳态/路径/手动）</th>
            <th className="px-2 py-1.5 text-left w-24">标记</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r) => (
            <Fragment key={r.eventId}>
              <tr onClick={() => setOpenId(openId === r.eventId ? null : r.eventId)}
                className="border-t cursor-pointer hover:bg-muted/50">
                <td className="px-2 py-1.5 font-mono text-xs">{r.rank}</td>
                <td className="px-2 py-1.5">
                  <span className="font-medium">{r.name}</span>
                  {r.trigger === '复合' ? (
                    <span className="ml-1.5 text-[10px] px-1 rounded-full text-white bg-violet-600">复合</span>
                  ) : (
                    <span className={`ml-1.5 text-[10px] px-1 rounded-full text-white ${r.trigger === '主动' ? 'bg-blue-600' : 'bg-orange-600'}`}>{r.trigger}</span>
                  )}
                  {r.owner === 'multi' ? (
                    <span className="ml-1 text-[10px] px-1 rounded-full bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300">
                      {r.members!.map((m) => m.name).join('＋')}
                    </span>
                  ) : (
                    <span className="ml-1 text-[10px] px-1 rounded-full bg-slate-200 dark:bg-slate-700">{ENTITY_NAMES[r.owner as keyof typeof ENTITY_NAMES]}</span>
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                      <div className={`h-full ${r.penalized ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${(r.score / maxScore) * 100}%` }} />
                    </div>
                    <span className="text-xs font-mono w-12 text-right">{r.score.toFixed(3)}</span>
                  </div>
                </td>
                <td className="px-2 py-1.5 text-xs text-muted-foreground">
                  {r.steady.toFixed(2)} / {r.path.toFixed(2)} / {r.manual.toFixed(2)}
                </td>
                <td className="px-2 py-1.5 text-xs">
                  {r.inMainLoop && <span className="px-1 rounded bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">主循环</span>}
                  {r.penalized && <span className="px-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 ml-1">短环</span>}
                </td>
              </tr>
              {openId === r.eventId && (
                <tr className="border-t bg-muted/30">
                  <td colSpan={5} className="px-4 py-2 text-xs text-muted-foreground">{r.explain}</td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {result.rows.length === 0 && <div className="text-sm text-muted-foreground text-center py-8">还没有事件可评分</div>}
    </div>
  );
}
