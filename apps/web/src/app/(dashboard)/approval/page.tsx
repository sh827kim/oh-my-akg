/**
 * 승인 대기 페이지
 * 추론된 Relation 후보 목록 — 승인/거부 액션
 */
import type { Metadata } from 'next';
import { ApprovalList } from '@/components/approval/approval-list';

export const metadata: Metadata = {
  title: '승인 대기',
};

export default function ApprovalPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">승인 대기</h2>
        <p className="text-sm text-muted-foreground">
          추론 엔진이 발견한 관계 후보를 검토하고 승인 또는 거부합니다
        </p>
      </div>
      <ApprovalList />
    </div>
  );
}
