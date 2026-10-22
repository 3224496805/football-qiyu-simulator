import { useState } from 'react';
import type { DomainGraph, EntityKind, Scenario } from '@/types/model';
import { makeGraph } from '@/lib/defaultScenario';
import { newId } from '@/lib/storage';

const KEY_STORE = 'qiyu:kimi-key';
const MODEL_STORE = 'qiyu:kimi-model';
const ENDPOINT = 'https://api.moonshot.cn/v1/chat/completions';
const MODELS = ['kimi-k2.6', 'kimi-k3', 'moonshot-v1-8k', 'moonshot-v1-32k'];

interface Props {
  scenario: Scenario;
  onAddGraph: (g: DomainGraph) => void;
}

// AI 生成逻辑图 + 事件：
//   一键模式：填 Key（只存本浏览器）→ 描述需求 → 直接调用 Kimi API 生成 JSON → 校验入库；
//   手动模式（备用）：生成提示词 → 复制到 Kimi 对话 → 把返回 JSON 粘回导入。
export default function AiGenPanel({ scenario, onAddGraph }: Props) {
  const [desc, setDesc] = useState('');
  const [prompt, setPrompt] = useState('');
  const [json, setJson] = useState('');
  const [msg, setMsg] = useState('');
  const [key, setKey] = useState(() => localStorage.getItem(KEY_STORE) ?? '');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_STORE) ?? MODELS[0]);
  const [busy, setBusy] = useState(false);

  const buildPromptText = () => `你是一名足球游戏状态机设计师。请为「足球奇域模拟器」设计一张状态逻辑图，只输出严格 JSON（不要 Markdown 代码块外的任何文字）。

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

  const buildPrompt = () => {
    setPrompt(buildPromptText());
    setMsg('');
  };

  // 校验并导入（一键/手动共用）：返回 { ok, msg }
  const importFromText = (text: string): { ok: boolean; msg: string } => {
    try {
      const data = JSON.parse(text);
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
      return { ok: true, msg: `已导入逻辑图「${g.name}」：${g.nodes.length} 个状态、${g.edges.length} 条事件` };
    } catch (err) {
      return { ok: false, msg: '导入失败：' + (err as Error).message };
    }
  };

  const doImport = () => {
    const r = importFromText(json);
    setMsg(r.msg);
    if (r.ok) setJson('');
  };

  // 从模型返回的文本中提取 JSON 本体（容忍 Markdown 代码块包裹）
  const extractJson = (text: string) => {
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s < 0 || e <= s) throw new Error('返回内容里没有 JSON');
    return text.slice(s, e + 1);
  };

  const callKimi = async (useJsonMode: boolean) => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.trim()}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: '你是严格输出 JSON 的足球游戏状态机设计师。只输出 JSON 本体，不要输出 Markdown 代码块或任何解释文字。' },
          { role: 'user', content: buildPromptText() },
        ],
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}：${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? '';
  };

  // 一键生成并入库：直连 Kimi API（api.moonshot.cn 支持浏览器跨域）
  const generate = async () => {
    if (!key.trim()) { setMsg('请先填写 Kimi API Key（只保存在本浏览器）'); return; }
    if (!desc.trim()) { setMsg('请先描述设计需求'); return; }
    setBusy(true);
    setMsg('正在调用 Kimi 生成…');
    try {
      let content: string;
      try {
        content = await callKimi(true); // 优先 JSON 模式
      } catch (err) {
        const m = (err as Error).message;
        // 仅当模型不支持 JSON 模式（400）时回退普通模式再提取；其余错误直接抛出
        if (!m.includes('400')) throw err;
        content = await callKimi(false);
      }
      const r = importFromText(extractJson(content));
      setMsg(r.ok ? `⚡ ${r.msg}` : r.msg + '（可改用下方手动模式）');
      if (r.ok) setJson('');
    } catch (err) {
      setMsg('生成失败：' + (err as Error).message + '（可改用下方手动模式）');
    } finally {
      setBusy(false);
    }
  };

  const saveKey = (v: string) => {
    setKey(v);
    localStorage.setItem(KEY_STORE, v.trim());
  };
  const saveModel = (v: string) => {
    setModel(v);
    localStorage.setItem(MODEL_STORE, v);
  };

  return (
    <div className="border rounded p-4 space-y-3 text-sm bg-card">
      <h3 className="font-bold">🤖 AI 生成逻辑图 + 事件（Kimi API 一键入库）</h3>
      <ol className="text-xs text-muted-foreground list-decimal pl-5 space-y-0.5">
        <li>填入你的 Kimi API Key（仅保存在当前浏览器，可勾选显示核对）；</li>
        <li>描述想设计的玩法逻辑，点「⚡ 一键生成并入库」——自动调用 Kimi、校验并直接加入逻辑图列表；</li>
        <li>生成失败时可改用备用手动模式：复制提示词到 Kimi 对话，把返回 JSON 粘回导入。</li>
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <input type={showKey ? 'text' : 'password'} className="border rounded px-2 py-1 bg-background w-64"
            placeholder="Kimi API Key（sk-…）"
            value={key} onChange={(e) => saveKey(e.target.value)} />
          <button onClick={() => setShowKey(!showKey)} className="px-2 py-1 border rounded text-xs hover:bg-muted">{showKey ? '🙈' : '👁'}</button>
        </div>
        <select className="border rounded px-2 py-1 bg-background" value={model} onChange={(e) => saveModel(e.target.value)}>
          {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <a href="https://platform.kimi.com/" target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
          去 Kimi 开放平台获取 Key →
        </a>
      </div>

      <textarea className="w-full border rounded px-2 py-1 bg-background" rows={2}
        placeholder="例如：设计一张「体能逻辑」：体力充沛⇄体力透支，冲刺消耗体力，无球静止时缓慢恢复……"
        value={desc} onChange={(e) => setDesc(e.target.value)} />

      <div className="flex gap-2 flex-wrap">
        <button onClick={generate} disabled={busy}
          className="px-3 py-1 border rounded bg-primary text-primary-foreground disabled:opacity-40">
          {busy ? '生成中…' : '⚡ 一键生成并入库'}
        </button>
        <button onClick={buildPrompt} className="px-3 py-1 border rounded hover:bg-muted">生成提示词（手动模式）</button>
        {prompt && (
          <button onClick={() => { navigator.clipboard.writeText(prompt); setMsg('提示词已复制，去 Kimi 对话粘贴吧'); }}
            className="px-3 py-1 border rounded hover:bg-muted">📋 复制提示词</button>
        )}
      </div>

      {prompt && <textarea className="w-full border rounded px-2 py-1 bg-background text-xs" rows={5} value={prompt} readOnly />}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">手动模式：粘贴 Kimi 返回的 JSON 导入</summary>
        <textarea className="w-full border rounded px-2 py-1 bg-background text-xs mt-2" rows={4}
          placeholder="把 Kimi 返回的 JSON 粘到这里……" value={json} onChange={(e) => setJson(e.target.value)} />
        <div className="flex items-center gap-2 mt-2">
          <button onClick={doImport} disabled={!json.trim()} className="px-3 py-1 border rounded bg-emerald-600 text-white disabled:opacity-40">导入为逻辑图</button>
        </div>
      </details>

      {msg && <div className="text-xs text-muted-foreground border-t pt-2">{msg}</div>}
      <p className="text-[11px] text-muted-foreground">
        🔒 安全说明：Key 仅保存在当前浏览器的 localStorage，不会上传到任何服务器，也不会进入源码仓库；共用本网站的人需各自填写自己的 Key。请勿把 Key 硬编码进任何公开代码。
      </p>
    </div>
  );
}
