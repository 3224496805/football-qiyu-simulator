// 派生函数：从事件库算出两种图的展示数据（图不存数据，全靠这里现算）
//   buildDimensionGraph = 单维度逻辑图：只看落在该维度上的状态变化
//   buildTotalGraph     = 总超图：全部维度合并，同名状态粘合成一个节点
// 另含整个方案的体检（collectIssues）：画不出图的纯数值事件、监听不存在、状态未声明等
import type { EntityKind, QiyuEvent, Scenario2 } from '@/types/model2';
import { ENTITY_NAMES } from '@/types/model2';

export interface GraphNode {
  key: string;          // 节点唯一标识（= 状态名；总超图里同名状态天然同键 = 粘合）
  name: string;
  dims: string[];       // 出现在哪些维度（维度 id，去重）
  owners: EntityKind[]; // 这些维度分别挂在角色还是球上（去重）
  declared: boolean;    // 是否在所有引用它的维度里都正式声明了
  glued: boolean;       // 总超图专用：跨维度同名粘合（dims.length > 1）
  isStart: boolean;     // 是否为起始状态
}

export interface GraphEdge {
  id: string;           // 事件id#变化序号
  eventId: string;
  event: string;
  trigger: QiyuEvent['trigger'];
  from: string;         // 节点 key
  to: string;
  dimId: string;
  dimName: string;
  crossDim: boolean;    // 所属事件是否同时改变多个维度
  listen: string[];
}

export interface DerivedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];      // 与这张图相关的提醒
  pureNumeric: QiyuEvent[]; // 没有任何状态变化的事件（画不上图，单独列出）
}

export function dimNameOf(sc: Scenario2, dimId: string): string {
  return sc.dimensions.find((d) => d.id === dimId)?.name ?? dimId;
}

export function allEventNames(sc: Scenario2): string[] {
  return [...new Set(sc.events.map((e) => e.name))];
}

// 事件是否触碰某维度（状态变化或前提里引用了它）
export function eventTouchesDimension(ev: QiyuEvent, dimId: string): boolean {
  return ev.effects.some((f) => f.dimension === dimId) || ev.preStates.some((p) => p.dimension === dimId);
}

// 事件影响的不同维度个数（>1 即跨维度事件，旧版的"超边"）
function crossDimCount(ev: QiyuEvent): number {
  return new Set(ev.effects.map((f) => f.dimension)).size;
}

// 全方案体检：与具体看哪张图无关的提醒
export function collectIssues(sc: Scenario2): { warnings: string[]; pureNumeric: QiyuEvent[] } {
  const warnings: string[] = [];
  const names = new Set(sc.events.map((e) => e.name));
  const dimIds = new Set(sc.dimensions.map((d) => d.id));
  const dimOwner = new Map(sc.dimensions.map((d) => [d.id, d.owner]));
  const dimName = new Map(sc.dimensions.map((d) => [d.id, d.name]));
  const ownerCn = (o: string) => ENTITY_NAMES[o as EntityKind] ?? o;
  for (const ev of sc.events) {
    for (const l of ev.listen) {
      if (!names.has(l)) warnings.push(`事件「${ev.name}」监听的「${l}」在事件库里不存在`);
    }
    for (const f of ev.effects) {
      if (!dimIds.has(f.dimension)) {
        warnings.push(`事件「${ev.name}」的一条状态变化指向了不存在的维度（${f.dimension}）`);
      } else if (dimOwner.get(f.dimension) !== ev.owner) {
        warnings.push(
          `事件「${ev.name}」是${ownerCn(ev.owner)}的事件，但它的状态变化写到了${ownerCn(dimOwner.get(f.dimension)!)}的维度「${dimName.get(f.dimension)}」——` +
          `千星沙箱里每个实体只能改自己的状态，跨实体联动请改成「那边被动监听本事件」的另一条事件`,
        );
      }
    }
    for (const p of ev.preStates) {
      if (!dimIds.has(p.dimension)) warnings.push(`事件「${ev.name}」的一条前提指向了不存在的维度（${p.dimension}）`);
    }
    if (ev.trigger === '主动' && ev.listen.length > 0) {
      warnings.push(`事件「${ev.name}」是主动事件，不需要填监听（监听只对被动事件生效）`);
    }
  }
  // 起始状态必须真实存在
  for (const [dimId, state] of Object.entries(sc.startState)) {
    const d = sc.dimensions.find((x) => x.id === dimId);
    if (!d) warnings.push(`起始状态设置里有一个已经不存在的维度（${dimId}）`);
    else if (!d.states.includes(state)) warnings.push(`维度「${d.name}」的起始状态「${state}」不在它的状态列表里`);
  }
  const pureNumeric = sc.events.filter((e) => e.effects.length === 0);
  return { warnings: [...new Set(warnings)], pureNumeric };
}

function makeNode(name: string): GraphNode {
  return { key: name, name, dims: [], owners: [], declared: false, glued: false, isStart: false };
}

