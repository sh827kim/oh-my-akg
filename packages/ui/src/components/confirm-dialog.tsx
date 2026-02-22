/**
 * ConfirmDialog 컴포넌트
 * 삭제/거부 등 위험 액션 확인용 모달
 */
'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Button } from './button';

interface ConfirmDialogProps {
  /** 열림 상태 */
  open: boolean;
  /** 닫기 핸들러 */
  onOpenChange: (open: boolean) => void;
  /** 제목 */
  title: string;
  /** 설명 텍스트 */
  description?: string;
  /** 확인 버튼 레이블 */
  confirmLabel?: string;
  /** 취소 버튼 레이블 */
  cancelLabel?: string;
  /** 위험 액션 여부 (빨간 버튼) */
  destructive?: boolean;
  /** 확인 클릭 콜백 */
  onConfirm: () => void;
  /** 로딩 상태 */
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '확인',
  cancelLabel = '취소',
  destructive = false,
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? '처리 중...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
