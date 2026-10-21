import type { PriorityResult } from '@/lib/priority';
import { DOMAIN_NAMES } from '@/types/model';

interface Props {
  result: PriorityResult;
  alpha: number;
  onAlpha: (a: number) => void;
}

export default function PriorityPanel({ result, alpha, onAlpha }: Props) {
  const { scores, byDomain } = result;

  // 同刻冲突预览：同逻辑域内目标状态相同的事件互为冲突，仅第一名执行一次
  const conflicts = new Map<string, typeof scores>();
  for (const s of scores) {
    const key = `${s.edge.domain}→${s.edge.toName}`;
    if (!conflicts.has(key)) conflicts.set(key, []);
    conflicts.get(key)!.push(s);
  }
  const conflictGroups = [...conflicts.entries()].filter(([, v]) => v.length > 1);

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        {(Object.keys(byDomain) as Array<keyof typeof byDomain>).map((d) => {
          const r = byDomain[d];
          return (
            <div key={d} className="border rounded p-3">
              <div className="text-muted-foreground">{DOMAIN_NAMES[d]} · BFS 起点「无球」</div>
              <div className="mt-1 text-xs">
                <span className="text-emerald-600">主循环：{r.cycles.mainCycle.length > 0 ? r.cycles.mainCycle.join('→') : '（无环）'}</span><br />
                <span className={r.cycles.shortCycles.length > 0 ? 'text-red-600' : 'text-muted-foreground'}>
                  短环：{r.cycles.shortCycles.length > 0 ? r.cycles.shortCycles.map((c) => c.join('→')).join('；') : '无'}
                </span><br />
                <span className={r.bfs.unreachable.length > 0 ? 'text-amber-600' : 'text-muted-foreground'}>
                  不可达：{r.bfs.unreachable.length > 0 ? r.bfs.unreachable.join('、') : '无'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 text-sm flex-wrap">
        <span>手动微调系数 α = {alpha}</span>
        <input type="range" min={0} max={1} step={0.1} value={alpha} onChange={(e) => onAlpha(+e.target.value)} className="w-48" />
        <span className="text-muted-foreground">复合语义：各逻辑域独立 BFS 后合并排名（位置/控制/血量域无「无球」节点时从首状态出发）</span>
      </div>

      <div className="border rounded overflow-auto max-h-[420px]">
        <table className="w-full text-sm">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="p-2 text-left">名次</th>
              <th className="p-2 text-left">事件</th>
              <th className="p-2 text-left">转换</th>
              <th className="p-2 text-left">逻辑域</th>
              <th className="p-2 text-left">BFS 层</th>
              <th className="p-2 text-right">路径分</th>
              <th className="p-2 text-right">环罚</th>
              <th className="p-2 text-right">结构权重</th>
              <th className="p-2 text-right">手动分</th>
              <th className="p-2 text-right font-bold">最终分</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s) => (
              <tr key={s.edge.id} className={`border-t ${s.inShortCycle ? 'bg-red-50 dark:bg-red-950/40' : s.inMainCycle ? 'bg-emerald-50 dark:bg-emerald-950/40' : ''}`}>
                <td className="p-2 font-mono">{s.rank}</td>
                <td className="p-2 font-medium">{s.edge.event}{s.edge.isHyper ? ' ⇄' : ''}</td>
                <td className="p-2 text-muted-foreground">{s.edge.fromName} → {s.edge.toName}</td>
                <td className="p-2 text-muted-foreground">{DOMAIN_NAMES[s.edge.domain]}</td>
                <td className="p-2 font-mono text-xs">{s.layers.sort((a, b) => a - b).join(', ')}</td>
                <td className="p-2 text-right font-mono">{s.pathScore}</td>
                <td className="p-2 text-right font-mono">{s.cyclePenalty}</td>
                <td className="p-2 text-right font-mono">{s.structWeight}</td>
                <td className="p-2 text-right font-mono">{s.manualScore}</td>
                <td className="p-2 text-right font-mono font-bold">{s.finalScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border rounded p-3 text-sm">
        <h4 className="font-bold mb-2">同刻冲突裁决预览（同一目标状态的事件竞争，只执行一次）</h4>
        {conflictGroups.length === 0 && <p className="text-muted-foreground">无冲突事件。</p>}
        {conflictGroups.map(([key, group]) => (
          <div key={key} className="mb-1">
            <span className="font-medium">目标「{group[0].edge.toName}」（{DOMAIN_NAMES[group[0].edge.domain]}）：</span>
            {group.slice(0, 3).map((s, i) => (
              <span key={s.edge.id} className={i === 0 ? 'text-emerald-600 font-bold' : 'text-muted-foreground line-through'}>
                {i > 0 && '、'}{s.edge.event}（{s.finalScore}）
              </span>
            ))}
            <span className="text-muted-foreground">　→ 仅执行「{group[0].edge.event}」</span>
          </div>
        ))}
      </div>
    </div>
  );
}
