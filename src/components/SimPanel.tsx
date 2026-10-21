// 动态模拟面板：tick 推进 + 事件队列 + 权威优先级裁决 + 短环/死锁检测
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PriorityResult } from '@/lib/priority';
import { initSim, stepSim } from '@/lib/sim';
import type { Scenario } from '@/types/model';

interface Props {
  scenario: Scenario;
  result: PriorityResult;
}

export default function SimPanel({ scenario, result }: Props) {
  const [sim, setSim] = useState(() => initSim(scenario));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(100); // ms / tick
  const [activity, setActivity] = useState(1);
  const timer = useRef<number | null>(null);

  const reset = () => { setPlaying(false); setSim(initSim(scenario)); };
  const step = () => setSim((s) => stepSim(scenario, result, s, activity));

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setSim((s) => stepSim(scenario, result, s, activity));
    }, speed);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, speed, activity, scenario, result]);

  // 统计：按执行次数排序的事件
  const statRows = useMemo(() => {
    const names = new Set([...Object.keys(sim.stats.fired), ...Object.keys(sim.stats.suppressed)]);
    return [...names]
      .map((ev) => ({ ev, fired: sim.stats.fired[ev] ?? 0, sup: sim.stats.suppressed[ev] ?? 0 }))
      .sort((a, b) => b.fired - a.fired);
  }, [sim.stats]);

  const totalFired = statRows.reduce((a, r) => a + r.fired, 0);
  const totalSup = statRows.reduce((a, r) => a + r.sup, 0);

  return (
    <div className="p-4 space-y-4 text-sm">
      <div className="flex items-center gap-3 flex-wrap border rounded p-3 bg-card">
        <button onClick={() => setPlaying(!playing)}
          className={`px-4 py-1 rounded text-white font-bold ${playing ? 'bg-amber-600' : 'bg-emerald-600'}`}>
          {playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button onClick={step} className="px-3 py-1 border rounded hover:bg-muted">⏭ 单步</button>
        <button onClick={reset} className="px-3 py-1 border rounded hover:bg-muted">↺ 重置</button>
        <label className="flex items-center gap-2">
          速度
          <input type="range" min={50} max={500} step={50} value={600 - speed} onChange={(e) => setSpeed(600 - +e.target.value)} className="w-24" />
          <span className="text-xs text-muted-foreground">{speed}ms/tick</span>
        </label>
        <label className="flex items-center gap-2">
          事件活跃度
          <input type="range" min={0.2} max={3} step={0.2} value={activity} onChange={(e) => setActivity(+e.target.value)} className="w-24" />
          <span className="text-xs text-muted-foreground">×{activity}</span>
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          tick <b className="text-foreground">{sim.stats.tick}</b> · 执行 {totalFired} · 同刻抑制 {totalSup}
        </span>
      </div>

      <div className="border rounded p-3">
        <h4 className="font-bold mb-2">实体状态（每实体每图各一个当前状态）</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 text-xs">
          {sim.entities.map((ent) => (
            <div key={ent.name} className="border rounded p-2 space-y-0.5">
              <div className="font-bold">
                {ent.kind === 'ball' ? '⚽' : ent.name.startsWith('红') ? '🔴' : '🔵'} {ent.name}
                {(sim.stats.cycleTrap[ent.name] ?? 0) > 20 && <span className="text-red-600 ml-1">短环滞留 {sim.stats.cycleTrap[ent.name]}t</span>}
              </div>
              {Object.entries(ent.states).map(([gid, nm]) => (
                <div key={gid} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{scenario.graphs[gid]?.name ?? gid}</span>
                  <span className="font-medium">{nm}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border rounded p-3">
          <h4 className="font-bold mb-2">事件执行 / 同刻冲突抑制（权威优先级裁决）</h4>
          {statRows.length === 0 && <p className="text-xs text-muted-foreground">尚无事件执行。</p>}
          <table className="w-full text-xs">
            <thead className="bg-muted">
              <tr><th className="p-1 text-left">事件</th><th className="p-1 text-right">执行</th><th className="p-1 text-right">抑制</th><th className="p-1 text-left w-2/5">比例</th></tr>
            </thead>
            <tbody>
              {statRows.slice(0, 20).map((r) => {
                const max = Math.max(1, ...statRows.map((x) => x.fired + x.sup));
                return (
                  <tr key={r.ev} className="border-t">
                    <td className="p-1 font-medium">{r.ev}</td>
                    <td className="p-1 text-right font-mono text-emerald-600">{r.fired}</td>
                    <td className="p-1 text-right font-mono text-red-600">{r.sup}</td>
                    <td className="p-1">
                      <div className="h-2 rounded bg-muted overflow-hidden flex">
                        <div style={{ width: `${(r.fired / max) * 100}%` }} className="bg-emerald-500" />
                        <div style={{ width: `${(r.sup / max) * 100}%` }} className="bg-red-400" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-4">
          <div className="border rounded p-3">
            <h4 className="font-bold mb-2 text-red-600">矛盾 / 死锁检测</h4>
            {sim.stats.contradiction.length === 0 && <p className="text-xs text-muted-foreground">暂无矛盾。</p>}
            <ul className="text-xs space-y-0.5 max-h-28 overflow-auto">
              {sim.stats.contradiction.slice(-20).map((c, i) => <li key={i}>⚠ {c}</li>)}
            </ul>
          </div>
          <div className="border rounded p-3">
            <h4 className="font-bold mb-2">事件队列日志（最近 {sim.stats.log.length} 条）</h4>
            <div className="max-h-56 overflow-auto text-xs space-y-0.5">
              {[...sim.stats.log].reverse().map((l, i) => (
                <div key={i} className={l.outcome === 'suppressed' ? 'text-red-600/80' : ''}>
                  <span className="text-muted-foreground">[{l.tick}]</span> {l.entity} {l.from} —{l.event}→ {l.to}
                  {l.outcome === 'suppressed' && <span className="text-red-500">（抑制：{l.reason}）</span>}
                </div>
              ))}
              {sim.stats.log.length === 0 && <p className="text-muted-foreground">播放或单步推进后开始记录。</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
