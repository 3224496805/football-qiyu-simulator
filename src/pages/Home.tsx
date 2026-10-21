import { useEffect, useMemo, useRef, useState } from 'react';
import GraphCanvas from '@/components/GraphCanvas';
import EdgeDialog from '@/components/EdgeDialog';
import PriorityPanel from '@/components/PriorityPanel';
import SuggestPanel from '@/components/SuggestPanel';
import SkillPanel from '@/components/SkillPanel';
import TotalGraphPanel from '@/components/TotalGraphPanel';
import SearchTreePanel from '@/components/SearchTreePanel';
import CompositePanel from '@/components/CompositePanel';
import ProfessionPanel from '@/components/ProfessionPanel';
import PitchPanel from '@/components/PitchPanel';
import SimPanel from '@/components/SimPanel';
import { buildRoster, createDefaultScenario, emptyGraph } from '@/lib/defaultScenario';
import { computePriorities, suggest } from '@/lib/priority';
import { deleteScenario, exportScenario, importScenario, listScenarios, loadScenario, newId, saveScenario } from '@/lib/storage';
import type { DomainEdge, DomainGraph, DomainId, Scenario } from '@/types/model';
import { ENTITY_NAMES } from '@/types/model';

// 逻辑图颜色（按 id 前缀取色，自定义图也有稳定颜色）
const GRAPH_COLORS = ['#16a34a', '#2563eb', '#9333ea', '#dc2626', '#ea580c', '#0891b2', '#be185d', '#a16207'];
function graphColor(id: string, graphs: Scenario['graphs']): string {
  const keys = Object.keys(graphs);
  const i = Math.max(0, keys.indexOf(id));
  return GRAPH_COLORS[i % GRAPH_COLORS.length];
}

const TABS = ['图编辑', '位置联合状态', '复合预览', '总超图', 'DFS 搜索树', '优先级计算', '参数建议', '职业名册', '技能模板', '动态模拟'] as const;

