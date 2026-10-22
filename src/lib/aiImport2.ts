// AI 生成的 JSON → 新版事件库的解析与校验
// AI 不需要知道维度 id：一律用「维度名」引用，这里负责翻译成 id；
// 可以顺带声明新维度（newDimensions），导入时一并创建。
// 所有报错都用中文，并列出当前可用的维度名/事件名/职业名，方便直接改。
import type { Dimension, EntityKind, NumericKind, QiyuEvent, Scenario2, TriggerKind } from '@/types/model2';
import { ENTITY_NAMES, newDimensionId, newEventId, NUMERIC_KINDS } from '@/types/model2';

export interface AiImportResult {
  ok: boolean;
  msg: string;
  events?: QiyuEvent[];
  dims?: Dimension[];
}

// 从模型返回的文本中提取 JSON 本体（容忍 Markdown 代码块包裹）
export function extractJson(text: string): string {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('返回内容里没有 JSON');
  return text.slice(s, e + 1);
}

const asStr = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const asNum = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

function parseOwner(v: unknown): EntityKind | null {
  const s = asStr(v);
  if (s === 'player' || s === '角色') return 'player';
  if (s === 'ball' || s === '球') return 'ball';
  if (s === 'goal' || s === '球门') return 'goal';
  return null;
}

function parseTrigger(v: unknown): TriggerKind | null {
  const s = asStr(v);
  if (s === '主动' || s === 'active') return '主动';
  if (s === '被动' || s === 'passive') return '被动';
  return null;
}

