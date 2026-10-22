// 主界面（v15 重做版）：三栏布局
//   左栏 = 事件库（唯一数据源）+ 维度管理
//   中栏 = 画布：单维度逻辑图 / 总超图（都是事件库的只读派生视图）
//   右栏 = 检查器：事件详情 / 状态详情 / 方案体检
import { useEffect, useMemo, useRef, useState } from 'react';
import GraphView2 from '@/components/GraphView2';
import EventLibrary2 from '@/components/EventLibrary2';
import EventEditor2 from '@/components/EventEditor2';
import DimensionPanel2 from '@/components/DimensionPanel2';
import Inspector2, { type Selection } from '@/components/Inspector2';
import PriorityPanel2 from '@/components/PriorityPanel2';
import SimPanel2 from '@/components/SimPanel2';
import AiGenPanel2 from '@/components/AiGenPanel2';
import { createDefaultScenario2 } from '@/lib/defaultScenario2';
import { buildDimensionGraph, buildTotalGraph } from '@/lib/derive2';
import { APP_VERSION } from '@/lib/version';
import {
  countOldScenarios, deleteScenario, exportScenario, importScenario,
  listScenarios, loadScenario, newScenarioId, saveScenario, takeLoadNotes,
} from '@/lib/storage2';
import { addEffectToEvent, addState, createEventForLink, removeEffect, removeState, type EditResult } from '@/lib/edit2';
import { convertOldScenario, listOldScenarioIds, loadOldScenario } from '@/lib/convert14';
import type { Dimension, QiyuEvent, Scenario2 } from '@/types/model2';
import { newEventId } from '@/types/model2';

const PALETTE = ['#16a34a', '#2563eb', '#9333ea', '#dc2626', '#ea580c', '#0891b2', '#be185d', '#a16207'];

function blankEvent(): QiyuEvent {
  return {
    id: newEventId(), name: '', owner: 'player', trigger: '主动', listen: [], preStates: [], effects: [],
    numeric: [], affectsOthers: false, condition: '', note: '', basePriority: 1, cooldown: 0, professions: [],
  };
}