export default function Home() {
  const [metas, setMetas] = useState(listScenarios);
  const [scenario, setScenario] = useState<Scenario | null>(() => {
    const m = listScenarios();
    return m.length > 0 ? loadScenario(m[0].id) : null;
  });
  const [tab, setTab] = useState<(typeof TABS)[number]>('图编辑');
  const [domain, setDomain] = useState<DomainId>('possession');
  const [alpha, setAlpha] = useState(0.5);
  const [editingEdgeId, setEditingEdgeId] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  // 首次使用：创建默认示例
  useEffect(() => {
    if (!scenario) {
      const sc = createDefaultScenario();
      saveScenario(sc);
      setScenario(sc);
      setMetas(listScenarios());
    }
  }, [scenario]);

  // 变更后防抖自动保存（方案隔离存储）
  useEffect(() => {
    if (!scenario) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveScenario(scenario);
      setMetas(listScenarios());
    }, 600);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [scenario]);

  const result = useMemo(() => (scenario ? computePriorities(scenario, alpha) : null), [scenario, alpha]);
  const suggestions = useMemo(() => (scenario && result ? suggest(scenario, result) : []), [scenario, result]);

  if (!scenario || !result) return <div className="p-8">加载中…</div>;

  const graph = scenario.graphs[domain];

  const updateGraph = (g: DomainGraph) =>
    setScenario({ ...scenario, graphs: { ...scenario.graphs, [g.id]: g } });

  // ---------- 逻辑图管理：自由增删改名 ----------
  const graphList = Object.values(scenario.graphs);
  const addGraph = (owner: 'player' | 'ball') => {
    const name = window.prompt(`新逻辑图名称（挂在${ENTITY_NAMES[owner]}上）`, '新逻辑图');
    if (!name) return;
    const g = emptyGraph(owner, name);
    setScenario({ ...scenario, graphs: { ...scenario.graphs, [g.id]: g } });
    setDomain(g.id);
  };
  const renameGraph = (g: DomainGraph) => {
    const name = window.prompt('逻辑图名称', g.name);
    if (name) updateGraph({ ...g, name });
  };
  const removeGraph = (g: DomainGraph) => {
    const sameOwner = graphList.filter((x) => x.owner === g.owner);
    if (sameOwner.length <= 1) { alert(`${ENTITY_NAMES[g.owner]}至少需要保留一张逻辑图`); return; }
    if (!confirm(`删除逻辑图「${g.name}」？其中 ${g.nodes.length} 个状态、${g.edges.length} 条事件将一并删除。`)) return;
    const next = { ...scenario.graphs };
    delete next[g.id];
    setScenario({ ...scenario, graphs: next });
    setDomain(Object.values(next).find((x) => x.owner === g.owner)?.id ?? Object.keys(next)[0]);
  };

  const updateEdge = (edge: DomainEdge) =>
    updateGraph({ ...graph, edges: graph.edges.map((e) => (e.id === edge.id ? edge : e)) });

  const editingEdge = graph.edges.find((e) => e.id === editingEdgeId) ?? null;
  const editingFrom = editingEdge ? graph.nodes.find((n) => n.id === editingEdge.from)?.name ?? '' : '';
  const editingTo = editingEdge ? graph.nodes.find((n) => n.id === editingEdge.to)?.name ?? '' : '';

  // ---------- 方案管理 ----------
  const newScenario = () => {
    const sc = createDefaultScenario();
    sc.name = `新方案 ${new Date().toLocaleTimeString()}`;
    saveScenario(sc);
    setScenario(sc);
    setMetas(listScenarios());
  };
  const dupScenario = () => {
    const copy: Scenario = JSON.parse(JSON.stringify(scenario));
    copy.id = newId();
    copy.name = scenario.name + '（副本）';
    copy.createdAt = copy.updatedAt = Date.now();
    saveScenario(copy);
    setScenario(copy);
    setMetas(listScenarios());
  };
  const delScenario = () => {
    if (!confirm(`删除方案「${scenario.name}」？不可恢复。`)) return;
    deleteScenario(scenario.id);
    const m = listScenarios();
    setMetas(m);
    setScenario(m.length > 0 ? loadScenario(m[0].id) : null);
  };
  const doExport = () => {
    const blob = new Blob([exportScenario(scenario)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${scenario.name}.qiyu.json`;
    a.click();
  };
  const doImport = (file: File) => {
    file.text().then((txt) => {
      try {
        const sc = importScenario(txt);
        saveScenario(sc);
        setScenario(sc);
        setMetas(listScenarios());
      } catch (e) { alert('导入失败：' + (e as Error).message); }
    });
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b px-4 py-3 flex items-center gap-3 flex-wrap bg-card">
        <h1 className="text-xl font-bold">⚽ 足球奇域模拟器</h1>
        <select className="border rounded px-2 py-1 text-sm bg-background" value={scenario.id}
          onChange={(e) => { const sc = loadScenario(e.target.value); if (sc) setScenario(sc); }}>
          {metas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input className="border rounded px-2 py-1 text-sm w-40 bg-background" value={scenario.name}
          onChange={(e) => setScenario({ ...scenario, name: e.target.value })} />
        <div className="flex items-center gap-1 text-sm">
          <span>每队</span>
          <input type="number" min={1} max={4} className="border rounded px-1 w-14 bg-background" value={scenario.playersPerTeam}
            onChange={(e) => {
              const n = Math.max(1, Math.min(4, +e.target.value));
              setScenario({ ...scenario, playersPerTeam: n, players: buildRoster(n, scenario.professions) });
            }} />
          <span>人（总数上限 8）</span>
        </div>
        <div className="flex gap-1 ml-auto flex-wrap">
          <button onClick={newScenario} className="px-2 py-1 border rounded text-sm hover:bg-muted">新建</button>
          <button onClick={dupScenario} className="px-2 py-1 border rounded text-sm hover:bg-muted">复制</button>
          <button onClick={doExport} className="px-2 py-1 border rounded text-sm hover:bg-muted">导出</button>
          <label className="px-2 py-1 border rounded text-sm hover:bg-muted cursor-pointer">
            导入
            <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
          </label>
          <button onClick={delScenario} className="px-2 py-1 border rounded text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950">删除</button>
        </div>
      </header>

      <nav className="border-b flex gap-1 px-4 pt-2 bg-card">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-t text-sm font-medium ${tab === t ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            {t}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-hidden">
        {tab === '图编辑' && (
          <div className="h-full flex flex-col">
            <div className="px-4 py-2 border-b space-y-1">
              {(['player', 'ball'] as const).map((kind) => (
                <div key={kind} className="flex gap-1 flex-wrap items-center">
                  <span className="text-xs font-bold text-muted-foreground w-16">{ENTITY_NAMES[kind]}</span>
                  {graphList.filter((g) => g.owner === kind).map((g) => (
                    <button key={g.id} onClick={() => setDomain(g.id)}
                      className={`px-3 py-1 rounded text-sm border ${domain === g.id ? 'text-white' : 'bg-background'}`}
                      style={domain === g.id ? { background: graphColor(g.id, scenario.graphs) } : { borderColor: graphColor(g.id, scenario.graphs), color: graphColor(g.id, scenario.graphs) }}>
                      {g.name}
                    </button>
                  ))}
                  <button onClick={() => addGraph(kind)}
                    className="px-2 py-1 rounded text-xs border border-dashed text-muted-foreground hover:bg-muted">
                    ＋添加逻辑图
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                <span>
                  实体上的状态逻辑图可自由增删改名；{scenario.players.length} 个角色共享角色逻辑图（技能边按职业区分），1 个球独立拥有球路逻辑；跨逻辑图同名状态在总超图中自动粘合，权威优先级 = 总超图 DFS。
                </span>
                {graph && (
                  <span className="flex gap-1 ml-auto">
                    <button onClick={() => renameGraph(graph)} className="px-2 py-0.5 border rounded hover:bg-muted">改名</button>
                    <button onClick={() => removeGraph(graph)} className="px-2 py-0.5 border rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950">删除此图</button>
                  </span>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <div className="p-2 h-full min-w-[920px] min-h-[560px]">
                <GraphCanvas graph={graph} onChange={updateGraph} onEditEdge={setEditingEdgeId} color={graphColor(domain, scenario.graphs)} />
              </div>
            </div>
          </div>
        )}
        {tab === '位置联合状态' && <PitchPanel scenario={scenario} onChange={setScenario} />}
        {tab === '复合预览' && <CompositePanel scenario={scenario} />}
        {tab === '总超图' && <TotalGraphPanel scenario={scenario} result={result} />}
        {tab === 'DFS 搜索树' && <SearchTreePanel scenario={scenario} result={result} alpha={alpha} />}
        {tab === '优先级计算' && <PriorityPanel result={result} scenario={scenario} alpha={alpha} onAlpha={setAlpha} />}
        {tab === '参数建议' && (
          <SuggestPanel scenario={scenario} result={result} suggestions={suggestions}
            onBalance={(balance) => setScenario({ ...scenario, balance })} />
        )}
        {tab === '职业名册' && (
          <ProfessionPanel scenario={scenario} onChange={setScenario} />
        )}
        {tab === '动态模拟' && <SimPanel scenario={scenario} result={result} />}
        {tab === '技能模板' && (
          <SkillPanel scenario={scenario} onChange={(skills) => setScenario({ ...scenario, skills })} />
        )}
      </main>

      <EdgeDialog edge={editingEdge} fromName={editingFrom} toName={editingTo}
        skills={scenario.skills} professions={scenario.professions}
        showProfessions={graph.owner === 'player'}
        onSave={updateEdge} onClose={() => setEditingEdgeId(null)} />
    </div>
  );
}
