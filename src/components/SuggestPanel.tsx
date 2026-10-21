import type { PriorityResult, Suggestion } from '@/lib/priority';
import type { BalanceParams, Scenario } from '@/types/model';
import { useState } from 'react';

interface Props {
  scenario: Scenario;
  onBalance: (b: BalanceParams) => void;
  result: PriorityResult;
  suggestions: Suggestion[];
}

export default function SuggestPanel({ scenario, onBalance, result, suggestions }: Props) {
  const b = scenario.balance;
  const [baseline, setBaseline] = useState<Map<string, number> | null>(null);

  const recordBaseline = () => {
    setBaseline(new Map(result.scores.map((s) => [s.edge.event + s.edge.fromName + s.edge.toName, s.rank])));
  };

  const keyOf = (s: typeof result.scores[number]) => s.edge.event + s.edge.fromName + s.edge.toName;

  const slider = (label: string, k: keyof BalanceParams, min: number, max: number, step = 1) => (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-32">{label}</span>
      <input type="range" min={min} max={max} step={step} value={b[k]} className="flex-1"
        onChange={(e) => onBalance({ ...b, [k]: +e.target.value })} />
      <span className="w-14 text-right font-mono">{b[k]}</span>
    </div>
  );

  return (
    <div className="space-y-4 p-4">
      <div className="border rounded p-4 space-y-2">
        <h4 className="font-bold">全局平衡参数（改动后下方优先级与建议即时重算）</h4>
        {slider('伤害基准', 'damage', 1, 50)}
        {slider('血量上限', 'hpMax', 50, 300)}
        {slider('掉球阈值', 'hpDropThreshold', 5, 100)}
        {slider('位移基准距离', 'displacement', 1, 15)}
      </div>

      <div className="border rounded p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-bold">调整建议（{suggestions.length} 条）</h4>
          <button onClick={recordBaseline} className="px-3 py-1 text-sm border rounded hover:bg-muted">
            记录当前优先级为基线
          </button>
        </div>
        {suggestions.length === 0 && <p className="text-sm text-muted-foreground">暂无建议：未发现短环，主循环状态良好。</p>}
        <ul className="space-y-2">
          {suggestions.map((s, i) => (
            <li key={i} className="text-sm border-l-4 border-amber-500 pl-3 py-1">
              <span className="font-medium">【{s.kind}】{s.target}</span>
              <div className="text-muted-foreground">{s.advice}</div>
              <div className="text-emerald-600">预期：{s.expect}</div>
            </li>
          ))}
        </ul>
      </div>

      {baseline && (
        <div className="border rounded p-4">
          <h4 className="font-bold mb-2">与基线对比（名次变化）</h4>
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr><th className="p-1 text-left">事件</th><th className="p-1 text-right">基线</th><th className="p-1 text-right">当前</th><th className="p-1 text-right">Δ</th></tr>
            </thead>
            <tbody>
              {result.scores.map((s) => {
                const old = baseline.get(keyOf(s));
                if (old === undefined) return null;
                const d = old - s.rank;
                return (
                  <tr key={keyOf(s)} className="border-t">
                    <td className="p-1">{s.edge.event}（{s.edge.fromName}→{s.edge.toName}）</td>
                    <td className="p-1 text-right font-mono">{old}</td>
                    <td className="p-1 text-right font-mono">{s.rank}</td>
                    <td className={`p-1 text-right font-mono ${d > 0 ? 'text-emerald-600' : d < 0 ? 'text-red-600' : ''}`}>
                      {d === 0 ? '—' : d > 0 ? `↑${d}` : `↓${-d}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