export default function Home() {
  const [metas, setMetas] = useState(listScenarios);
  const [scenario, setScenario] = useState<Scenario2 | null>(() => {
    const m = listScenarios();
    return m.length > 0 ? loadScenario(m[0].id) : null;
  });
  const [view, setView] = useState<'build' | 'priority' | 'sim' | 'ai'>('build');
  const [mode, setMode] = useState<'single' | 'total'>('single');
  const [curDim, setCurDim] = useState<string>('');
  const [selection, setSelection] = useState<Selection>(null);
  const [editorDraft, setEditorDraft] = useState<QiyuEvent | null>(null);
  const [leftTab, setLeftTab] = useState<'events' | 'dims'>('events');
  const [oldCount] = useState(countOldScenarios);
  const [oldBannerDismissed, setOldBannerDismissed] = useState(false);
  const [loadNotes, setLoadNotes] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null); // 图上写回操作的结果提示
  const [convertReport, setConvertReport] = useState<string[] | null>(null); // 旧档转换报告
  const saveTimer = useRef<number | null>(null);

  // 首次进入时若存档被自动补齐过字段，取回说明
  useEffect(() => {
    setLoadNotes(takeLoadNotes());
  }, []);

  // 首次使用：创建默认示例
  useEffect(() => {
    if (!scenario) {
      const sc = createDefaultScenario2();
      saveScenario(sc);
      setScenario(sc);
      setMetas(listScenarios());
    }
  }, [scenario]);

  // 维度被删光或当前维度没了：自动切到第一个
  useEffect(() => {
    if (scenario && !scenario.dimensions.some((d) => d.id === curDim)) {
      setCurDim(scenario.dimensions[0]?.id ?? '');
    }
  }, [scenario, curDim]);

  // 变更后防抖自动保存
  useEffect(() => {
    if (!scenario) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveScenario(scenario);
      setMetas(listScenarios());
    }, 600);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [scenario]);

  const colors = useMemo(() => {
    const out: Record<string, string> = {};
    scenario?.dimensions.forEach((d, i) => { out[d.id] = PALETTE[i % PALETTE.length]; });
    return out;
  }, [scenario]);

  const graph = useMemo(() => {
    if (!scenario) return null;
    return mode === 'single' && curDim ? buildDimensionGraph(scenario, curDim) : buildTotalGraph(scenario);
  }, [scenario, mode, curDim]);

  const startKeys = useMemo(() => {
    if (!scenario) return [];
    if (mode === 'single') {
      const s = scenario.startState[curDim];
      return s ? [s] : [];
    }
    return Object.values(scenario.startState);
  }, [scenario, mode, curDim]);

  if (!scenario || !graph) return <div className="p-8">加载中…</div>;

  // ---------- 事件库操作 ----------
  const saveEvent = (draft: QiyuEvent) => {
    const next = JSON.parse(JSON.stringify(scenario)) as Scenario2;
    // 保存时把事件里写到、但维度还没声明的状态自动补进维度（不用先建状态再写事件）
    const declare = (dimId: string, state: string) => {
      const d = next.dimensions.find((x) => x.id === dimId);
      if (d && state.trim() && !d.states.includes(state.trim())) d.states.push(state.trim());
    };
    for (const p of draft.preStates) declare(p.dimension, p.state);
    for (const f of draft.effects) { declare(f.dimension, f.from); declare(f.dimension, f.to); }
    const idx = next.events.findIndex((e) => e.id === draft.id);
    if (idx >= 0) next.events[idx] = draft;
    else next.events.push(draft);
    setScenario(next);
    setEditorDraft(null);
    setSelection({ kind: 'event', id: draft.id });
  };
  const duplicateEvent = (ev: QiyuEvent) => {
    const copy: QiyuEvent = JSON.parse(JSON.stringify(ev));
    copy.id = newEventId();
    copy.name = ev.name + '（副本）';
    const idx = scenario.events.findIndex((e) => e.id === ev.id);
    const events = [...scenario.events];
    events.splice(idx + 1, 0, copy);
    setScenario({ ...scenario, events });
  };
  const removeEvent = (ev: QiyuEvent) => {
    const listeners = scenario.events.filter((e) => e.listen.includes(ev.name)).map((e) => e.name);
    const extra = listeners.length > 0 ? `\n注意：「${listeners.join('、')}」正在监听它，删除后那些监听会失效。` : '';
    if (!confirm(`删除事件「${ev.name}」？${extra}`)) return;
    setScenario({ ...scenario, events: scenario.events.filter((e) => e.id !== ev.id) });
    if (selection?.kind === 'event' && selection.id === ev.id) setSelection(null);
  };

  // ---------- 图上直接操作 → 写回事件库 ----------
  const applyEdit = (r: EditResult) => {
    if (!r.ok) { alert(r.error); return; }
    setScenario(r.sc);
    if (r.message) setNotice(r.message);
  };
  const handleAddState = (name: string) => applyEdit(addState(scenario, curDim, name));
  const handleLink = (from: string, to: string, eventId: string | null, newName?: string) => {
    if (eventId) applyEdit(addEffectToEvent(scenario, eventId, curDim, from, to));
    else applyEdit(createEventForLink(scenario, curDim, from, to, newName ?? ''));
  };
  const handleRemoveEffect = (edgeId: string) => {
    if (!confirm('从对应事件里删除这条状态变化？')) return;
    applyEdit(removeEffect(scenario, edgeId));
  };
  const handleRemoveState = (key: string) => {
    if (!confirm(`删除状态「${key}」？`)) return;
    applyEdit(removeState(scenario, curDim, key));
  };

  // ---------- 旧存档一键转换 ----------
  const convertAllOld = () => {
    const olds = listOldScenarioIds();
    if (olds.length === 0) { alert('没有找到旧版存档'); return; }
    if (!confirm(`把 ${olds.length} 个旧版方案转换成新版事件库格式？\n转换结果另存为新方案（名字带"（转换）"），旧数据原样保留。`)) return;
    const lines: string[] = [];
    let ok = 0;
    for (const m of olds) {
      const old = loadOldScenario(m.id);
      if (!old) { lines.push(`方案「${m.name}」读取失败，已跳过`, ''); continue; }
      const { sc2, report } = convertOldScenario(old);
      saveScenario(sc2);
      ok++;
      lines.push(...report, '');
    }
    setMetas(listScenarios());
    setConvertReport(lines);
  };

  // ---------- 方案管理 ----------
  const newScenario = () => {
    const sc = createDefaultScenario2();
    sc.name = `新方案 ${new Date().toLocaleTimeString()}`;
    saveScenario(sc);
    setScenario(sc);
    setMetas(listScenarios());
    setSelection(null);
  };
  const dupScenario = () => {
    const copy: Scenario2 = JSON.parse(JSON.stringify(scenario));
    copy.id = newScenarioId();
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
    setSelection(null);
    setScenario(m.length > 0 ? loadScenario(m[0].id) : null);
  };
  const doExport = () => {
    const blob = new Blob([exportScenario(scenario)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${scenario.name}.qiyu2.json`;
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

  // ---------- AI 生成的事件入库 ----------
  const handleAiImport = (events: QiyuEvent[], dims: Dimension[], msg: string) => {
    const next = JSON.parse(JSON.stringify(scenario)) as Scenario2;
    next.dimensions.push(...dims);
    next.events.push(...events);
    for (const d of dims) {
      if (!next.startState[d.id] && d.states.length > 0) next.startState[d.id] = d.states[0];
    }
    setScenario(next);
    setNotice('AI 生成入库：' + msg);
  };

  const selEventId = selection?.kind === 'event' ? selection.id : null;
  const selNodeKey = selection?.kind === 'node' ? selection.id : null;
  const curDimName = scenario.dimensions.find((d) => d.id === curDim)?.name ?? '';

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-4 py-2.5 flex items-center gap-3 flex-wrap bg-card">
        <h1 className="text-xl font-bold">⚽ 足球奇域模拟器</h1>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
          title="构建版本：若与你预期不符请强刷（Ctrl+F5）或换新窗口打开">{APP_VERSION}</span>
        <select className="border rounded px-2 py-1 text-sm bg-background" value={scenario.id}
          onChange={(e) => { const sc = loadScenario(e.target.value); if (sc) { setScenario(sc); setSelection(null); setLoadNotes(takeLoadNotes()); } }}>
          {metas.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input className="border rounded px-2 py-1 text-sm w-40 bg-background" value={scenario.name}
          onChange={(e) => setScenario({ ...scenario, name: e.target.value })} />
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

      {oldCount > 0 && !oldBannerDismissed && (
        <div className="bg-blue-50 dark:bg-blue-950/40 border-b border-blue-300 px-4 py-2 text-xs flex items-start gap-2">
          <span className="flex-1">
            检测到 {oldCount} 个旧版存档（v14 及以前的"逻辑图直存"格式）。可以一键转换成新版事件库格式
            （同名边自动合并成一条事件，另存为新方案，旧数据原样保留）。
          </span>
          <button onClick={convertAllOld} className="shrink-0 px-2 py-0.5 border rounded bg-blue-600 text-white hover:bg-blue-700">现在转换</button>
          <button onClick={() => setOldBannerDismissed(true)} className="shrink-0 px-2 py-0.5 border rounded hover:bg-blue-100 dark:hover:bg-blue-900">知道了</button>
        </div>
      )}

      {convertReport && (
        <div className="bg-green-50 dark:bg-green-950/40 border-b border-green-300 px-4 py-2 text-xs flex items-start gap-2">
          <span className="font-bold text-green-700 dark:text-green-300 shrink-0">✓ 转换报告：</span>
          <div className="flex-1 max-h-36 overflow-auto space-y-0.5">
            {convertReport.map((l, i) => <div key={i}>{l || ' '}</div>)}
          </div>
          <button onClick={() => setConvertReport(null)} className="shrink-0 px-2 py-0.5 border rounded hover:bg-green-100 dark:hover:bg-green-900">知道了</button>
        </div>
      )}

      {notice && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-300 px-4 py-1.5 text-xs flex items-center gap-2">
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 px-2 py-0.5 border rounded hover:bg-emerald-100 dark:hover:bg-emerald-900">知道了</button>
        </div>
      )}

      {loadNotes.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-300 px-4 py-2 text-xs flex items-start gap-2">
          <span className="font-bold text-amber-700 dark:text-amber-300 shrink-0">⚠ 存档自动修复说明：</span>
          <ul className="list-disc ml-4 flex-1 space-y-0.5">
            {loadNotes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
          <button onClick={() => setLoadNotes([])} className="shrink-0 px-2 py-0.5 border rounded hover:bg-amber-100 dark:hover:bg-amber-900">知道了</button>
        </div>
      )}

      <nav className="border-b flex gap-1 px-4 pt-2 bg-card">
        {([['build', '编排'], ['priority', '优先级'], ['sim', '动态模拟'], ['ai', 'AI 生成']] as const).map(([v, label]) => (
          <button key={v} onClick={() => setView(v)}
            className={`px-4 py-1.5 rounded-t text-sm font-medium ${view === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            {label}
          </button>
        ))}
      </nav>

      {view === 'build' && (
      <div className="border-b px-4 py-1.5 flex items-center gap-2 flex-wrap bg-card">
        <div className="flex border rounded overflow-hidden">
          <button onClick={() => setMode('single')}
            className={`px-3 py-1 text-sm ${mode === 'single' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            单维度逻辑图
          </button>
          <button onClick={() => setMode('total')}
            className={`px-3 py-1 text-sm ${mode === 'total' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            总超图
          </button>
        </div>
        {mode === 'single' && scenario.dimensions.map((d) => (
          <button key={d.id} onClick={() => setCurDim(d.id)}
            className={`px-3 py-1 rounded text-sm border ${curDim === d.id ? 'text-white' : 'bg-background'}`}
            style={curDim === d.id
              ? { background: colors[d.id] }
              : { borderColor: colors[d.id], color: colors[d.id] }}>
            {d.name}
          </button>
        ))}
        <span className="text-xs text-muted-foreground ml-1">
          {mode === 'single'
            ? `「${curDimName}」的逻辑图 = 事件库里落在该维度的状态变化（改事件库它自动变）`
            : '总超图 = 全部维度合并、同名状态粘合，代表整个奇域关卡的精准状态（只读）'}
        </span>
      </div>
      )}

      {view === 'build' && (
      <div className="flex-1 flex min-h-0">
        <aside className="w-[330px] shrink-0 border-r flex flex-col min-h-0">
          <div className="flex border-b">
            <button onClick={() => setLeftTab('events')}
              className={`flex-1 py-1.5 text-sm font-medium ${leftTab === 'events' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:bg-muted'}`}>
              事件库（{scenario.events.length}）
            </button>
            <button onClick={() => setLeftTab('dims')}
              className={`flex-1 py-1.5 text-sm font-medium ${leftTab === 'dims' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:bg-muted'}`}>
              维度（{scenario.dimensions.length}）
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            {leftTab === 'events'
              ? <EventLibrary2 sc={scenario} selectedEventId={selEventId}
                  onSelect={(id) => setSelection(id ? { kind: 'event', id } : null)}
                  onNew={() => setEditorDraft(blankEvent())}
                  onEdit={(ev) => setEditorDraft(JSON.parse(JSON.stringify(ev)) as QiyuEvent)}
                  onDuplicate={duplicateEvent}
                  onDelete={removeEvent} />
              : <DimensionPanel2 sc={scenario} onChange={setScenario} />}
          </div>
        </aside>

        <main className="flex-1 min-w-0 min-h-0">
          <GraphView2 sc={scenario} graph={graph} mode={mode} colors={colors} singleDimId={curDim}
            dimOwner={scenario.dimensions.find((d) => d.id === curDim)?.owner}
            startKeys={startKeys}
            selectedEventId={selEventId} selectedNodeKey={selNodeKey}
            onSelectEvent={(id) => setSelection({ kind: 'event', id })}
            onSelectNode={(key) => setSelection(key ? { kind: 'node', id: key } : null)}
            onAddState={mode === 'single' ? handleAddState : undefined}
            onLink={mode === 'single' ? handleLink : undefined}
            onRemoveEffect={mode === 'single' ? handleRemoveEffect : undefined}
            onRemoveState={mode === 'single' ? handleRemoveState : undefined} />
        </main>

        <aside className="w-[330px] shrink-0 border-l overflow-auto bg-card">
          <Inspector2 sc={scenario} graph={graph} selection={selection}
            onSelectEvent={(id) => setSelection({ kind: 'event', id })}
            onEditEvent={(ev) => setEditorDraft(JSON.parse(JSON.stringify(ev)) as QiyuEvent)} />
        </aside>
      </div>
      )}

      {view === 'priority' && (
        <div className="flex-1 overflow-auto"><PriorityPanel2 sc={scenario} onChange={setScenario} /></div>
      )}
      {view === 'sim' && (
        <div className="flex-1 overflow-hidden"><SimPanel2 sc={scenario} /></div>
      )}
      {view === 'ai' && (
        <div className="flex-1 overflow-auto"><AiGenPanel2 sc={scenario} onImport={handleAiImport} /></div>
      )}

      <EventEditor2 open={editorDraft !== null} initial={editorDraft ?? blankEvent()} sc={scenario}
        onSave={saveEvent} onClose={() => setEditorDraft(null)} />
    </div>
  );
}
