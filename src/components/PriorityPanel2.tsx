// 优先级面板 v2：全部事件的权威排名（在总超图上计算）
// 公式：最终分 = 0.4 × 稳态概率 + 0.3 × 主循环路径分（短环内 × 0.3 惩罚）+ 0.3 × 手动微调
// 每一行都能点开看"分数是哪来的"，拒绝黑箱
import { Fragment, useMemo, useState } from 'react';
import { computePriorities2 } from '@/lib/priority2';
import type { Scenario2 } from '@/types/model2';
import { ENTITY_NAMES } from '@/types/model2';

export default function PriorityPanel2({ sc }: { sc: Scenario2 }) {
  const result = useMemo(() => computePriorities2(sc), [sc]);
  const [openId, setOpenId] = useState<string | null>(null);
  const maxScore = Math.max(0.0001, ...result.rows.map((r) => r.score));

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

      <div className="border rounded p-3 bg-muted/40 text-xs leading-relaxed">
        <b>打分公式（在总超图上算）：</b>最终分 = 0.4 × 稳态概率 + 0.3 × 主循环路径分 + 0.3 × 手动微调（基础优先级 ÷ 10）。
        稳态概率 = 长期运行下状态的停留概率（幂迭代收敛）；路径分 = 距主循环越近、能到达的层越深越高，主循环内 = 1；
        落在短环（2~3 个状态的小圈）里的变化 × 0.3 惩罚。事件有多条变化时按最高分的那条计。
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
                  <span className={`ml-1.5 text-[10px] px-1 rounded-full text-white ${r.trigger === '主动' ? 'bg-blue-600' : 'bg-orange-600'}`}>{r.trigger}</span>
                  <span className="ml-1 text-[10px] px-1 rounded-full bg-slate-200 dark:bg-slate-700">{ENTITY_NAMES[r.owner as keyof typeof ENTITY_NAMES]}</span>
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
