import { useState } from 'react';
import type { PriorityResult } from '@/lib/priority';
import type { Scenario } from '@/types/model';
import PitchPanel from './PitchPanel';
import TotalGraphPanel from './TotalGraphPanel';
import SearchTreePanel from './SearchTreePanel';
import CompositePanel from './CompositePanel';
import ProfessionPanel from './ProfessionPanel';

interface Props {
  scenario: Scenario;
  result: PriorityResult;
  alpha: number;
  onChange: (sc: Scenario) => void;
}

// 总览：位置联合状态 / 总超图 / DFS 搜索树 / 复合预览 / 职业名册 合并为一个页签
const SUBS = ['位置联合状态', '总超图', 'DFS 搜索树', '复合预览', '职业名册'] as const;

export default function OverviewPanel({ scenario, result, alpha, onChange }: Props) {
  const [sub, setSub] = useState<(typeof SUBS)[number]>('位置联合状态');
  return (
    <div className="h-full flex flex-col">
      <div className="border-b px-4 pt-2 flex gap-1 bg-card">
        {SUBS.map((s) => (
          <button key={s} onClick={() => setSub(s)}
            className={`px-3 py-1.5 rounded-t text-sm ${sub === s ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted'}`}>
            {s}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        {sub === '位置联合状态' && <PitchPanel scenario={scenario} onChange={onChange} />}
        {sub === '总超图' && <TotalGraphPanel scenario={scenario} result={result} />}
        {sub === 'DFS 搜索树' && <SearchTreePanel scenario={scenario} result={result} alpha={alpha} />}
        {sub === '复合预览' && <CompositePanel scenario={scenario} />}
        {sub === '职业名册' && <ProfessionPanel scenario={scenario} onChange={onChange} />}
      </div>
    </div>
  );
}