function touchNode(node: GraphNode, dimId: string, owner: EntityKind, declared: boolean) {
  if (!node.dims.includes(dimId)) node.dims.push(dimId);
  if (!node.owners.includes(owner)) node.owners.push(owner);
  if (declared) node.declared = true;
}

// 单维度逻辑图：节点 = 该维度声明的状态 ∪ 事件引用到的状态；边 = 落在该维度上的状态变化
export function buildDimensionGraph(sc: Scenario2, dimId: string): DerivedGraph {
  const dim = sc.dimensions.find((d) => d.id === dimId);
  const { warnings, pureNumeric } = collectIssues(sc);
  if (!dim) return { nodes: [], edges: [], warnings: ['维度不存在'], pureNumeric };

  const nodeMap = new Map<string, GraphNode>();
  const ensure = (name: string, declared: boolean) => {
    let n = nodeMap.get(name);
    if (!n) { n = makeNode(name); nodeMap.set(name, n); }
    touchNode(n, dimId, dim.owner, declared);
    return n;
  };
  for (const s of dim.states) ensure(s, true);

  const edges: GraphEdge[] = [];
  for (const ev of sc.events) {
    const cross = crossDimCount(ev) > 1;
    ev.effects.forEach((f, i) => {
      if (f.dimension !== dimId) return;
      ensure(f.from, dim.states.includes(f.from));
      ensure(f.to, dim.states.includes(f.to));
      edges.push({
        id: `${ev.id}#${i}`,
        eventId: ev.id,
        event: ev.name,
        trigger: ev.trigger,
        from: f.from,
        to: f.to,
        dimId,
        dimName: dim.name,
        crossDim: cross,
        listen: ev.listen,
      });
    });
    // 前提里引用到的状态也要显示（即使是别的维度事件的前提）
    for (const p of ev.preStates) {
      if (p.dimension === dimId) ensure(p.state, dim.states.includes(p.state));
    }
  }

  const startName = sc.startState[dimId];
  for (const n of nodeMap.values()) n.isStart = n.name === startName;

  const undeclared = [...nodeMap.values()].filter((n) => !n.declared);
  const localWarnings = undeclared.map(
    (n) => `维度「${dim.name}」里的状态「${n.name}」只在事件里出现、还没在维度中正式声明（图上画成虚线框）`,
  );
  return {
    nodes: [...nodeMap.values()],
    edges,
    warnings: [...warnings, ...localWarnings],
    pureNumeric: pureNumeric.filter((e) => eventTouchesDimension(e, dimId) || e.effects.length === 0),
  };
}

// 总超图：全部维度合并，同名状态粘合成一个节点 = 整个奇域关卡的精准状态
export function buildTotalGraph(sc: Scenario2): DerivedGraph {
  const { warnings, pureNumeric } = collectIssues(sc);
  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  // 先落所有维度声明的状态（带上归属）
  for (const d of sc.dimensions) {
    for (const s of d.states) {
      let n = nodeMap.get(s);
      if (!n) { n = makeNode(s); nodeMap.set(s, n); }
      touchNode(n, d.id, d.owner, true);
    }
  }

  // 再落事件引用到的状态（可能带出新维度归属或未声明状态）
  const dimById = new Map(sc.dimensions.map((d) => [d.id, d]));
  const glue = (name: string, dimId: string) => {
    const d = dimById.get(dimId);
    if (!d) return;
    let n = nodeMap.get(name);
    if (!n) { n = makeNode(name); nodeMap.set(name, n); }
    touchNode(n, dimId, d.owner, d.states.includes(name));
  };

  for (const ev of sc.events) {
    const cross = crossDimCount(ev) > 1;
    ev.effects.forEach((f, i) => {
      if (!dimById.has(f.dimension)) return; // 体检里已报警
      glue(f.from, f.dimension);
      glue(f.to, f.dimension);
      edges.push({
        id: `${ev.id}#${i}`,
        eventId: ev.id,
        event: ev.name,
        trigger: ev.trigger,
        from: f.from,
        to: f.to,
        dimId: f.dimension,
        dimName: dimNameOf(sc, f.dimension),
        crossDim: cross,
        listen: ev.listen,
      });
    });
    for (const p of ev.preStates) glue(p.state, p.dimension);
  }

  const startNames = new Set(Object.values(sc.startState));
  const gluedNames: string[] = [];
  for (const n of nodeMap.values()) {
    n.glued = n.dims.length > 1;
    n.isStart = startNames.has(n.name) && n.dims.some((d) => sc.startState[d] === n.name);
    if (n.glued) gluedNames.push(n.name);
  }

  const localWarnings: string[] = [];
  if (gluedNames.length > 0) {
    localWarnings.push(`同名状态粘合：${gluedNames.map((s) => `「${s}」`).join('、')} 在多个维度里同名，已粘合成一个节点`);
  }
  const undeclared = [...nodeMap.values()].filter((n) => !n.declared);
  for (const n of undeclared) {
    localWarnings.push(`状态「${n.name}」只在事件里出现、在任何维度里都没正式声明（图上画成虚线框）`);
  }
  return { nodes: [...nodeMap.values()], edges, warnings: [...warnings, ...localWarnings], pureNumeric };
}
