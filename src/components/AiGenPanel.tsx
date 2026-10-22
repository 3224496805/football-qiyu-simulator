import { useState } from 'react';
import type { DomainGraph, EntityKind, Scenario } from '@/types/model';
import { makeGraph } from '@/lib/defaultScenario';
import { newId } from '@/lib/storage';

interface Props {
  scenario: Scenario;
  onAddGraph: (g: DomainGraph) => void;
}

// AI 生成逻辑图 + 事件：生成提示词 → 到 Kimi 对话粘贴 → 把返回的 JSON 粘回导入为新逻辑图
export default function AiGenPanel({ scenario, onAddGraph }: Props) {
  const [desc, setDesc] = useState('');
  const [prompt, setPrompt] = useState('');
  const [json, setJson] = useState('');
  const [msg, setMsg] = useState('');

  const buildPrompt = () => {
    const p = `你是一名足球游戏状态机设计师。请为「足球奇域模拟器」设计一张状态逻辑图，只输出严格 JSON（不要 Markdown 代码块外的任何文字）。

【游戏背景】3v3 足球：角色实体（前锋/中场/后卫三职业，两队共 6 人）+ 球实体。状态逻辑图描述某类实体上的状态与转换事件；事件 = 条件 + 执行的状态变化（本质是超图边的限定描述）。同名状态跨图自动粘合。

【当前已有逻辑图】${Object.values(scenario.graphs).map((g) => `${g.name}(${g.owner === 'player' ? '角色' : '球'})`).join('、')}

【输出 JSON 格式】
{"name":"逻辑图名","owner":"player|ball",
 "nodes":[{"name":"状态名","x":200,"y":200,"note":"备注","timeLimit":{"ticks":3,"timeoutEvent":"事件名"}}],
 "edges":[{"event":"事件名","from":"状态名","to":"状态名","condition":"条件描述",
   "trigger":"active|passive","listenEvents":["被监听事件名"],
   "preStates":[{"graph":"逻辑图id","state":"状态名","not":false}],
   "isHyper":false,"basePriority":1,"cooldown":0,"structWeight":1}]}

【硬性要求】
1. from/to 必须引用 nodes 里已有的状态名；self-loop 允许。
2. trigger=passive 时 listenEvents 至少一个；timeLimit.timeoutEvent 必须是一条出边的事件名。
3. preStates.graph 只能是：${Object.keys(scenario.graphs).join(' / ')}；not=true 表示"必须不处于"。
4. x/y 给 100~900 之间的整数坐标，便于直接可视化。
5. 事件条件尽量写成可判定的（位置/距离/血量阈值/按键等）。

【设计需求】${desc || '（请在此描述你想设计的玩法逻辑）'}`;
    setPrompt(p);
    setMsg('');
  };

  const doImport = () => {
    try {
      const data = JSON.parse(json);
      if (!data.name || !Array.isArray(data.nodes) || data.nodes.length === 0) throw new Error('缺少 name 或 nodes');
      const owner: EntityKind = data.owner === 'ball' ? 'ball' : 'player';
      const names = new Set<string>(data.nodes.map((n: { name: string }) => n.name));
      const edges = (data.edges ?? []).map((e: Record<string, unknown>) => {
        if (!names.has(String(e.from)) || !names.has(String(e.to))) throw new Error(`边「${e.event}」引用了不存在的状态`);
        return e;
      });
      const g = makeGraph(newId(), owner, String(data.name),
        data.nodes.map((n: Record<string, unknown>, i: number) => ({
          name: String(n.name),
          x: typeof n.x === 'number' ? n.x : 120 + (i % 4) * 220,
          y: typeof n.y === 'number' ? n.y : 140 + Math.floor(i / 4) * 160,
          note: n.note ? String(n.note) : undefined,
          timeLimit: n.timeLimit && typeof (n.timeLimit as { ticks?: number }).ticks === 'number'
            ? { ticks: (n.timeLimit as { ticks: number }).ticks, timeoutEvent: (n.timeLimit as { timeoutEvent?: string }).timeoutEvent }
            : undefined,
        })),
        edges.map((e: Record<string, unknown>) => ({
          event: String(e.event ?? '事件'),
          from: String(e.from), to: String(e.to),
          condition: String(e.condition ?? ''),
          trigger: e.trigger === 'passive' ? 'passive' as const : 'active' as const,
          listenEvents: Array.isArray(e.listenEvents) ? e.listenEvents.map(String) : undefined,
          preStates: Array.isArray(e.preStates) ? e.preStates.map((p: Record<string, unknown>) => ({
            graph: String(p.graph), state: String(p.state), not: !!p.not,
          })) : undefined,
          isHyper: !!e.isHyper, affectsOthers: !!e.affectsOthers,
          basePriority: typeof e.basePriority === 'number' ? e.basePriority : 1,
          cooldown: typeof e.cooldown === 'number' ? e.cooldown : 0,
          structWeight: typeof e.structWeight === 'number' ? e.structWeight : 1,
        })));
      onAddGraph(g);
      setMsg(`已导入逻辑图「${g.name}」：${g.nodes.length} 个状态、${g.edges.length} 条事件`);
      setJson('');
    } catch (err) {
      setMsg('导入失败：' + (err as Error).message);
    }
  };

  return (
    <div className="border rounded p-4 space-y-3 text-sm bg-card">
      <h3 className="font-bold">🤖 AI 生成逻辑图 + 事件（接入 Kimi）</h3>
      <ol className="text-xs text-muted-foreground list-decimal pl-5 space-y-0.5">
        <li>描述你想设计的玩法逻辑，点「生成提示词」并复制；</li>
        <li>把提示词发给 Kimi 对话，让 Kimi 返回 JSON；</li>
        <li>把 JSON 原样粘到下面，点「导入为逻辑图」（同名状态会与现有图自动粘合）。</li>
      </ol>
      <textarea className="w-full border rounded px-2 py-1 bg-background" rows={2}
        placeholder="例如：设计一张「体能逻辑」：体力充沛⇄体力透支，冲刺消耗体力，无球静止时缓慢恢复……"
        value={desc} onChange={(e) => setDesc(e.target.value)} />
      <div className="flex gap-2">
        <button onClick={buildPrompt} className="px-3 py-1 border rounded bg-primary text-primary-foreground">生成提示词</button>
        {prompt && (
          <button onClick={() => { navigator.clipboard.writeText(prompt); setMsg('提示词已复制，去 Kimi 对话粘贴吧'); }}
            className="px-3 py-1 border rounded hover:bg-muted">📋 复制提示词</button>
        )}
      </div>
      {prompt && <textarea className="w-full border rounded px-2 py-1 bg-background text-xs" rows={5} value={prompt} readOnly />}
      <textarea className="w-full border rounded px-2 py-1 bg-background text-xs" rows={4}
        placeholder="把 Kimi 返回的 JSON 粘到这里……" value={json} onChange={(e) => setJson(e.target.value)} />
      <div className="flex items-center gap-2">
        <button onClick={doImport} disabled={!json.trim()} className="px-3 py-1 border rounded bg-emerald-600 text-white disabled:opacity-40">导入为逻辑图</button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
    </div>
  );
}
