// 动态模拟面板：事件驱动模拟 + 全程事件日志 + 9×9 格点球场实时演示
// 距离前提已真实判定（拿球 ≤2 格、冲击 ≤ 攻击距离、射门 ≤ 射门距离），不再只是文字说明
import { useEffect, useRef, useState } from 'react';
import type { Scenario2 } from '@/types/model2';
import { initSim2, stepSim2, type SimState } from '@/lib/sim2';

const CELL = 34; // 每格像素

// 9×9 格点球场：每 3 格一条粗的区域分界线；角色=红/蓝圆点，球=⚽，球门=🥅
function PitchView({ sim }: { sim: SimState }) {
  const size = CELL * 9;
  return (
    <div className="border rounded bg-card p-2">
      <div className="text-xs font-bold mb-1">球场（9×9 格，粗线是区域分界）</div>
      <svg width={size} height={size} className="block">
        {/* 格子底纹 */}
        {Array.from({ length: 9 }, (_, y) =>
          Array.from({ length: 9 }, (_, x) => (
            <rect key={`${x}-${y}`} x={x * CELL} y={y * CELL} width={CELL} height={CELL}
              fill={(x + y) % 2 === 0 ? 'rgba(34,197,94,0.10)' : 'rgba(34,197,94,0.05)'}
              stroke="rgba(100,116,139,0.25)" strokeWidth={1} />
          )),
        )}
        {/* 区域分界线（每 3 格一条粗线） */}
        {[3, 6].map((i) => (
          <line key={`v${i}`} x1={i * CELL} y1={0} x2={i * CELL} y2={size} stroke="rgba(100,116,139,0.8)" strokeWidth={2.5} />
        ))}
        {[3, 6].map((i) => (
          <line key={`h${i}`} x1={0} y1={i * CELL} x2={size} y2={i * CELL} stroke="rgba(100,116,139,0.8)" strokeWidth={2.5} />
        ))}
        {/* 实体（同格多个时散开一点，避免完全重叠） */}
        {sim.entities.map((e) => {
          const sameCell = sim.entities.filter((o) => o.cx === e.cx && o.cy === e.cy);
          const idx = sameCell.findIndex((o) => o.id === e.id);
          const n = sameCell.length;
          const ang = n > 1 ? (idx / n) * Math.PI * 2 : 0;
          const spread = n > 1 ? 8 : 0;
          const px = e.cx * CELL + CELL / 2 + Math.cos(ang) * spread;
          const py = e.cy * CELL + CELL / 2 + Math.sin(ang) * spread;
          if (e.kind === 'ball') {
            return <text key={e.id} x={px} y={py + 5} textAnchor="middle" fontSize={16}>⚽</text>;
          }
          if (e.kind === 'goal') {
            return <text key={e.id} x={px} y={py + 6} textAnchor="middle" fontSize={18}>🥅</text>;
          }
          const color = e.team === 'A' ? '#dc2626' : '#2563eb';
          return (
            <g key={e.id}>
              <circle cx={px} cy={py} r={11} fill={color} stroke="#fff" strokeWidth={1.5} />
              <text x={px} y={py + 3.5} textAnchor="middle" fontSize={9} fill="#fff" fontWeight="bold">
                {e.name.replace(/[AB队]/g, '')}
              </text>
              {e.hp < 50 && <circle cx={px + 9} cy={py - 9} r={3.5} fill="#f59e0b" stroke="#fff" strokeWidth={1} />}
            </g>
          );
        })}
      </svg>
      <div className="text-[10px] text-muted-foreground mt-1">红=A 队 蓝=B 队；角色右上黄点=血量低于 50</div>
    </div>
  );
}

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
          距离前提已真实判定：拿球需离球 ≤ 2 格、冲击需离持球者 ≤ 攻击距离、射门需离球门 ≤ 射门距离（后两个可在维度页的"平衡参数"里调）。改了事件库会自动重置。
        </p>

        <PitchView sim={sim} />

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