export function parseAiJson(sc: Scenario2, text: string): AiImportResult {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(extractJson(text)) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, msg: 'JSON 解析失败：' + (err as Error).message };
  }

  // ---------- 新维度 ----------
  const dims: Dimension[] = [];
  const dimByName = new Map<string, Dimension>(sc.dimensions.map((d) => [d.name, d]));
  const rawDims = data.newDimensions;
  if (rawDims !== undefined) {
    if (!Array.isArray(rawDims)) return { ok: false, msg: 'newDimensions 必须是数组' };
    for (const rd of rawDims as Record<string, unknown>[]) {
      const name = asStr(rd.name);
      if (!name) return { ok: false, msg: '新维度缺少 name' };
      if (dimByName.has(name) || dims.some((d) => d.name === name)) {
        return { ok: false, msg: `新维度「${name}」与已有维度重名（现有：${[...dimByName.keys()].join('、')}）` };
      }
      const owner = parseOwner(rd.owner);
      if (!owner) return { ok: false, msg: `新维度「${name}」的 owner 只能是 player/ball/goal（或 角色/球/球门）` };
      const states = Array.isArray(rd.states) ? [...new Set(rd.states.map(asStr).filter(Boolean))] : [];
      if (states.length === 0) return { ok: false, msg: `新维度「${name}」至少要有一个状态（states）` };
      const d: Dimension = {
        id: newDimensionId(), name, owner, states,
        stateNotes: {}, note: asStr(rd.note) || undefined,
      };
      dims.push(d);
      dimByName.set(name, d);
    }
  }

  // ---------- 事件 ----------
  const rawEvents = data.events;
  if (!Array.isArray(rawEvents) || rawEvents.length === 0) {
    return { ok: false, msg: 'events 必须是非空数组' };
  }
  const existingNames = new Set(sc.events.map((e) => e.name));
  const batchNames = new Set<string>();
  const professionsByName = new Map(sc.professions.map((p) => [p.name, p.id]));
  const events: QiyuEvent[] = [];

  for (const re of rawEvents as Record<string, unknown>[]) {
    const name = asStr(re.name);
    if (!name) return { ok: false, msg: '有事件缺少 name' };
    if (existingNames.has(name)) return { ok: false, msg: `事件「${name}」与事件库里已有的重名（监听是按名字认的，重名会接错线）` };
    if (batchNames.has(name)) return { ok: false, msg: `本次生成里「${name}」出现了两次，同名事件不允许` };
    batchNames.add(name);

    const owner = parseOwner(re.owner);
    if (!owner) return { ok: false, msg: `事件「${name}」的 owner 只能是 player/ball/goal（或 角色/球/球门）` };
    const trigger = parseTrigger(re.trigger);
    if (!trigger) return { ok: false, msg: `事件「${name}」的 trigger 只能是 主动/被动（主动 = 客户端发出；被动 = 检测状态变化）` };

    // 监听：名字必须已存在（事件库里 or 本批次里）
    const listen = Array.isArray(re.listen) ? (re.listen as unknown[]).map(asStr).filter(Boolean) : [];
    if (trigger === '主动' && listen.length > 0) {
      return { ok: false, msg: `事件「${name}」是主动事件（客户端发出），不应该填监听；监听是被动事件的专利` };
    }
    for (const l of listen) {
      if (!existingNames.has(l) && !batchNames.has(l)) {
        return { ok: false, msg: `事件「${name}」监听的「${l}」不存在。现有事件：${[...existingNames, ...batchNames].filter((n) => n !== name).join('、')}` };
      }
    }

    // 前提状态：可引用任意实体的维度
    const preStates: QiyuEvent['preStates'] = [];
    if (Array.isArray(re.preStates)) {
      for (const p of re.preStates as Record<string, unknown>[]) {
        const d = dimByName.get(asStr(p.dimension));
        if (!d) return { ok: false, msg: `事件「${name}」前提里的维度「${asStr(p.dimension)}」不存在。可用维度：${[...dimByName.keys()].join('、')}` };
        const state = asStr(p.state);
        if (!state) return { ok: false, msg: `事件「${name}」前提里的状态名不能为空` };
        preStates.push({ dimension: d.id, state, not: p.not === true });
      }
    }

    // 状态变化：只能落在自己实体的维度上（千星铁律）
    const effects: QiyuEvent['effects'] = [];
    if (Array.isArray(re.effects)) {
      for (const f of re.effects as Record<string, unknown>[]) {
        const dName = asStr(f.dimension);
        const d = dimByName.get(dName);
        if (!d) return { ok: false, msg: `事件「${name}」状态变化里的维度「${dName}」不存在。可用维度：${[...dimByName.keys()].join('、')}` };
        if (d.owner !== owner) {
          return { ok: false, msg: `事件「${name}」属于${ENTITY_NAMES[owner]}，却想改${ENTITY_NAMES[d.owner]}的维度「${dName}」——每个实体只能改自己的状态；跨实体联动要拆成对方监听本事件的被动事件` };
        }
        const from = asStr(f.from);
        const to = asStr(f.to);
        if (!from || !to) return { ok: false, msg: `事件「${name}」的状态变化缺少 from/to` };
        effects.push({ dimension: d.id, from, to });
      }
    }

    // 数值效果
    const numeric: QiyuEvent['numeric'] = [];
    if (Array.isArray(re.numeric)) {
      for (const n of re.numeric as Record<string, unknown>[]) {
        const kind = asStr(n.kind) as NumericKind;
        if (!NUMERIC_KINDS.includes(kind)) return { ok: false, msg: `事件「${name}」的数值效果类型「${asStr(n.kind)}」不存在，只能是：${NUMERIC_KINDS.join('、')}` };
        numeric.push({ kind, value: asNum(n.value, 0) });
      }
    }
    if (effects.length === 0 && numeric.length === 0) {
      return { ok: false, msg: `事件「${name}」既没有状态变化也没有数值效果，是空事件` };
    }

    // 职业限定
    const professions: string[] = [];
    if (Array.isArray(re.professions)) {
      for (const pn of (re.professions as unknown[]).map(asStr).filter(Boolean)) {
        const pid = professionsByName.get(pn);
        if (!pid) return { ok: false, msg: `事件「${name}」限定的职业「${pn}」不存在。现有职业：${[...professionsByName.keys()].join('、')}` };
        professions.push(pid);
      }
    }

    events.push({
      id: newEventId(), name, owner, trigger, listen, preStates, effects, numeric,
      affectsOthers: re.affectsOthers === true,
      condition: asStr(re.condition),
      note: asStr(re.note),
      basePriority: asNum(re.basePriority, 1),
      cooldown: Math.max(0, Math.round(asNum(re.cooldown, 0))),
      professions,
      group: asStr(re.group) || undefined, // 复合组名：同名的跨实体事件合并成一条复合事件
    });
  }

  // ---------- 汇总 ----------
  const cnt = (o: EntityKind) => events.filter((e) => e.owner === o).length;
  const parts = [
    `已加入 ${events.length} 条事件（角色 ${cnt('player')} · 球 ${cnt('ball')} · 球门 ${cnt('goal')}；主动 ${events.filter((e) => e.trigger === '主动').length} · 被动 ${events.filter((e) => e.trigger === '被动').length}）`,
  ];
  if (dims.length > 0) parts.push(`新增维度：${dims.map((d) => `${d.name}（${ENTITY_NAMES[d.owner]}，${d.states.length} 状态）`).join('、')}`);
  const detecting = events.filter((e) => e.trigger === '被动' && e.listen.length === 0).map((e) => e.name);
  if (detecting.length > 0) parts.push(`持续检测（无监听）：${detecting.join('、')}`);
  return { ok: true, msg: parts.join('；'), events, dims };
}
