// 图的自动摆放：从起始状态出发按"几步能走到"分层，从左到右铺开
// 同层内按"和上一层连线的平均位置"排序（重心法），来回扫几遍让连线尽量顺
// 只读派生视图专用：不需要用户拖坐标，事件库一改，重新算一遍即可
export interface Placed {
  x: number;
  y: number;
}

export interface LayoutResult {
  pos: Map<string, Placed>;
  width: number;
  height: number;
}

const COL_W = 200;  // 层间距
const ROW_H = 104;  // 同层节点间距
const PAD = 90;     // 画布留白

export function layoutGraph(
  nodeKeys: string[],
  edges: { from: string; to: string }[],
  startKeys: string[],
): LayoutResult {
  if (nodeKeys.length === 0) return { pos: new Map(), width: 600, height: 400 };

  // 邻接表（去重、忽略自环对分层的影响）
  const out = new Map<string, Set<string>>();
  const inn = new Map<string, Set<string>>();
  for (const k of nodeKeys) { out.set(k, new Set()); inn.set(k, new Set()); }
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (!out.has(e.from) || !out.has(e.to)) continue;
    out.get(e.from)!.add(e.to);
    inn.get(e.to)!.add(e.from);
  }

  // 起点：优先用用户设的起始状态；没有则用"没有入边的点"；再没有就拿第一个
  let roots = startKeys.filter((k) => nodeKeys.includes(k));
  if (roots.length === 0) roots = nodeKeys.filter((k) => (inn.get(k)?.size ?? 0) === 0);
  if (roots.length === 0) roots = [nodeKeys[0]];

  // 逐层扩展：每个点的层号 = 从任一起点出发的最短步数
  const layer = new Map<string, number>();
  const queue = [...roots];
  for (const r of roots) layer.set(r, 0);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const l = layer.get(cur)!;
    for (const nx of out.get(cur) ?? []) {
      if (!layer.has(nx)) { layer.set(nx, l + 1); queue.push(nx); }
    }
  }
  // 走不到的点（比如被前提引用但没被任何变化指向）：排在最后一层之后
  let maxLayer = Math.max(0, ...layer.values());
  const unreached = nodeKeys.filter((k) => !layer.has(k));
  for (const k of unreached) layer.set(k, ++maxLayer);

  // 分层落桶
  const layers: string[][] = [];
  for (let i = 0; i <= maxLayer; i++) layers.push([]);
  for (const k of nodeKeys) layers[layer.get(k)!].push(k);
  for (const l of layers) l.sort((a, b) => a.localeCompare(b, 'zh'));

  // 重心排序：往下扫（按上一层邻居的平均位置排），再往上扫，来回几轮
  const orderIdx = new Map<string, number>();
  const refresh = () => { for (const l of layers) l.forEach((k, i) => orderIdx.set(k, i)); };
  refresh();
  const bary = (k: string, neighbors: Map<string, Set<string>>) => {
    const ns = [...(neighbors.get(k) ?? [])].filter((n) => orderIdx.has(n));
    if (ns.length === 0) return null;
    return ns.reduce((s, n) => s + orderIdx.get(n)!, 0) / ns.length;
  };
  for (let pass = 0; pass < 6; pass++) {
    const down = pass % 2 === 0;
    const seq = down ? layers.map((_, i) => i) : layers.map((_, i) => layers.length - 1 - i);
    for (const li of seq) {
      const nb = down ? inn : out;
      layers[li].sort((a, b) => {
        const ba = bary(a, nb), bb = bary(b, nb);
        if (ba === null && bb === null) return a.localeCompare(b, 'zh');
        if (ba === null) return 1;
        if (bb === null) return -1;
        return ba - bb;
      });
      refresh();
    }
  }

  // 计算坐标：每层垂直居中
  const maxCount = Math.max(1, ...layers.map((l) => l.length));
  const height = Math.max(420, PAD * 2 + maxCount * ROW_H);
  const width = Math.max(640, PAD * 2 + maxLayer * COL_W);
  const pos = new Map<string, Placed>();
  layers.forEach((l, li) => {
    const blockH = l.length * ROW_H;
    const y0 = (height - blockH) / 2 + ROW_H / 2;
    l.forEach((k, i) => {
      pos.set(k, { x: PAD + li * COL_W, y: y0 + i * ROW_H });
    });
  });
  return { pos, width, height };
}
