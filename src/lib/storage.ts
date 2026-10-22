// localStorage 持久化：多方案隔离存储 + JSON 导入导出
import type { Scenario } from '@/types/model';
import { buildRoster, createDefaultScenario, defaultFormation } from './defaultScenario';

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
// v6→v8（合并执行）：冲击技能合并 + 跨图前提 + 多起点 DFS + 新规则图。
// v8→v9：位置图压缩为 9×9 网格 + 3×3 区域状态（DFS 只跑区域级转移），起点/阵型重置。
// v9→v10：血量图改为「阈值复合状态 + 内部血量子状态（数值）」，回血是复合状态内部更新事件。
// v10→v11：球路重构（球被持有/传向队友追踪/自由球朝中心），传球本质 = 持球→无球 + 拿球距离前提。
function migrate(sc: Scenario): Scenario {
  if (!sc || !sc.graphs || !sc.balance) return sc;
  const fresh = createDefaultScenario();
  const v = sc.version ?? 1;
  if (v >= 11) {
    // 修复被误标 v11 的存档：按图特征补齐缺失的新语义图（v9/v8 直跳时漏换的）
    const bt = sc.graphs['ballTrack'];
    if (!bt || !bt.nodes.some((n) => n.name === '传向队友')) {
      sc.graphs['possession'] = fresh.graphs['possession'];
      sc.graphs['ballTrack'] = fresh.graphs['ballTrack'];
    }
    const hp = sc.graphs['hp'];
    if (!hp || !hp.edges.some((e) => e.event === '回血')) {
      sc.graphs['hp'] = fresh.graphs['hp'];
    }
    const pos = sc.graphs['position'];
    if (pos && pos.nodes.length > 20) { // 旧 10×10 格子图 → 区域版
      sc.graphs['position'] = fresh.graphs['position'];
      sc.startState = { ...fresh.startState, ...sc.startState, position: '本方-中' };
      sc.formation = defaultFormation(sc.players);
    }
    return sc;
  }
  if (v >= 10) {
    // v10→v11：替换球权/球路图，其余图/模板保留
    sc.graphs['possession'] = fresh.graphs['possession'];
    sc.graphs['ballTrack'] = fresh.graphs['ballTrack'];
    sc.version = 11;
    return sc;
  }
  if (v >= 9) {
    // v9→v11：补齐血量复合版 + 新球权/球路（v9 存档没走过 v10 的血量迁移）
    sc.graphs['hp'] = fresh.graphs['hp'];
    sc.graphs['possession'] = fresh.graphs['possession'];
    sc.graphs['ballTrack'] = fresh.graphs['ballTrack'];
    sc.version = 11;
    return sc;
  }
  if (v >= 8) {
    // v8→v11：位置图压缩 + 血量复合版 + 新球权/球路；起点与阵型重置为区域语义
    sc.graphs['position'] = fresh.graphs['position'];
    sc.graphs['hp'] = fresh.graphs['hp'];
    sc.graphs['possession'] = fresh.graphs['possession'];
    sc.graphs['ballTrack'] = fresh.graphs['ballTrack'];
    sc.startState = { ...fresh.startState, ...sc.startState, position: '本方-中' };
    sc.formation = defaultFormation(sc.players);
    sc.version = 11;
    return sc;
  }
  if (v >= 5) {
    const standard = ['possession', 'holding', 'control', 'hp', 'ballTrack', 'position'];
    for (const gid of standard) delete sc.graphs[gid];
    for (const [gid, g] of Object.entries(fresh.graphs)) {
      if (!sc.graphs[gid]) sc.graphs[gid] = g;
    }
    // 技能模板：伤害/位移合并为冲击（按名字映射到新模板，字段保留）
    const kindMap: Record<string, string> = { damage: 'impact', displacement: 'impact' };
    const customs = (sc.skills ?? [])
      .filter((s) => !fresh.skills.some((f) => f.name === s.name))
      .map((s) => ({ ...s, kind: (kindMap[s.kind] ?? s.kind) as typeof s.kind }));
    sc.skills = [...fresh.skills, ...customs];
    sc.balance.hpRegen ??= 5;
    sc.startState = fresh.startState;
    sc.formation = defaultFormation(sc.players);
    sc.version = 11;
    return sc;
  }
  sc.version = 11;
  sc.graphs = fresh.graphs;
  sc.professions = fresh.professions;
  sc.players = buildRoster(sc.playersPerTeam || 3, sc.professions);
  sc.skills = fresh.skills;
  sc.balance.hpRegen ??= 5;
  sc.startState = fresh.startState;
  sc.formation = fresh.formation;
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
