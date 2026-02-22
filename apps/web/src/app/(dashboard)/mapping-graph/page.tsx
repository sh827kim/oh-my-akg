/**
 * Object Mapping 뷰 페이지
 * React Flow 기반 Roll-up/Roll-down 그래프
 */
import type { Metadata } from 'next';
import { RollupGraph } from '@/components/mapping/rollup-graph';

export const metadata: Metadata = {
  title: 'Object Mapping',
};

export default function MappingGraphPage() {
  return (
    <div className="h-full w-full">
      <RollupGraph />
    </div>
  );
}
