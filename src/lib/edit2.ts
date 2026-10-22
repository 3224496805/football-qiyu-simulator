// 写回助手：在图上直接操作时，所有修改都翻译回事件库/维度（图本身不存数据）
// 每个函数都返回「修改后的整个方案」或「一句中文错误说明」，绝不写图
import type { EntityKind, QiyuEvent, Scenario2 } from '@/types/model2';
import { ENTITY_NAMES, newEventId } from '@/types/model2';

export type EditResult =
  | { ok: true; sc: Scenario2; message?: string }
  | { ok: false; error: string };

// 哪些事件引用了这个维度/状态（删除前拦截用）
export function referencingEvents(sc: Scenario2, dimId: string, state?: string): string[] {
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

const clone = (sc: Scenario2) => JSON.parse(JSON.stringify(sc)) as Scenario2;

// 双击空白：在某个维度里新建状态
export function addState(sc: Scenario2, dimId: string, name: string): EditResult {
  const nn = name.trim();
  if (!nn) return { ok: false, error: '状态名不能为空' };
  const draft = clone(sc);
  const dim = draft.dimensions.find((d) => d.id === dimId);
  if (!dim) return { ok: false, error: '维度不存在' };
  if (dim.states.includes(nn)) return { ok: false, error: `状态「${nn}」已存在` };
  dim.states.push(nn);
  return { ok: true, sc: draft, message: `已在「${dim.name}」里新建状态「${nn}」` };
}

// 删除状态：被事件引用则拒绝
export function removeState(sc: Scenario2, dimId: string, state: string): EditResult {
  const refs = referencingEvents(sc, dimId, state);
  if (refs.length > 0) {
    return { ok: false, error: `状态「${state}」还被这些事件引用，不能删除：${refs.join('、')}` };
  }
  const draft = clone(sc);
  const dim = draft.dimensions.find((d) => d.id === dimId);
  if (!dim) return { ok: false, error: '维度不存在' };
  dim.states = dim.states.filter((s) => s !== state);
  delete dim.stateNotes[state];
  if (draft.startState[dimId] === state) delete draft.startState[dimId];
  return { ok: true, sc: draft, message: `已删除状态「${state}」` };
}

// 连线挂到已有事件：往事件的「状态变化」里加一条
export function addEffectToEvent(sc: Scenario2, eventId: string, dimId: string, from: string, to: string): EditResult {
  const draft = clone(sc);
  const ev = draft.events.find((e) => e.id === eventId);
  if (!ev) return { ok: false, error: '事件不存在' };
  const dim = draft.dimensions.find((d) => d.id === dimId);
  if (dim && dim.owner !== ev.owner) {
    return { ok: false, error: `「${ev.name}」是${ENTITY_NAMES[ev.owner]}的事件，不能改${ENTITY_NAMES[dim.owner]}的维度「${dim.name}」` };
  }
  if (ev.effects.some((f) => f.dimension === dimId && f.from === from && f.to === to)) {
    return { ok: false, error: `事件「${ev.name}」里已经有「${from} → ${to}」这条变化了` };
  }
  ev.effects.push({ dimension: dimId, from, to });
  return { ok: true, sc: draft, message: `已把「${from} → ${to}」加进事件「${ev.name}」` };
}

// 连线新建事件：造一条只含这条变化的新事件（默认主动，可事后在事件库里改）
export function createEventForLink(sc: Scenario2, dimId: string, from: string, to: string, name: string): EditResult {
  const nn = name.trim();
  if (!nn) return { ok: false, error: '事件名不能为空' };
  const draft = clone(sc);
  const dim = draft.dimensions.find((d) => d.id === dimId);
  if (!dim) return { ok: false, error: '维度不存在' };
  const owner: EntityKind = dim.owner;
  const ev: QiyuEvent = {
    id: newEventId(), name: nn, owner, trigger: '主动', listen: [],
    preStates: [], effects: [{ dimension: dimId, from, to }], numeric: [],
    affectsOthers: false, condition: '', note: '（在图上连线创建，点左栏卡片可补充前提/数值/说明）',
    basePriority: 1, cooldown: 0, professions: [],
  };
  draft.events.push(ev);
  return { ok: true, sc: draft, message: `已新建事件「${nn}」（${from} → ${to}）` };
}

// 删除图上的一条变化 = 从事件的「状态变化」里移除（edgeId 形如 事件id#序号）
export function removeEffect(sc: Scenario2, edgeId: string): EditResult {
  const cut = edgeId.lastIndexOf('#');
  if (cut < 0) return { ok: false, error: '无法识别这条变化' };
  const eventId = edgeId.slice(0, cut);
  const idx = Number(edgeId.slice(cut + 1));
  const draft = clone(sc);
  const ev = draft.events.find((e) => e.id === eventId);
  if (!ev || !ev.effects[idx]) return { ok: false, error: '这条变化已不存在' };
  const f = ev.effects[idx];
  ev.effects.splice(idx, 1);
  const message = ev.effects.length === 0 && ev.numeric.length === 0
    ? `已删除「${f.from} → ${f.to}」。注意：事件「${ev.name}」现在既没有状态变化也没有数值效果，不会再画到图上；如不需要请到事件库删除它`
    : ev.effects.length === 0
      ? `已删除「${f.from} → ${f.to}」。事件「${ev.name}」不再有状态变化，成为纯数值事件（不会再画到图上）`
      : `已从事件「${ev.name}」里删除「${f.from} → ${f.to}」`;
  return { ok: true, sc: draft, message };
}
