// 动态模拟面板：事件驱动模拟 + 全程事件日志
// 注意：事件里用文字写的"其他前提"（距离、数值门槛）模拟时不判定，只判定状态前提
import { useEffect, useRef, useState } from 'react';
import type { Scenario2 } from '@/types/model2';
import { initSim2, stepSim2, type SimState } from '@/lib/sim2';

export default function SimPanel2({ sc }: { sc: Scenario2 }) {
  const [sim, setSim] = useState<SimState>(() => initSim2(sc));
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const timer = useRef<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // 方案变化（编辑了事件库）→ 重置模拟
  useEffect(() => {
    setSim(initSim2(sc));
    setRunning(false);
  }, [sc]);

  useEffect(() => {
    if (!running) return;
    timer.current = window.setInterval(() => {
      setSim((s) => {
        const nx = stepSim2(sc, s);
        if (nx.over) setRunning(false);
        return nx;
      });
    }, Math.max(40, Math.round(220 / speed)));
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [running, speed, sc]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [sim.log.length]);

  const dimName = (id: string) => sc.dimensions.find((d) => d.id === id)?.name ?? '';

  return (
    <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4 h-full overflow-auto">
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setRunning(!running)}
            className={`px-3 py-1.5 rounded text-sm text-white ${running ? 'bg-amber-600' : 'bg-green-600'}`}>
            {running ? '暂停' : '开始'}
          </button>
          <button onClick={() => setSim((s) => stepSim2(sc, s))} disabled={running}
            className="px-3 py-1.5 border rounded text-sm hover:bg-muted disabled:opacity-40">单步</button>
          <button onClick={() => { setSim(initSim2(sc)); setRunning(false); }}
            className="px-3 py-1.5 border rounded text-sm hover:bg-muted">重置</button>
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)}
            className="border rounded px-2 py-1 text-sm bg-background">
            {[1, 2, 4].map((s) => <option key={s} value={s}>{s} 倍速</option>)}
          </select>
          <span className="text-sm text-muted-foreground">第 {sim.tick} 拍</span>
          {sim.over && <span className="text-sm font-bold text-red-600">比赛结束（球门已进入结算）</span>}
        </div>
        <p className="text-[11px] text-muted-foreground">
          只判定状态前提；用文字写的"其他前提"（如距离 ≤ 2 格）在模拟里暂不判定。改了事件库会自动重置。
        </p>

        <div className="space-y-2">
          {sim.entities.map((e) => (
            <div key={e.id} className={`border rounded p-2 bg-card ${e.kind === 'goal' ? 'border-amber-400 dark:border-amber-600' : e.kind === 'ball' ? 'border-sky-300 dark:border-sky-700' : ''}`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`font-bold text-sm min-w-10 ${e.kind === 'player' ? (e.team === 'A' ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400') : ''}`}>
                  {e.kind === 'ball' ? '⚽ ' : e.kind === 'goal' ? '🥅 ' : ''}{e.name}
                </span>
                {Object.entries(e.states).map(([dimId, state]) => (
                  <span key={dimId} className={`text-[11px] px-1.5 py-0.5 rounded border ${state === '结算' ? 'bg-amber-100 dark:bg-amber-900 border-amber-400 font-bold' : 'bg-background'}`}>
                    {dimName(dimId)}：<b>{state}</b>
                  </span>
                ))}
                {e.kind === 'player' && (
                  <span className="text-[11px] text-rose-600 dark:text-rose-400 ml-auto">血 {e.hp}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col min-h-0">
        <div className="text-sm font-bold mb-1">事件日志（{sim.log.length}）</div>
        <div ref={logRef} className="flex-1 min-h-[300px] overflow-auto border rounded bg-card p-2 space-y-1">
          {sim.log.length === 0 && <div className="text-xs text-muted-foreground">还没有事件，点「开始」或「单步」</div>}
          {sim.log.map((l, i) => {
            // 进球/结算高亮；主动动作正常色；被动反应淡一些
            const isGoal = l.text.includes('球门拿球') || l.text.includes('比赛结算');
            const cls = isGoal
              ? 'font-bold text-amber-700 dark:text-amber-300'
              : l.text.includes('被动触发') ? 'text-muted-foreground' : '';
            return (
              <div key={i} className={`text-xs leading-relaxed ${cls}`}>
                <span className="text-muted-foreground font-mono mr-1">[{l.tick}]</span>{l.text}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
