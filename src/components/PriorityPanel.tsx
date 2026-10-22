import type { PriorityResult } from '@/lib/priority';
import type { Scenario } from '@/types/model';

interface Props {
  result: PriorityResult;
  scenario: Scenario;
  alpha: number;
  onAlpha: (a: number) => void;
}

export default function PriorityPanel({ result, scenario, alpha, onAlpha }: Props) {
  const { scores, byDomain, dfs, cycles } = result;
  const graphName = (id: string) => scenario.graphs[id]?.name ?? id;
  const profName = (ids?: string[]) =>
    !ids || ids.length === 0 ? '通用'
      : ids.map((id) => scenario.professions.find((p) => p.id === id)?.name ?? id).join('/');

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
      <div className="border rounded p-3 bg-teal-50 dark:bg-teal-950/40 text-sm">
        <div className="font-bold text-teal-700 dark:text-teal-300">权威 = 总状态逻辑超图 DFS（{Object.keys(byDomain).length} 张逻辑图已粘合）</div>
        <div className="mt-1 text-xs">
          起点（{dfs.rootNames.length} 个）{dfs.rootNames.slice(0, 8).join('、')}{dfs.rootNames.length > 8 ? '…' : ''} · 最大层深 {dfs.maxDepth} · 树边 {dfs.treeEdgeIds.size} · 回边 {dfs.backEdgeIds.size} ·
          主循环（{cycles.mainCycle.length} 节点）：{cycles.mainCycle.length > 0 ? cycles.mainCycle.slice(0, 24).join('→') + (cycles.mainCycle.length > 24 ? '…' : '') : '（无环）'} ·
          <span className={cycles.shortCycles.length > 0 ? 'text-red-600' : ''}> 短环 {cycles.shortCycles.length} 个</span> ·
          <span className={dfs.unreachable.length > 0 ? 'text-amber-600' : ''}> 不可达 {dfs.unreachable.length} 个</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        {(Object.keys(byDomain) as Array<keyof typeof byDomain>).map((d) => {
          const r = byDomain[d];
          return (
            <div key={d} className="border rounded p-3">
              <div className="text-muted-foreground">{r.graphName} · {r.scores.length} 事件</div>
              <div className="mt-1 text-xs">
                <span className={r.scores.filter((x) => x.inMainCycle).length > 0 ? 'text-emerald-600' : 'text-muted-foreground'}>
                  主循环内 {r.scores.filter((x) => x.inMainCycle).length} 条
                </span><br />
                <span className={r.scores.some((x) => x.inShortCycle) ? 'text-red-600' : 'text-muted-foreground'}>
                  短环内 {r.scores.filter((x) => x.inShortCycle).length} 条
                </span><br />
                <span className="text-muted-foreground">最高名次 #{r.scores[0]?.rank ?? '—'}（{r.scores[0]?.edge.event ?? '—'}）</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 text-sm flex-wrap">
        <span>手动微调系数 α = {alpha}</span>
        <input type="range" min={0} max={1} step={0.1} value={alpha} onChange={(e) => onAlpha(+e.target.value)} className="w-48" />
        <span className="text-muted-foreground">权威排名：全部逻辑图粘合为总超图后统一 DFS，下表名次即最终裁决；优先级 = 通往深层/主循环路上的事件高分，短环 ×0.3 惩罚，再叠加 α·手动分</span>
      </div>

      <div className="border rounded overflow-auto max-h-[420px]">
        <table className="w-full text-sm">
          <thead className="bg-muted sticky top-0">
            <tr>
              <th className="p-2 text-left">名次</th>
              <th className="p-2 text-left">事件</th>
              <th className="p-2 text-left">转换</th>
              <th className="p-2 text-left">逻辑域</th>
              <th className="p-2 text-left">职业</th>
              <th className="p-2 text-left">DFS 层深</th>
              <th className="p-2 text-right">深度分</th>
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
                <td className="p-2 font-medium">
                  {s.edge.event}{s.edge.isHyper ? ' ⇄' : ''}
                  {s.edge.trigger === 'passive' && (
                    <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                      title={`被动触发：监听 ${(s.edge.listenEvents ?? []).join('、')}，事件执行后于下一次判定加入队列`}>
                      被动
                    </span>
                  )}
                </td>
                <td className="p-2 text-muted-foreground">{s.edge.fromName} → {s.edge.toName}</td>
                <td className="p-2 text-muted-foreground">{graphName(s.edge.domain)}</td>
                <td className="p-2 text-xs">{profName(s.edge.professionIds)}</td>
                <td className="p-2 font-mono text-xs">{s.depths.sort((a, b) => a - b).join(', ')}</td>
                <td className="p-2 text-right font-mono">{s.depthScore}</td>
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
            <span className="font-medium">目标「{group[0].edge.toName}」（{graphName(group[0].edge.domain)}）：</span>
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
