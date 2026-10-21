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

// 存量迁移：v1/v2 → v3（实体归属 + 职业 + 网格位置图 + 球权/球路拆分）
// v3 的逻辑域集合发生变化（ball/position 拆为 possession/position/ballTrack 等），
// 因此旧方案的逻辑图整体用 v3 默认结构重建，保留名称/人数/平衡参数/技能模板。
function migrate(sc: Scenario): Scenario {
  if (!sc || !sc.graphs || !sc.balance) return sc;
  if ((sc.version ?? 1) >= 3) {
    // v3 内补字段容错
    sc.professions ??= createDefaultScenario().professions;
    sc.players ??= buildRoster(sc.playersPerTeam || 3, sc.professions);
    return sc;
  }
  const fresh = createDefaultScenario();
  sc.version = 3;
  sc.graphs = fresh.graphs;
  sc.professions = fresh.professions;
  sc.players = buildRoster(sc.playersPerTeam || 3, sc.professions);
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
