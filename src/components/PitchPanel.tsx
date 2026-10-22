// 多人位置联合状态视图：小球场 + 9×9 网格（3×3 区域叠加层），把每名角色和球标注在网格点上
// 多人位置联合状态 = (角色1区域, 角色2区域, …, 球格) 的组合；底层精确坐标保留，逻辑状态 = 3×3 区域
import { useMemo, useRef, useState } from 'react';
import type { Scenario } from '@/types/model';
import { GRID_COLS, GRID_ROWS, ZONE_X, ZONE_Y, gridCenter, zoneOfCell } from '@/lib/defaultScenario';

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
    list.push({ id: 'ball', col: Math.floor(GRID_COLS / 2), row: Math.floor(GRID_ROWS / 2) });
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

  const cellCount = GRID_COLS * GRID_ROWS;
  const jointCount = Math.pow(cellCount, scenario.players.length + 1);

  return (
    <div className="p-4 space-y-4">
      <div className="text-sm text-muted-foreground">
        多人位置联合状态 = 每名角色所在 3×3 区域 + 球所在网格点的组合（底层精确坐标保留在格子上）。
        当前 {scenario.players.length} 名角色 + 1 球，每格 9×9=81 种取值 → 精确联合状态数 = 81^{scenario.players.length + 1} = <b className="text-foreground">{jointCount.toExponential(2)}</b>；
        压缩为区域逻辑状态后（每实体 3×3=9 种）→ 区域联合状态数 = <b className="text-foreground">{Math.pow(9, scenario.players.length + 1).toExponential(2)}</b>。
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

          {/* 3×3 区域叠加层：每 3 格粗线 + 区域名标注 */}
          {[0, 3, 6, 9].map((i) => (
            <g key={`z${i}`}>
              <line x1={MARGIN + i * cellW} y1={MARGIN} x2={MARGIN + i * cellW} y2={PITCH_H - MARGIN} stroke="#fbbf24" strokeWidth={i === 0 || i === 9 ? 0 : 1.6} opacity={i === 0 || i === 9 ? 0 : 0.7} />
              <line x1={MARGIN} y1={MARGIN + i * cellH} x2={PITCH_W - MARGIN} y2={MARGIN + i * cellH} stroke="#fbbf24" strokeWidth={i === 0 || i === 9 ? 0 : 1.6} opacity={i === 0 || i === 9 ? 0 : 0.7} />
            </g>
          ))}
          {[0, 1, 2].map((zx) => [0, 1, 2].map((zy) => {
            const zxName = ZONE_X[zx], zyName = ZONE_Y[zy];
            const cx = MARGIN + (zx * 3 + 0.5) * cellW + cellW; // 区域中心
            const cy = MARGIN + (zy * 3 + 0.5) * cellH + cellH;
            return (
              <text key={`zl${zx}-${zy}`} x={cx} y={cy} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fde68a" opacity={0.85} className="pointer-events-none select-none">
                {zxName}-{zyName}
              </text>
            );
          }))}

          {/* 实体位置 */}
          {spots.map((s) => {
            const p = toPx(s.col, s.row);
            if (s.id === 'ball') {
              return (
                <g key="ball" onMouseDown={(e) => { e.stopPropagation(); setDragId('ball'); }} className="cursor-grab active:cursor-grabbing">
                  <circle cx={p.x} cy={p.y} r={9} fill="#fbbf24" stroke="#78350f" strokeWidth={1.5} />
                  <title>球 @ 网格 ({s.col},{s.row}) · 区域 {zoneOfCell(s.col, s.row)} · 坐标 {gridCenter(s.col, s.row).x},{gridCenter(s.col, s.row).y}</title>
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
                <title>{pl.name}（{profOf(pl)}）@ 网格 ({s.col},{s.row}) · 区域 {zoneOfCell(s.col, s.row)} · 坐标 {gridCenter(s.col, s.row).x},{gridCenter(s.col, s.row).y}</title>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="border rounded p-3 text-sm">
        <h4 className="font-bold mb-2">当前联合位置状态</h4>
        <ul className="text-xs space-y-0.5">
          {spots.map((s) => {
            if (s.id === 'ball') return <li key={s.id}>⚽ 球 → 网格 ({s.col},{s.row}) · 区域 {zoneOfCell(s.col, s.row)}</li>;
            const pl = playerOf(s.id);
            return <li key={s.id}>{pl?.team === 'A' ? '🔴' : '🔵'} {pl?.name}（{profOf(pl!)}）→ 网格 ({s.col},{s.row}) · 区域 {zoneOfCell(s.col, s.row)}</li>;
          })}
        </ul>
        <p className="text-xs text-muted-foreground mt-2">
          这只是联合状态空间中的一个点；位置逻辑图以 3×3 区域为状态（9×9 网格底层坐标，含移动/冲刺/位移技能事件，区域内移动不产生逻辑事件）见「图编辑 → 位置逻辑」，
          其优先级由总超图 DFS 统一裁决（见「优先级计算」）。
        </p>
      </div>
    </div>
  );
}
