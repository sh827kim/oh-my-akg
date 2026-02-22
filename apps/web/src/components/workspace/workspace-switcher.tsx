/**
 * WorkspaceSwitcher
 * 사이드바 상단의 워크스페이스 선택 팝오버
 * - 현재 워크스페이스 표시
 * - 전환 / 신규 생성 / 삭제 지원
 */
'use client';

import { useState, useRef } from 'react';
import {
  ChevronDown,
  Check,
  Plus,
  Trash2,
  FolderOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  cn,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  Input,
  Separator,
  ConfirmDialog,
} from '@archi-navi/ui';
import { useWorkspace } from '@/contexts/workspace-context';
import { DEFAULT_WORKSPACE_ID } from '@archi-navi/shared';

export function WorkspaceSwitcher() {
  const { workspaceId, workspaceName, workspaces, setWorkspace, refreshWorkspaces } =
    useWorkspace();

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ─── 워크스페이스 생성 ─── */
  const createWorkspace = async () => {
    const name = newName.trim();
    if (!name) return;

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('create failed');

      const data = (await res.json()) as { id: string; name: string };
      await refreshWorkspaces();
      setWorkspace(data.id);
      setNewName('');
      setCreating(false);
      setOpen(false);
      toast.success(`"${data.name}" 워크스페이스 생성됨`);
    } catch {
      toast.error('워크스페이스 생성 실패');
    }
  };

  /* ─── 워크스페이스 삭제 ─── */
  const deleteWorkspace = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/workspaces/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');

      // 현재 선택된 워크스페이스였으면 기본으로 전환
      if (workspaceId === deleteTarget.id) {
        setWorkspace(DEFAULT_WORKSPACE_ID);
      }
      await refreshWorkspaces();
      toast.success(`"${deleteTarget.name}" 워크스페이스 삭제됨`);
    } catch {
      toast.error('워크스페이스 삭제 실패');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* 현재 워크스페이스 표시 버튼 */}
          <button
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left',
              'hover:bg-muted/50 transition-colors',
              'text-sm font-medium text-foreground',
            )}
          >
            <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
            <span className="flex-1 truncate">{workspaceName}</span>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200',
                open && 'rotate-180',
              )}
            />
          </button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-64 p-2">
          {/* 워크스페이스 목록 */}
          <div className="space-y-0.5 mb-2">
            <p className="px-2 py-1 text-xs text-muted-foreground font-medium uppercase tracking-wider">
              워크스페이스
            </p>
            {workspaces.map((ws) => (
              <div key={ws.id} className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setWorkspace(ws.id);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors text-left',
                    ws.id === workspaceId
                      ? 'bg-primary/15 text-primary'
                      : 'text-foreground hover:bg-muted/50',
                  )}
                >
                  {ws.id === workspaceId && (
                    <Check className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className={cn('truncate', ws.id !== workspaceId && 'pl-5')}>
                    {ws.name}
                  </span>
                </button>

                {/* DEFAULT 워크스페이스는 삭제 불가 */}
                {ws.id !== DEFAULT_WORKSPACE_ID && (
                  <button
                    onClick={() => setDeleteTarget({ id: ws.id, name: ws.name })}
                    className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <Separator className="my-2" />

          {/* 새 워크스페이스 생성 */}
          {creating ? (
            <div className="flex gap-1.5 px-1">
              <Input
                ref={inputRef}
                autoFocus
                placeholder="워크스페이스 이름"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createWorkspace();
                  if (e.key === 'Escape') {
                    setCreating(false);
                    setNewName('');
                  }
                }}
                className="h-7 text-xs"
              />
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => void createWorkspace()}
                disabled={!newName.trim()}
              >
                추가
              </Button>
            </div>
          ) : (
            <button
              onClick={() => {
                setCreating(true);
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              새 워크스페이스
            </button>
          )}
        </PopoverContent>
      </Popover>

      {/* 삭제 확인 다이얼로그 */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="워크스페이스 삭제"
        description={`"${deleteTarget?.name}" 워크스페이스와 모든 데이터(오브젝트, 관계, 레이어)를 삭제합니다. 이 작업은 되돌릴 수 없습니다.`}
        confirmLabel="삭제"
        destructive
        loading={deleting}
        onConfirm={() => void deleteWorkspace()}
      />
    </>
  );
}
