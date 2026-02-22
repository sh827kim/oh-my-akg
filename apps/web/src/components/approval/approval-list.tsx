/**
 * 승인 대기 목록 컴포넌트
 * PENDING 상태의 relation_candidates를 조회하고 승인/거부 처리
 * 글래스 카드 스타일
 */
'use client';

import { useEffect, useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Badge, Spinner, ConfirmDialog } from '@archi-navi/ui';

/** 후보 관계 타입 */
interface RelationCandidate {
  id: string;
  subjectName: string;
  relationType: string;
  objectName: string;
  confidence: number;
  source: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export function ApprovalList() {
  const [candidates, setCandidates] = useState<RelationCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [rejectTarget, setRejectTarget] = useState<RelationCandidate | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/inference/candidates?status=PENDING');
        if (!res.ok) throw new Error();
        const data = (await res.json()) as RelationCandidate[];
        setCandidates(data);
      } catch {
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  function handleAction(id: string, action: 'APPROVED' | 'REJECTED') {
    startTransition(async () => {
      try {
        await fetch(`/api/inference/candidates/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: action }),
        });
        setCandidates((prev) => prev.filter((c) => c.id !== id));
        toast.success(action === 'APPROVED' ? '관계 승인됨' : '관계 거부됨');
        setRejectTarget(null);
      } catch {
        toast.error('처리 실패');
      }
    });
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
        <Check className="h-8 w-8 text-green-500" />
        <p className="text-sm font-medium">승인 대기 중인 관계가 없습니다</p>
        <p className="text-xs">
          CLI에서 archi-navi infer 를 실행하면 새 후보가 생성됩니다
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {candidates.map((cand) => (
          <div
            key={cand.id}
            className="flex items-center justify-between rounded-xl p-4 transition-all glass-card"
          >
            {/* 관계 정보 */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-medium text-foreground">{cand.subjectName}</span>
              <Badge variant="outline">{cand.relationType}</Badge>
              <span className="font-medium text-foreground">{cand.objectName}</span>
            </div>

            {/* 메타 + 액션 */}
            <div className="flex items-center gap-4">
              <div className="text-right">
                <div className="text-xs text-muted-foreground">신뢰도</div>
                <div className="text-sm font-medium text-foreground">
                  {Math.round(cand.confidence * 100)}%
                </div>
              </div>

              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  onClick={() => handleAction(cand.id, 'APPROVED')}
                  disabled={isPending}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  승인
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRejectTarget(cand)}
                  disabled={isPending}
                  className="text-destructive hover:bg-destructive/10"
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  거부
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 거부 확인 다이얼로그 */}
      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(open) => { if (!open) setRejectTarget(null); }}
        title="관계 거부"
        description={`"${rejectTarget?.subjectName} → ${rejectTarget?.objectName}" 관계를 거부하시겠습니까?`}
        confirmLabel="거부"
        destructive
        onConfirm={() => {
          if (rejectTarget) handleAction(rejectTarget.id, 'REJECTED');
        }}
      />
    </>
  );
}
