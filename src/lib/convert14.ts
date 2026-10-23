// 旧存档（v14 及以前，"逻辑图直存"格式）→ 新版事件库格式的一键转换
// 转换规则（都会写进中文转换报告）：
//   每张旧逻辑图 → 一个同名维度（状态 = 旧图节点）
//   同一张图里的同名边 → 合并成一条事件（如「移动」24 条边 → 1 条事件带 24 条状态变化）
//   边的字段映射：被动触发→被动、监听列表照搬、跨图前提的图名换成新维度、技能模板折算成数值效果
//   时限状态 → 写进该状态的备注里
// 旧数据一个字节都不动，转换结果是另存的新方案。
import type { DomainEdge, Scenario, SkillTemplate } from '@/types/model';
import type { Dimension, QiyuEvent, Scenario2 } from '@/types/model2';
import { newDimensionId, newEventId, SCENARIO_VERSION } from '@/types/model2';
import { OLD_INDEX_KEY } from './storage2';

const OLD_PREFIX = 'qiyu:scenario:';

export function listOldScenarioIds(): { id: string; name: string }[] {
  try {
    const raw = localStorage.getItem(OLD_INDEX_KEY);
    const arr = raw ? (JSON.parse(raw) as { id: string; name: string }[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function loadOldScenario(id: string): Scenario | null {
  try {
    const raw = localStorage.getItem(OLD_PREFIX + id);
    if (!raw) return null;
    const sc = JSON.parse(raw) as Scenario;
    if (!sc || !sc.graphs || !sc.balance) return null;
    return sc;
  } catch {
    return null;
  }
}

// 技能模板 → 数值效果
function skillNumeric(edge: DomainEdge, skills: SkillTemplate[]): { list: QiyuEvent['numeric']; missing: boolean } {
  if (!edge.skillKind || !edge.skillId) return { list: [], missing: false };
  const sk = skills.find((s) => s.id === edge.skillId);
  if (!sk) return { list: [], missing: true };
  const out: QiyuEvent['numeric'] = [];
  if (sk.damage) out.push({ kind: '扣血', value: sk.damage });
  if (sk.displacement) out.push({ kind: '位移', value: sk.displacement });
  if (sk.chargeMax) out.push({ kind: '蓄能', value: sk.chargeMax });
  if (sk.effectValue) out.push({ kind: '回血', value: sk.effectValue });
  return { list: out, missing: false };
}

export function convertOldScenario(old: Scenario): { sc2: Scenario2; report: string[] } {
  const report: string[] = [];
  report.push(`方案「${old.name}」（旧版 v${old.version ?? '?'}）转换结果：`);

  // 1) 图 → 维度
  const gidToDim = new Map<string, string>();
  const dimensions: Dimension[] = [];
  for (const g of Object.values(old.graphs)) {
    const d: Dimension = {
      id: newDimensionId(),
      name: g.name,
      owner: g.owner,
      states: g.nodes.map((n) => n.name),
      stateNotes: {},
      note: undefined,
    };
    for (const n of g.nodes) {
      const bits: string[] = [];
      if (n.note) bits.push(n.note);
      if (n.timeLimit) bits.push(`时限状态：进入 ${n.timeLimit.ticks} tick 后自动触发「${n.timeLimit.timeoutEvent ?? '未指定'}」`);
      if (bits.length > 0) d.stateNotes[n.name] = bits.join('；');
      if (n.timeLimit) report.push(`状态「${n.name}」是时限状态（${n.timeLimit.ticks} tick 后触发「${n.timeLimit.timeoutEvent ?? '未指定'}」），已写入该状态的备注`);
    }
    gidToDim.set(g.id, d.id);
    dimensions.push(d);
  }

  // 2) 边 → 事件（同图同名合并）
  const events: QiyuEvent[] = [];
  const groups = new Map<string, { gid: string; name: string; edges: DomainEdge[] }>();
  for (const g of Object.values(old.graphs)) {
    for (const e of g.edges) {
      const key = `${g.id}||${e.event}`;
      let grp = groups.get(key);
      if (!grp) { grp = { gid: g.id, name: e.event, edges: [] }; groups.set(key, grp); }
      grp.edges.push(e);
    }
  }
  for (const grp of groups.values()) {
    const g = old.graphs[grp.gid];
    const dimId = gidToDim.get(grp.gid)!;
    const nodeName = (id: string) => g.nodes.find((n) => n.id === id)?.name;
    const first = grp.edges[0];
    const effects: QiyuEvent['effects'] = [];
    let skipped = 0;
    for (const e of grp.edges) {
      const from = nodeName(e.from), to = nodeName(e.to);
      if (!from || !to) { skipped++; continue; }
      if (!effects.some((f) => f.from === from && f.to === to)) {
        effects.push({ dimension: dimId, from, to });
      }
    }
    if (skipped > 0) report.push(`事件「${grp.name}」有 ${skipped} 条边因找不到状态被跳过`);
    const ev: QiyuEvent = {
      id: newEventId(),
      name: grp.name,
      owner: g.owner,
      trigger: grp.edges.some((e) => e.trigger === 'passive') ? '被动' : '主动',
      listen: [...new Set(grp.edges.flatMap((e) => e.listenEvents ?? []))],
      preStates: [...new Map(
        grp.edges.flatMap((e) => e.preStates ?? [])
          .filter((p) => gidToDim.has(p.graph))
          .map((p) => [`${p.graph}|${p.state}|${p.not ? 1 : 0}`, {
            dimension: gidToDim.get(p.graph)!, state: p.state, not: p.not,
          }]),
      ).values()],
      effects,
      numeric: skillNumeric(first, old.skills ?? []).list,
      affectsOthers: grp.edges.some((e) => e.affectsOthers),
      condition: first.condition ?? '',
      note: grp.edges.length > 1 ? `由旧图「${g.name}」里的 ${grp.edges.length} 条同名边合并而成` : '',
      basePriority: Math.max(...grp.edges.map((e) => e.params?.basePriority ?? 1)),
      cooldown: Math.max(...grp.edges.map((e) => e.params?.cooldown ?? 0)),
      professions: [...new Set(grp.edges.flatMap((e) => e.professionIds ?? []))],
    };
    if (first.skillKind && first.skillId && !(old.skills ?? []).some((s) => s.id === first.skillId)) {
      report.push(`事件「${grp.name}」绑定的技能模板找不到，数值效果为空，请手动补充`);
    }
    events.push(ev);
  }

  // 3) 起始状态：旧图 id → 新维度 id
  const startState: Record<string, string> = {};
  for (const [gid, state] of Object.entries(old.startState ?? {})) {
    const dimId = gidToDim.get(gid);
    if (dimId) startState[dimId] = state;
  }

  // 4) 汇总报告
  for (const g of Object.values(old.graphs)) {
    const cnt = [...groups.values()].filter((x) => x.gid === g.id).length;
    report.push(`图「${g.name}」→ 同名维度：${g.nodes.length} 个状态，${g.edges.length} 条边合并为 ${cnt} 条事件`);
  }
  report.push(`合计：${dimensions.length} 个维度、${events.length} 条事件；起始状态、职业名册、人数、平衡参数已照搬`);

  const now = Date.now();
  const sc2: Scenario2 = {
    id: `sc_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    version: SCENARIO_VERSION,
    name: `${old.name}（转换）`,
    playersPerTeam: old.playersPerTeam ?? 3,
    professions: (old.professions ?? []).map((p) => ({ ...p })),
    players: (old.players ?? []).map((p) => ({ ...p })),
    dimensions,
    events,
    startState,
    balance: { attackRange: 2, shootRange: 3, controlTicks: 5, ...old.balance },
    createdAt: now,
    updatedAt: now,
  };
  return { sc2, report };
}
