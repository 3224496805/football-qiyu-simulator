// 把一条事件完整翻译成大白话中文，供悬浮提示和右侧检查器共用（保证各处说法一致）
import type { QiyuEvent, Scenario2 } from '@/types/model2';
import { ENTITY_NAMES } from '@/types/model2';
import { dimNameOf } from './derive2';

export function describeEvent(sc: Scenario2, ev: QiyuEvent): string {
  const lines: string[] = [];
  lines.push(`事件：${ev.name}（${ENTITY_NAMES[ev.owner]}的${ev.trigger}事件）`);
  if (ev.trigger === '被动') {
    lines.push(ev.listen.length > 0 ? `监听：${ev.listen.join('、')}` : '监听：无（持续检测，每次判定都检查前提）');
  }
  if (ev.preStates.length > 0) {
    lines.push('前提状态：' + ev.preStates.map((p) =>
      `${dimNameOf(sc, p.dimension)}${p.not ? '不处于' : '处于'}「${p.state}」`).join('；'));
  }
  if (ev.condition) lines.push(`其他前提：${ev.condition}`);
  if (ev.effects.length > 0) {
    lines.push('状态变化：' + ev.effects.map((f) =>
      `${dimNameOf(sc, f.dimension)} ${f.from}→${f.to}`).join('；'));
  } else {
    lines.push('状态变化：无（纯数值/纯信号事件，不会在图上画出）');
  }
  if (ev.numeric.length > 0) {
    lines.push('数值效果：' + ev.numeric.map((n) => `${n.kind} ${n.value}`).join('；') + (ev.affectsOthers ? '（作用于对方）' : ''));
  }
  if (ev.professions.length > 0) {
    lines.push('职业限制：' + ev.professions.map((id) =>
      sc.professions.find((p) => p.id === id)?.name ?? id).join('、'));
  }
  const extras: string[] = [];
  if (ev.basePriority !== 1) extras.push(`基础优先级 ${ev.basePriority}`);
  if (ev.cooldown > 0) extras.push(`冷却 ${ev.cooldown} tick`);
  if (extras.length > 0) lines.push(extras.join(' · '));
  if (ev.note) lines.push(`说明：${ev.note}`);
  return lines.join('\n');
}
