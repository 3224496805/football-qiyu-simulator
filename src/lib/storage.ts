// localStorage 持久化：多方案隔离存储 + JSON 导入导出
import type { Scenario } from '@/types/model';
import { buildRoster, createDefaultScenario } from './defaultScenario';

const INDEX_KEY = 'qiyu:scenarios:index';
const PREFIX = 'qiyu:scenario:';

export interface ScenarioMeta {
  id: string;
  name: string;
  updatedAt: number;
  playersPerTeam: number;
}

export function listScenarios(): ScenarioMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as ScenarioMeta[]) : [];
  } catch {
    return [];
  }
}

export function loadScenario(id: string): Scenario | null {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    if (!raw) return null;
    return migrate(JSON.parse(raw) as Scenario);
  } catch {
    return null;
  }
}

// 存量迁移：旧版本 → v6（3v3 方案按手绘设计图重构 + 信号/辅助技能 + 时限状态）
// v5→v6：重建标准逻辑图（possession/holding/control/hp/ballTrack），保留位置图、用户自建图与自定义技能模板。
// <v5：整体用 v6 默认结构重建，保留方案名称/人数/平衡参数。
function migrate(sc: Scenario): Scenario {
  if (!sc || !sc.graphs || !sc.balance) return sc;
  const fresh = createDefaultScenario();
  const v = sc.version ?? 1;
  if (v >= 7) return sc;
  if (v >= 6) {
    // v6 → v7：事件触发方式（主动/被动）字段补默认值，其余保留
    for (const g of Object.values(sc.graphs)) {
      for (const e of g.edges) e.trigger ??= 'active';
    }
    sc.version = 7;
    return sc;
  }
  if (v >= 5) {
    const standard = ['possession', 'holding', 'control', 'hp', 'ballTrack'];
    for (const gid of standard) delete sc.graphs[gid];
    for (const [gid, g] of Object.entries(fresh.graphs)) {
      if (!sc.graphs[gid]) sc.graphs[gid] = g;
    }
    // 保留自定义技能模板，补入默认的信号/辅助模板
    const customs = (sc.skills ?? []).filter(
      (s) => !fresh.skills.some((f) => f.name === s.name && f.kind === s.kind),
    );
    sc.skills = [...fresh.skills, ...customs];
    sc.version = 7;
    return sc;
  }
  sc.version = 7;
  sc.graphs = fresh.graphs;
  sc.professions = fresh.professions;
  sc.players = buildRoster(sc.playersPerTeam || 3, sc.professions);
  sc.skills = fresh.skills;
  return sc;
}

export function saveScenario(sc: Scenario) {
  sc.updatedAt = Date.now();
  localStorage.setItem(PREFIX + sc.id, JSON.stringify(sc));
  const metas = listScenarios().filter((m) => m.id !== sc.id);
  metas.push({ id: sc.id, name: sc.name, updatedAt: sc.updatedAt, playersPerTeam: sc.playersPerTeam });
  metas.sort((a, b) => b.updatedAt - a.updatedAt);
  localStorage.setItem(INDEX_KEY, JSON.stringify(metas));
}

export function deleteScenario(id: string) {
  localStorage.removeItem(PREFIX + id);
  localStorage.setItem(INDEX_KEY, JSON.stringify(listScenarios().filter((m) => m.id !== id)));
}

export function newId(): string {
  return `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function exportScenario(sc: Scenario): string {
  return JSON.stringify(sc, null, 2);
}

export function importScenario(json: string): Scenario {
  const sc = JSON.parse(json) as Scenario;
  if (!sc.graphs || !sc.balance) throw new Error('不是有效的方案 JSON');
  sc.id = newId(); // 导入即新方案，隔离存储
  return migrate(sc);
}
