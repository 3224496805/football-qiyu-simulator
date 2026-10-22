// AI 生成事件（v15 重做版）：生成的不是图，而是事件库里的事件（图会跟着自动变）
//   一键模式：填 Key（只存本浏览器）→ 描述需求 → 直连 Kimi API 生成 JSON → 校验入库；
//   手动模式（备用）：生成提示词 → 复制到 Kimi 对话 → 把返回 JSON 粘回导入。
import { useState } from 'react';
import type { Dimension, QiyuEvent, Scenario2 } from '@/types/model2';
import { ENTITY_NAMES, NUMERIC_KINDS } from '@/types/model2';
import { parseAiJson } from '@/lib/aiImport2';

const KEY_STORE = 'qiyu:kimi-key';
const MODEL_STORE = 'qiyu:kimi-model';
const ENDPOINT = 'https://api.moonshot.cn/v1/chat/completions';
const MODELS = ['kimi-k2.6', 'kimi-k3', 'moonshot-v1-8k', 'moonshot-v1-32k'];

interface Props {
  sc: Scenario2;
  onImport: (events: QiyuEvent[], dims: Dimension[], msg: string) => void;
}

export default function AiGenPanel2({ sc, onImport }: Props) {
  const [desc, setDesc] = useState('');
  const [prompt, setPrompt] = useState('');
  const [json, setJson] = useState('');
  const [msg, setMsg] = useState('');
  const [key, setKey] = useState(() => localStorage.getItem(KEY_STORE) ?? '');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(() => localStorage.getItem(MODEL_STORE) ?? MODELS[0]);
  const [busy, setBusy] = useState(false);

  const buildPromptText = () => `你是原神千星奇域的玩法策划，精通「状态机 + 事件库」设计。请为「足球奇域模拟器」设计一批事件，只输出严格 JSON（不要 Markdown 代码块、不要解释文字）。

【千星沙箱的事件模型】
- 事件库是唯一数据源：每条事件 = 归属实体 + 触发方式 + 监听 + 前提状态 + 状态变化 + 数值效果。
- 触发方式只有两种：「主动」= 从客户端发出（玩家按键操作）；「被动」= 检测到状态变化后触发。
- 被动事件填了「监听」= 等被监听的事件执行后才会触发（信号全局可达，按事件名认）；不填监听 = 持续检测（每次判定都看前提是否满足）。
- 铁律：一条事件只属于一个实体（角色 player / 球 ball / 球门 goal），它的状态变化只能改自己实体的维度；跨实体联动必须拆成两条事件——比如「角色射门」只改角色自己的状态，球那边另写一条监听「射门」的被动事件来改球的状态。
- 同一维度写多条状态变化 = 从任一源状态出发都可以。

【当前方案「${sc.name}」】
- 已有维度（前提和状态变化里用维度名引用）：${sc.dimensions.map((d) => `${d.name}（${ENTITY_NAMES[d.owner]}：${d.states.join('/')}）`).join('；')}
- 已有事件（监听只能填这些名字或本批次新事件的名字）：${sc.events.map((e) => e.name).join('、') || '（空）'}
- 职业：${sc.professions.map((p) => p.name).join('、')}

【输出 JSON 格式】
{"newDimensions":[{"name":"新维度名","owner":"player|ball|goal","states":["状态1","状态2"],"note":"备注"}],  // 不需要新维度就省略整个字段
 "events":[{"name":"事件名","owner":"player|ball|goal","trigger":"主动|被动",
   "listen":["被监听事件名"],                              // 仅被动事件可填，可省略
   "preStates":[{"dimension":"维度名","state":"状态名","not":false}],  // 前提状态，可跨维度，可省略；not=true 表示"必须不处于"
   "effects":[{"dimension":"维度名","from":"从状态","to":"到状态"}],   // 状态变化，只能是归属实体自己的维度
   "numeric":[{"kind":"${NUMERIC_KINDS.join('|')}","value":10}],     // 数值效果，可省略
   "affectsOthers":false,                               // 数值效果是否作用于对方（如扣对方的血）
   "condition":"文字条件（距离/按键/数值门槛等）","note":"设计说明",
   "basePriority":1,"cooldown":0,"professions":["职业名"]}]}

【硬性要求】
1. 状态变化里的 from/to 状态名，只要是合理的就会并入维度，但同一事件内的拼写必须前后一致。
2. 被动事件的 listen 里每个名字都必须是已有事件或本批次事件；主动事件不许填 listen。
3. 每条事件至少要有状态变化或数值效果之一，不许是空事件。
4. 事件名不许和已有事件重名。
5. 前提和状态变化里引用的维度名，必须是"已有维度"或你在 newDimensions 里声明的新维度。

【设计需求】${desc || '（请在此描述想设计的玩法逻辑）'}`;

  const importFromText = (text: string) => {
    const r = parseAiJson(sc, text);
    setMsg(r.ok ? `✓ ${r.msg}` : `❌ ${r.msg}`);
    if (r.ok && r.events && r.dims) {
      onImport(r.events, r.dims, r.msg);
      setJson('');
    }
    return r.ok;
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
          { role: 'system', content: '你是严格输出 JSON 的千星奇域玩法策划。只输出 JSON 本体，不要输出 Markdown 代码块或任何解释文字。' },
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

  const generate = async () => {
    if (!key.trim()) { setMsg('请先填写 Kimi API Key（只保存在本浏览器）'); return; }
    if (!desc.trim()) { setMsg('请先描述设计需求'); return; }
    setBusy(true);
    setMsg('正在调用 Kimi 生成…');
    try {
      let content: string;
      try {
        content = await callKimi(true);
      } catch (err) {
        const m = (err as Error).message;
        if (!m.includes('400')) throw err; // 仅当模型不支持 JSON 模式时回退普通模式
        content = await callKimi(false);
      }
      importFromText(content);
    } catch (err) {
      setMsg('生成失败：' + (err as Error).message + '（可改用下方手动模式）');
    } finally {
      setBusy(false);
    }
  };

  const saveKey = (v: string) => { setKey(v); localStorage.setItem(KEY_STORE, v.trim()); };
  const saveModel = (v: string) => { setModel(v); localStorage.setItem(MODEL_STORE, v); };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4 text-sm">
      <div className="border rounded p-4 space-y-3 bg-card">
        <h3 className="font-bold text-base">🤖 AI 生成事件（Kimi API 一键入库）</h3>
        <p className="text-xs text-muted-foreground">
          描述想要的玩法，AI 会直接生成<b>事件库里的事件</b>（不是图——事件入库后，各维度逻辑图和总超图会自动跟着变）。
          生成内容会经过完整校验：实体铁律（只能改自己维度）、监听名字必须存在、维度必须已声明等，不合格会告诉你哪里错了。
        </p>
        <ol className="text-xs text-muted-foreground list-decimal pl-5 space-y-0.5">
          <li>填入你的 Kimi API Key（仅保存在当前浏览器，可勾选显示核对）；</li>
          <li>描述想设计的玩法逻辑，点「⚡ 一键生成并入库」；</li>
          <li>失败时可改用手动模式：复制提示词到 Kimi 对话，把返回 JSON 粘回导入。</li>
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

        <textarea className="w-full border rounded px-2 py-1 bg-background" rows={3}
          placeholder="例如：加一个「体能」维度（充沛/透支），冲刺消耗体能，无球静止时缓慢恢复，透支时不能冲刺……"
          value={desc} onChange={(e) => setDesc(e.target.value)} />

        <div className="flex gap-2 flex-wrap">
          <button onClick={generate} disabled={busy}
            className="px-3 py-1 border rounded bg-primary text-primary-foreground disabled:opacity-40">
            {busy ? '生成中…' : '⚡ 一键生成并入库'}
          </button>
          <button onClick={() => { setPrompt(buildPromptText()); setMsg(''); }} className="px-3 py-1 border rounded hover:bg-muted">
            生成提示词（手动模式）
          </button>
          {prompt && (
            <button onClick={() => { navigator.clipboard.writeText(prompt); setMsg('提示词已复制，去 Kimi 对话粘贴吧'); }}
              className="px-3 py-1 border rounded hover:bg-muted">📋 复制提示词</button>
          )}
        </div>

        {prompt && <textarea className="w-full border rounded px-2 py-1 bg-background text-xs" rows={6} value={prompt} readOnly />}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">手动模式：粘贴 Kimi 返回的 JSON 导入</summary>
          <textarea className="w-full border rounded px-2 py-1 bg-background text-xs mt-2" rows={5}
            placeholder="把 Kimi 返回的 JSON 粘到这里……" value={json} onChange={(e) => setJson(e.target.value)} />
          <div className="flex items-center gap-2 mt-2">
            <button onClick={() => importFromText(json)} disabled={!json.trim()}
              className="px-3 py-1 border rounded bg-emerald-600 text-white disabled:opacity-40">校验并导入事件库</button>
          </div>
        </details>

        {msg && <div className="text-xs border-t pt-2 whitespace-pre-wrap">{msg}</div>}
        <p className="text-[11px] text-muted-foreground">
          🔒 安全说明：Key 仅保存在当前浏览器的本地存储里，不会上传到任何服务器，也不会进入源码仓库；请勿把 Key 硬编码进任何公开代码。
        </p>
      </div>
    </div>
  );
}
