// 新版（v15）存档：localStorage 持久化，多方案隔离存储 + JSON 导入导出
// 与旧版（qiyu:...，版本 ≤14）完全隔离，互不影响；旧档一键转换在阶段 2 提供
import type { Scenario2 } from '@/types/model2';
import { SCENARIO_VERSION } from '@/types/model2';

const INDEX_KEY = 'qiyu2:scenarios:index';
const PREFIX = 'qiyu2:scenario:';
// 旧版存档键（仅用于检测并提示，绝不读取改写）
export const OLD_INDEX_KEY = 'qiyu:scenarios:index';

// 存档自动补齐说明：loadScenario 发现旧结构并自动修复时记录，供界面顶部提示条展示
let lastNotes: string[] = [];
export function takeLoadNotes(): string[] {
  const n = lastNotes;
  lastNotes = [];
  return n;
}

export interface ScenarioMeta {
  id: string;
  name: string;
  updatedAt: number;
}

export function listScenarios(): ScenarioMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as ScenarioMeta[]) : [];
  } catch {
    return [];
  }
}

// 旧版存档数量（用于顶部提示条）
export function countOldScenarios(): number {
  try {
    const raw = localStorage.getItem(OLD_INDEX_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

export function loadScenario(id: string): Scenario2 | null {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    if (!raw) return null;
    const sc = JSON.parse(raw) as Scenario2;
    if (!sc || !Array.isArray(sc.events) || !Array.isArray(sc.dimensions)) return null;
    // v15.0 的存档事件没有「归属实体」字段：补齐字段并提示（这类方案里的事件还是重做前的合并写法）
    if (sc.events.some((e) => e.owner !== 'player' && e.owner !== 'ball')) {
      normalize(sc);
      lastNotes = [
        `方案「${sc.name}」是事件重做前的结构，已自动补齐字段。但里面的事件还是旧的"一条事件改多个实体"写法，` +
        `与千星沙箱"每个实体只能改自己的状态"的规则不一致。建议：点顶部「新建」生成重做后的 28 条事件示例，或告诉我帮你一键重置。`,
      ];
    }
    return sc;
  } catch {
    return null;
  }
}

// 兼容 v15.0 旧存档：那时事件还没有「归属实体 / 影响对方」两个字段，这里按规则补齐
function normalize(sc: Scenario2) {
  const ownerOfDim = new Map(sc.dimensions.map((d) => [d.id, d.owner]));
  for (const ev of sc.events) {
    if (ev.owner !== 'player' && ev.owner !== 'ball') {
      ev.owner = ownerOfDim.get(ev.effects[0]?.dimension ?? '') ?? 'player';
    }
    ev.affectsOthers = ev.affectsOthers ?? false;
    ev.listen = ev.listen ?? [];
    ev.preStates = ev.preStates ?? [];
    ev.numeric = ev.numeric ?? [];
    ev.professions = ev.professions ?? [];
  }
}

export function saveScenario(sc: Scenario2) {
  sc.updatedAt = Date.now();
  sc.version = SCENARIO_VERSION;
  localStorage.setItem(PREFIX + sc.id, JSON.stringify(sc));
  const metas = listScenarios().filter((m) => m.id !== sc.id);
  metas.push({ id: sc.id, name: sc.name, updatedAt: sc.updatedAt });
  metas.sort((a, b) => b.updatedAt - a.updatedAt);
  localStorage.setItem(INDEX_KEY, JSON.stringify(metas));
}

export function deleteScenario(id: string) {
  localStorage.removeItem(PREFIX + id);
  localStorage.setItem(INDEX_KEY, JSON.stringify(listScenarios().filter((m) => m.id !== id)));
}

export function newScenarioId(): string {
  return `sc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function exportScenario(sc: Scenario2): string {
  return JSON.stringify(sc, null, 2);
}

export function importScenario(json: string): Scenario2 {
  const sc = JSON.parse(json) as Scenario2;
  if (!sc || !Array.isArray(sc.events) || !Array.isArray(sc.dimensions)) {
    throw new Error('不是有效的新版方案文件（事件库形态）');
  }
  sc.id = newScenarioId(); // 导入即新方案，隔离存储
  sc.version = SCENARIO_VERSION;
  normalize(sc);
  return sc;
}
