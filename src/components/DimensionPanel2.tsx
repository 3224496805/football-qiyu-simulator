// 维度管理面板：状态维度（球权/位置/姿态/血量/球路……）和它们的状态列表
// 维度只是事件的分组依据，不存任何转移关系；改名/改状态名会自动同步到事件库和起始状态
import { useState } from 'react';
import type { Dimension, Scenario2 } from '@/types/model2';
import { ENTITY_KINDS, ENTITY_NAMES, newDimensionId } from '@/types/model2';

interface Props {
  sc: Scenario2;
  onChange: (sc: Scenario2) => void;
}

// 哪些事件引用了这个维度/状态（用于删除前拦截）
function referencingEvents(sc: Scenario2, dimId: string, state?: string): string[] {
  const hit = new Set<string>();
  for (const ev of sc.events) {
    for (const f of ev.effects) {
      if (f.dimension === dimId && (state === undefined || f.from === state || f.to === state)) hit.add(ev.name);
    }
    for (const p of ev.preStates) {
      if (p.dimension === dimId && (state === undefined || p.state === state)) hit.add(ev.name);
    }
  }
  return [...hit];
}

export default function DimensionPanel2({ sc, onChange }: Props) {
  const [openDim, setOpenDim] = useState<string | null>(null);

  const mutate = (fn: (draft: Scenario2) => void) => {
    const draft = JSON.parse(JSON.stringify(sc)) as Scenario2;
    fn(draft);
    onChange(draft);
  };

  const addDimension = (owner: Dimension['owner']) => {
    const name = window.prompt(`新维度名称（挂在${ENTITY_NAMES[owner]}身上）`, '新维度');
    if (!name?.trim()) return;
    mutate((d) => {
      d.dimensions.push({
        id: newDimensionId(), name: name.trim(), owner,
        states: ['初始状态'], stateNotes: {},
      });
    });
  };

  const renameDimension = (dim: Dimension) => {
    const name = window.prompt('维度名称', dim.name);
    if (!name?.trim()) return;
    mutate((d) => { d.dimensions.find((x) => x.id === dim.id)!.name = name.trim(); });
  };

  const removeDimension = (dim: Dimension) => {
    const refs = referencingEvents(sc, dim.id);
    if (refs.length > 0) {
      alert(`维度「${dim.name}」还被这些事件引用，不能删除：\n${refs.join('、')}\n请先把这些事件里的相关前提/状态变化删掉。`);
      return;
    }
    if (!confirm(`删除维度「${dim.name}」？其中 ${dim.states.length} 个状态声明将一并删除。`)) return;
    mutate((d) => {
      d.dimensions = d.dimensions.filter((x) => x.id !== dim.id);
      delete d.startState[dim.id];
    });
  };

  const addState = (dim: Dimension) => {
    const name = window.prompt(`在「${dim.name}」里新建状态`, '新状态');
    if (!name?.trim()) return;
    if (dim.states.includes(name.trim())) { alert('同名状态已存在'); return; }
    mutate((d) => { d.dimensions.find((x) => x.id === dim.id)!.states.push(name!.trim()); });
  };

  const renameState = (dim: Dimension, oldName: string) => {
    const name = window.prompt(`把状态「${oldName}」改名为`, oldName);
    if (!name?.trim() || name.trim() === oldName) return;
    const nn = name.trim();
    if (dim.states.includes(nn)) { alert('同名状态已存在'); return; }
    mutate((d) => {
      const dd = d.dimensions.find((x) => x.id === dim.id)!;
      dd.states = dd.states.map((s) => (s === oldName ? nn : s));
      if (dd.stateNotes[oldName]) { dd.stateNotes[nn] = dd.stateNotes[oldName]; delete dd.stateNotes[oldName]; }
      // 同步事件库里的所有引用
      for (const ev of d.events) {
        for (const f of ev.effects) {
          if (f.dimension !== dim.id) continue;
          if (f.from === oldName) f.from = nn;
          if (f.to === oldName) f.to = nn;
        }
        for (const p of ev.preStates) {
          if (p.dimension === dim.id && p.state === oldName) p.state = nn;
        }
      }
      if (d.startState[dim.id] === oldName) d.startState[dim.id] = nn;
    });
  };

  const removeState = (dim: Dimension, state: string) => {
    const refs = referencingEvents(sc, dim.id, state);
    if (refs.length > 0) {
      alert(`状态「${state}」还被这些事件引用，不能删除：\n${refs.join('、')}\n请先把这些事件里的相关前提/状态变化删掉。`);
      return;
    }
    if (!confirm(`从「${dim.name}」里删除状态「${state}」？`)) return;
    mutate((d) => {
      const dd = d.dimensions.find((x) => x.id === dim.id)!;
      dd.states = dd.states.filter((s) => s !== state);
      delete dd.stateNotes[state];
      if (d.startState[dim.id] === state) delete d.startState[dim.id];
    });
  };

  return (
    <div className="p-2 space-y-2">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        维度是事件的分组依据（哪个维度、挂在角色还是球身上）。转移关系都在事件里，这里只管"有哪些维度、每个维度声明了哪些状态"。
      </p>
      {ENTITY_KINDS.map((owner) => (
        <div key={owner} className="border rounded-lg">
          <div className="px-2 py-1.5 bg-muted/50 font-bold text-xs flex items-center justify-between">
            <span>{ENTITY_NAMES[owner]}的维度</span>
            <button onClick={() => addDimension(owner)}
              className="px-2 py-0.5 border border-dashed rounded text-[11px] text-muted-foreground hover:bg-background">
              ＋添加
            </button>
          </div>
          {sc.dimensions.filter((d) => d.owner === owner).map((dim) => (            <div key={dim.id} className="border-t">
              <div className="flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-muted/50"
                onClick={() => setOpenDim(openDim === dim.id ? null : dim.id)}>
                <span className="text-sm font-medium">{dim.name}</span>
                <span className="text-[11px] text-muted-foreground">{dim.states.length} 个状态</span>
                {sc.startState[dim.id] && (
                  <span className="text-[10px] px-1 rounded-full bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
                    起点 {sc.startState[dim.id]}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">{openDim === dim.id ? '▾' : '▸'}</span>
              </div>
              {openDim === dim.id && (
                <div className="px-2 pb-2 space-y-1.5">
                  <div className="flex flex-wrap gap-1">
                    {dim.states.map((s) => (
                      <span key={s} className="inline-flex items-center gap-0.5 border rounded-full pl-2 text-xs">
                        {s}
                        <button title="改名（自动同步到事件库）" onClick={() => renameState(dim, s)}
                          className="px-1 hover:text-blue-600">✎</button>
                        <button title="删除" onClick={() => removeState(dim, s)}
                          className="px-1 hover:text-red-600">✕</button>
                      </span>
                    ))}
                    <button onClick={() => addState(dim)}
                      className="px-2 py-0.5 border border-dashed rounded-full text-xs text-muted-foreground hover:bg-muted">
                      ＋状态
                    </button>
                  </div>
                  <label className="flex items-center gap-1 text-xs">
                    起始状态：
                    <select value={sc.startState[dim.id] ?? ''}
                      onChange={(e) => mutate((d) => {
                        if (e.target.value) d.startState[dim.id] = e.target.value;
                        else delete d.startState[dim.id];
                      })}
                      className="border rounded px-1 py-0.5 bg-background">
                      <option value="">（不设）</option>
                      {dim.states.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <div className="flex gap-1">
                    <button onClick={() => renameDimension(dim)} className="px-2 py-0.5 border rounded text-xs hover:bg-muted">维度改名</button>
                    <button onClick={() => removeDimension(dim)} className="px-2 py-0.5 border rounded text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950">删除维度</button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {sc.dimensions.filter((d) => d.owner === owner).length === 0 && (
            <div className="px-2 py-2 text-xs text-muted-foreground">（还没有）</div>
          )}
        </div>
      ))}

      {/* 平衡参数：全局数值，模拟器和事件数值都从这里取 */}
      <div className="border rounded-lg">
        <div className="px-2 py-1.5 bg-muted/50 font-bold text-xs">平衡参数</div>
        <div className="p-2 grid grid-cols-2 gap-2">
          {([
            ['damage', '伤害基准', '无特殊说明时一次扣血的默认值'],
            ['hpMax', '血量上限', '角色开局和回血的上限'],
            ['attackRange', '攻击距离（格）', '冲击类技能能打到多远的持球者'],
            ['shootRange', '射门距离（格）', '离球门多近才会进入射门待命'],
          ] as const).map(([key, label, tip]) => (
            <label key={key} className="text-xs space-y-0.5" title={tip}>
              <div className="text-muted-foreground">{label}</div>
              <input type="number" min={0} value={sc.balance[key]}
                onChange={(e) => mutate((d) => { d.balance[key] = Math.max(0, Number(e.target.value) || 0); })}
                className="w-full border rounded px-1.5 py-1 bg-background" />
            </label>
          ))}
        </div>
        <p className="px-2 pb-2 text-[10px] text-muted-foreground">
          攻击/射门距离按格数算（斜着相邻算 1 格）；改完去模拟页会自动重置重新开始。
        </p>
      </div>
    </div>
  );
}
