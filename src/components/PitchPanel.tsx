// 多人位置联合状态视图：小球场 + 10×10 网格，把每名角色和球标注在网格点上
// 多人位置联合状态 = (角色1格, 角色2格, …, 球格) 的组合
import { useMemo, useRef, useState } from 'react';
import type { Scenario } from '@/types/model';
import { GRID_COLS, GRID_ROWS, gridCenter } from '@/lib/defaultScenario';

const PITCH_W = 720;      // 球场像素宽
const PITCH_H = 480;      // 球场像素高
const MARGIN = 36;

interface FormationSpot { id: string; col: number; row: number } // id = 球员 id 或 'ball'

interface Props {
  scenario: Scenario;
  onChange: (sc: Scenario) => void;
}

export default function PitchPanel({ scenario, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const cellW = (PITCH_W - MARGIN * 2) / GRID_COLS;
  const cellH = (PITCH_H - MARGIN * 2) / GRID_ROWS;
  const toPx = (col: number, row: number) => ({
    x: MARGIN + (col + 0.5) * cellW,
    y: MARGIN + (row + 0.5) * cellH,
  });
  const toCell = (px: number, py: number) => ({
    col: Math.max(0, Math.min(GRID_COLS - 1, Math.floor((px - MARGIN) / cellW))),
    row: Math.max(0, Math.min(GRID_ROWS - 1, Math.floor((py - MARGIN) / cellH))),
  });

  // 默认阵型：红队左半场、蓝队右半场、球在中圈
  const spots: FormationSpot[] = useMemo(() => {
    if (scenario.formation) return scenario.formation;
    const ps = scenario.players;
    const list: FormationSpot[] = ps.map((p) => {
      const teamIdx = ps.filter((x) => x.team === p.team).indexOf(p);
      const n = ps.filter((x) => x.team === p.team).length;
      return {
        id: p.id,
        col: p.team === 'A' ? 1 + (teamIdx % 2) : GRID_COLS - 2 - (teamIdx % 2),
        row: Math.round(((teamIdx + 0.5) / n) * (GRID_ROWS - 1)),
      };
    });
    list.push({ id: 'ball', col: Math.floor(GRID_COLS / 2) - 1, row: Math.floor(GRID_ROWS / 2) });
    return list;
  }, [scenario]);

  const save = (next: FormationSpot[]) =>
    onChange({ ...scenario, formation: next });

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragId) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const cell = toCell(e.clientX - rect.left, e.clientY - rect.top);
    save(spots.map((s) => (s.id === dragId ? { ...s, ...cell } : s)));
  };

  const playerOf = (id: string) => scenario.players.find((p) => p.id === id);
  const profOf = (p: { professionId: string }) =>
    scenario.professions.find((x) => x.id === p.professionId)?.name ?? '';

  const jointCount = Math.pow(GRID_COLS * GRID_ROWS, scenario.players.length + 1);

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm text-muted-foreground">
        多人位置联合状态 = 每名角色所在网格点 + 球所在网格点的组合。
        当前 {scenario.players.length} 名角色 + 1 球，每格 10×10=100 种取值 → 联合状态数 = 100^{scenario.players.length + 1} = <b className="text-foreground">{jointCount.toExponential(2)}</b>。
        拖拽球员/球到任意格子（吸附到网格点），即指定当前联合位置状态。
      </div>

      <div className="border rounded bg-emerald-50 dark:bg-emerald-950/30 overflow-auto inline-block">
        <svg ref={svgRef} width={PITCH_W} height={PITCH_H}
          className="cursor-default" onMouseMove={onMouseMove} onMouseUp={() => setDragId(null)}>
          {/* 草坪 */}
          <rect x={MARGIN} y={MARGIN} width={PITCH_W - MARGIN * 2} height={PITCH_H - MARGIN * 2}
            fill="#15803d" stroke="#ffffff" strokeWidth={2} />
          {/* 中圈中线 */}
          <line x1={PITCH_W / 2} y1={MARGIN} x2={PITCH_W / 2} y2={PITCH_H - MARGIN} stroke="#fff" strokeWidth={2} opacity={0.8} />
          <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={52} fill="none" stroke="#fff" strokeWidth={2} opacity={0.8} />
          {/* 禁区 */}
          <rect x={MARGIN} y={PITCH_H / 2 - 90} width={80} height={180} fill="none" stroke="#fff" strokeWidth={2} opacity={0.8} />
          <rect x={PITCH_W - MARGIN - 80} y={PITCH_H / 2 - 90} width={80} height={180} fill="none" stroke="#fff" strokeWidth={2} opacity={0.8} />

          {/* 网格 */}
          {Array.from({ length: GRID_COLS + 1 }, (_, i) => MARGIN + i * cellW).map((x) => (
            <line key={`v${x}`} x1={x} y1={MARGIN} x2={x} y2={PITCH_H - MARGIN} stroke="#ffffff" strokeWidth={0.4} opacity={0.35} />
          ))}
          {Array.from({ length: GRID_ROWS + 1 }, (_, i) => MARGIN + i * cellH).map((y) => (
            <line key={`h${y}`} x1={MARGIN} y1={y} x2={PITCH_W - MARGIN} y2={y} stroke="#ffffff" strokeWidth={0.4} opacity={0.35} />
          ))}

          {/* 实体位置 */}
          {spots.map((s) => {
            const p = toPx(s.col, s.row);
            if (s.id === 'ball') {
              return (
                <g key="ball" onMouseDown={(e) => { e.stopPropagation(); setDragId('ball'); }} className="cursor-grab active:cursor-grabbing">
                  <circle cx={p.x} cy={p.y} r={9} fill="#fbbf24" stroke="#78350f" strokeWidth={1.5} />
                  <title>球 @ ({s.col},{s.row}) 坐标 {gridCenter(s.col, s.row).x},{gridCenter(s.col, s.row).y}</title>
                </g>
              );
            }
            const pl = playerOf(s.id);
            if (!pl) return null;
            const colr = pl.team === 'A' ? '#ef4444' : '#3b82f6';
            return (
              <g key={s.id} onMouseDown={(e) => { e.stopPropagation(); setDragId(s.id); }} className="cursor-grab active:cursor-grabbing">
                <circle cx={p.x} cy={p.y} r={14} fill={colr} stroke="#fff" strokeWidth={2} />
                <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="#fff" className="pointer-events-none select-none">
                  {pl.name.slice(-1)}
                </text>
                <text x={p.x} y={p.y - 20} textAnchor="middle" fontSize={9} fill={colr} className="pointer-events-none select-none">
                  {pl.name}·{profOf(pl)}
                </text>
                <title>{pl.name}（{profOf(pl)}）@ 网格 ({s.col},{s.row})，坐标 {gridCenter(s.col, s.row).x},{gridCenter(s.col, s.row).y}</title>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="border rounded p-3 text-sm">
        <h4 className="font-bold mb-2">当前联合位置状态</h4>
        <ul className="text-xs space-y-0.5">
          {spots.map((s) => {
            if (s.id === 'ball') return <li key={s.id}>⚽ 球 → 网格 ({s.col},{s.row})</li>;
            const pl = playerOf(s.id);
            return <li key={s.id}>{pl?.team === 'A' ? '🔴' : '🔵'} {pl?.name}（{profOf(pl!)}）→ 网格 ({s.col},{s.row})</li>;
          })}
        </ul>
        <p className="text-xs text-muted-foreground mt-2">
          这只是联合状态空间中的一个点；完整的 10×10 网格位置逻辑图（含移动/冲刺/位移技能事件）见「图编辑 → 位置逻辑」，
          其优先级由总超图 DFS 统一裁决（见「优先级计算」）。
        </p>
      </div>
    </div>
  );
}
