// localStorage 持久化：多方案隔离存储 + JSON 导入导出
import type { Scenario } from '@/types/model';
import { buildRoster, createDefaultScenario, defaultFormation } from './defaultScenario';

const INDEX_KEY = 'qiyu:scenarios:index';
const PREFIX = 'qiyu:scenario:';

// 存档自动修复说明：migrate() 每次加载时记录做了哪些修复，供界面顶部提示条展示
let lastNotes: string[] = [];
export function takeMigrationNotes(): string[] {
  const n = lastNotes;
  lastNotes = [];
  return n;
}

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
  lastNotes = [];
  const fresh = createDefaultScenario();
  const v = sc.version ?? 1;
  if (v >= 14) return sc;
  if (v >= 13) {
    // v13→v14：掉球改为纯条件触发（被动监听受击 + 低血量数值门槛）；血量受击移除"持球免伤"前提
    const pos = sc.graphs['possession'];
    if (pos?.edges.find((e) => e.event === '掉球')?.trigger !== 'passive') {
      sc.graphs['possession'] = fresh.graphs['possession'];
      lastNotes.push('「球权逻辑」整张图已按新规则更换（旧存档的"掉球"事件不是被动触发）。您在这张图上做过的其他修改需要重新调整。');
    }
    const hp = sc.graphs['hp'];
    if (hp?.edges.find((e) => e.event === '受击')?.preStates?.length) {
      sc.graphs['hp'] = fresh.graphs['hp'];
      lastNotes.push('「血量逻辑」整张图已按新规则更换（旧存档的"受击"事件带有过时的前提条件）。您在这张图上做过的其他修改需要重新调整。');
    }
    sc.version = 14;
    return sc;
  }
  if (v >= 12) {
    // v12→v13：掉球/受击掉球合并为一条双通道边（主动+监听受击）
    const pos = sc.graphs['possession'];
    if (pos?.edges.some((e) => e.event === '受击掉球')) {
      sc.graphs['possession'] = fresh.graphs['possession'];
      sc.graphs['ballTrack'] = fresh.graphs['ballTrack'];
      lastNotes.push('「球权逻辑」和「球路逻辑」两张图已按新规则更换（旧存档里还有已被合并的"受击掉球"事件）。您在这两张图上做过的其他修改需要重新调整。');
    }
    sc.version = 14;
    return sc;
  }
  if (v >= 11) {
    // v11/v12 存档自检修复：按图特征补齐缺失的新语义图（v9/v8 直跳时漏换的）+ 传球信号化
    const bt = sc.graphs['ballTrack'];
    if (!bt || !bt.nodes.some((n) => n.name === '传向队友')) {
      sc.graphs['possession'] = fresh.graphs['possession'];
      sc.graphs['ballTrack'] = fresh.graphs['ballTrack'];
      lastNotes.push('「球权逻辑」和「球路逻辑」两张图已按新规则更换（旧存档缺少"传向队友"状态）。您在这两张图上做过的其他修改需要重新调整。');
    }
    const hp = sc.graphs['hp'];
    if (!hp || !hp.edges.some((e) => e.event === '回血')) {
      sc.graphs['hp'] = fresh.graphs['hp'];
      lastNotes.push('「血量逻辑」整张图已按新规则更换（旧存档缺少"回血"事件）。您在这张图上做过的其他修改需要重新调整。');
    }
    const posG = sc.graphs['position'];
    if (posG && posG.nodes.length > 20) { // 旧 10×10 格子图 → 区域版
      sc.graphs['position'] = fresh.graphs['position'];
      sc.startState = { ...fresh.startState, ...sc.startState, position: '本方-中' };
      sc.formation = defaultFormation(sc.players);
      lastNotes.push('「位置逻辑」整张图已压缩为新版"9×9 格子 + 3×3 区域"，起点和阵型已重置。');
    }
    // v11→v12：传球信号化（绑定信号技能模板 sk_sig_2）
    const pos = sc.graphs['possession'];
    const passEdge = pos?.edges.find((e) => e.event === '传球');
    if (pos && passEdge && passEdge.skillKind !== 'signal') {
      sc.graphs['possession'] = fresh.graphs['possession'];
      lastNotes.push('「球权逻辑」整张图已按新规则更换（"传球"事件需要绑定信号类技能）。您在这张图上做过的其他修改需要重新调整。');
    }
    if (!sc.skills.some((s) => s.id === 'sk_sig_2')) {
      const sig = fresh.skills.find((s) => s.id === 'sk_sig_2');
      if (sig) sc.skills = [...sc.skills, sig];
    }
    sc.version = 14;
    return sc;
  }
  if (v >= 10) {
    // v10→v11：替换球权/球路图，其余图/模板保留
    sc.graphs['possession'] = fresh.graphs['possession'];
    sc.graphs['ballTrack'] = fresh.graphs['ballTrack'];
    lastNotes.push('「球权逻辑」和「球路逻辑」两张图已整体更换为新版。您在这两张图上做过的其他修改需要重新调整。');
    sc.version = 14;
    return sc;
  }
  if (v >= 9) {
    // v9→v11：补齐血量复合版 + 新球权/球路（v9 存档没走过 v10 的血量迁移）
    sc.graphs['hp'] = fresh.graphs['hp'];
    sc.graphs['possession'] = fresh.graphs['possession'];
    sc.graphs['ballTrack'] = fresh.graphs['ballTrack'];
    lastNotes.push('「血量逻辑」「球权逻辑」「球路逻辑」三张图已整体更换为新版。您在这些图上做过的其他修改需要重新调整。');
    sc.version = 14;
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
    lastNotes.push('位置、血量、球权、球路四张图已整体更换为新版，起点和阵型已重置。您在这些图上做过的其他修改需要重新调整。');
    sc.version = 14;
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
    lastNotes.push('六张标准逻辑图已按新版重建（您自建的逻辑图和自定义技能模板已保留）。您在标准图上做过的修改需要重新调整。');
    sc.version = 14;
    return sc;
  }
  sc.version = 14;
  sc.graphs = fresh.graphs;
  sc.professions = fresh.professions;
  sc.players = buildRoster(sc.playersPerTeam || 3, sc.professions);
  sc.skills = fresh.skills;
  sc.balance.hpRegen ??= 5;
  sc.startState = fresh.startState;
  sc.formation = fresh.formation;
  lastNotes.push('存档版本过旧，已整体重建为新版默认方案（保留了方案名称、每队人数和平衡参数）。');
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
