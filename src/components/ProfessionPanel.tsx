// 职业与名册面板：职业 CRUD + 球员-职业分配（同职业 = 相同技能事件集合）
import type { Scenario } from '@/types/model';

interface Props {
  scenario: Scenario;
  onChange: (sc: Scenario) => void;
}

export default function ProfessionPanel({ scenario, onChange }: Props) {
  const professions = scenario.professions;
  const players = scenario.players;

  const addProfession = () =>
    onChange({ ...scenario, professions: [...professions, { id: `prof_${Date.now().toString(36)}`, name: `新职业${professions.length + 1}`, note: '' }] });

  const updateProfession = (id: string, patch: Partial<(typeof professions)[number]>) =>
    onChange({ ...scenario, professions: professions.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const removeProfession = (id: string) => {
    if (players.some((p) => p.professionId === id)) { alert('还有球员属于该职业，请先调整名册'); return; }
    onChange({ ...scenario, professions: professions.filter((p) => p.id !== id) });
  };

  const assign = (playerId: string, professionId: string) =>
    onChange({ ...scenario, players: players.map((p) => (p.id === playerId ? { ...p, professionId } : p)) });

  // 每个职业拥有的事件（从所有角色逻辑域的边统计 professionIds）
  const edgesByProfession = (profId: string) => {
    const out: string[] = [];
    for (const g of Object.values(scenario.graphs)) {
      if (g.owner === 'ball') continue;
      for (const e of g.edges) {
        if (e.professionIds?.includes(profId)) out.push(`${e.event}（${g.name}）`);
      }
    }
    return out;
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg">职业与名册</h3>
          <p className="text-sm text-muted-foreground">
            核心规则：同职业的角色实体共享完全相同的技能事件（伤害/位移）；不同职业拥有不同的技能事件。
            技能事件在图编辑里通过「职业限定」挂在转换边上。
          </p>
        </div>
        <button onClick={addProfession} className="px-3 py-1 border rounded text-sm hover:bg-muted">+ 新职业</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {professions.map((p) => (
          <div key={p.id} className="border rounded p-3 text-sm space-y-2 bg-card">
            <div className="flex items-center gap-2">
              <input className="font-medium border rounded px-2 py-1 flex-1 bg-background" value={p.name}
                onChange={(e) => updateProfession(p.id, { name: e.target.value })} />
              <button onClick={() => removeProfession(p.id)} className="text-muted-foreground hover:text-red-600">✕</button>
            </div>
            <input className="w-full border rounded px-2 py-1 text-xs bg-background" placeholder="职业定位备注"
              value={p.note ?? ''} onChange={(e) => updateProfession(p.id, { note: e.target.value })} />
            <div className="text-xs">
              <div className="text-muted-foreground mb-1">专属技能事件（{edgesByProfession(p.id).length}）：</div>
              {edgesByProfession(p.id).length === 0 && <span className="text-muted-foreground">（仅通用事件）</span>}
              <ul className="list-disc pl-4 space-y-0.5">
                {edgesByProfession(p.id).map((t) => <li key={t}>{t}</li>)}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <div className="border rounded p-3 text-sm">
        <h4 className="font-bold mb-2">球员名册（{players.length} 人，{scenario.playersPerTeam}v{scenario.playersPerTeam}）</h4>
        <table className="w-full">
          <thead className="bg-muted">
            <tr><th className="p-1 text-left">球员</th><th className="p-1 text-left">阵营</th><th className="p-1 text-left">职业（决定技能事件集合）</th></tr>
          </thead>
          <tbody>
            {players.map((pl) => (
              <tr key={pl.id} className="border-t">
                <td className="p-1 font-medium">{pl.name}</td>
                <td className="p-1">{pl.team === 'A' ? '🔴 红队' : '🔵 蓝队'}</td>
                <td className="p-1">
                  <select className="border rounded px-2 py-0.5 bg-background" value={pl.professionId}
                    onChange={(e) => assign(pl.id, e.target.value)}>
                    {professions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
