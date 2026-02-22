/**
 * 관계 매핑 클라이언트 컴포넌트
 * - workspaceId 연동으로 다중 워크스페이스 지원
 * - 승인된 Relation 목록 표시
 * - 수동 관계 등록 다이얼로그
 * - 관계 삭제
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Loader2, Link as LinkIcon } from 'lucide-react';
import {
  cn,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ConfirmDialog,
} from '@archi-navi/ui';
import { toast } from 'sonner';
import { useWorkspace } from '@/contexts/workspace-context';

/* ─── 타입 ─── */
interface ObjectItem {
  id: string;
  name: string;
  displayName: string | null;
  objectType: string;
}

interface RelationItem {
  id: string;
  relationType: string;
  status: string;
  confidence: number | null;
  source: string;
  subjectObjectId: string;
  objectId: string;
  subjectName?: string;
  objectName?: string;
}

/** 관계 타입 → Badge variant */
function getRelationVariant(type: string): 'default' | 'secondary' | 'outline' | 'success' | 'warning' {
  switch (type) {
    case 'call':    return 'default';
    case 'read':
    case 'write':   return 'secondary';
    case 'produce':
    case 'consume': return 'warning';
    case 'expose':  return 'success';
    default:        return 'outline';
  }
}

const RELATION_TYPES = ['call', 'expose', 'read', 'write', 'produce', 'consume', 'depend_on'] as const;
type RelationType = typeof RELATION_TYPES[number];

/* ════════════════════════════════════════════════════════════════
   수동 관계 등록 다이얼로그
   ════════════════════════════════════════════════════════════════ */
function AddRelationDialog({
  open, onOpenChange, workspaceId, objects, onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaceId: string;
  objects: ObjectItem[];
  onSuccess: () => void;
}) {
  const [subjectId, setSubjectId] = useState('');
  const [relationType, setRelationType] = useState<RelationType>('call');
  const [objectId, setObjectId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setSubjectId(''); setRelationType('call'); setObjectId(''); }
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectId || !objectId) { toast.error('주체와 객체를 선택하세요'); return; }
    if (subjectId === objectId) { toast.error('자기 자신과의 관계는 등록할 수 없습니다'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/relations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, subjectObjectId: subjectId, relationType, objectId, confidence: 1.0 }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? '등록 실패');
      }
      toast.success('관계 등록됨');
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '관계 등록 실패');
    } finally { setSaving(false); }
  };

  const objectLabel = (obj: ObjectItem) =>
    obj.displayName ? `${obj.displayName} (${obj.name})` : obj.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>관계 등록</DialogTitle></DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pt-2">
          {/* 주체 선택 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">주체 (Subject) <span className="text-destructive">*</span></label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger><SelectValue placeholder="주체 Object 선택" /></SelectTrigger>
              <SelectContent>
                {objects.map((obj) => (
                  <SelectItem key={obj.id} value={obj.id}>{objectLabel(obj)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 관계 타입 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">관계 타입 <span className="text-destructive">*</span></label>
            <Select value={relationType} onValueChange={(v) => setRelationType(v as RelationType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RELATION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 객체 선택 */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">객체 (Object) <span className="text-destructive">*</span></label>
            <Select value={objectId} onValueChange={setObjectId}>
              <SelectTrigger><SelectValue placeholder="대상 Object 선택" /></SelectTrigger>
              <SelectContent>
                {objects.filter((o) => o.id !== subjectId).map((obj) => (
                  <SelectItem key={obj.id} value={obj.id}>{objectLabel(obj)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 미리보기 */}
          {subjectId && objectId && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                {objects.find((o) => o.id === subjectId)?.displayName ?? objects.find((o) => o.id === subjectId)?.name}
              </span>
              <Badge variant={getRelationVariant(relationType)} className="text-[10px]">{relationType}</Badge>
              <span className="font-medium text-foreground">
                {objects.find((o) => o.id === objectId)?.displayName ?? objects.find((o) => o.id === objectId)?.name}
              </span>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>취소</Button>
            <Button type="submit" disabled={saving || !subjectId || !objectId}>
              {saving ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />등록 중...</> : <><Plus className="h-4 w-4 mr-1.5" />관계 등록</>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ════════════════════════════════════════════════════════════════
   메인 컴포넌트
   ════════════════════════════════════════════════════════════════ */
export function RelationsClient() {
  const { workspaceId } = useWorkspace();
  const [relations, setRelations] = useState<RelationItem[]>([]);
  const [allObjects, setAllObjects] = useState<ObjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RelationItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  /* ─── 데이터 로드 ─── */
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [relRes, objRes] = await Promise.all([
        fetch(`/api/relations?workspaceId=${workspaceId}&status=APPROVED`),
        fetch(`/api/objects?workspaceId=${workspaceId}`),
      ]);
      if (!relRes.ok || !objRes.ok) throw new Error();

      const relData = (await relRes.json()) as RelationItem[];
      const objData = (await objRes.json()) as ObjectItem[];
      setAllObjects(objData);

      const objMap = new Map(objData.map((o) => [o.id, o.displayName ?? o.name]));
      setRelations(relData.map((r) => ({
        ...r,
        subjectName: objMap.get(r.subjectObjectId) ?? r.subjectObjectId,
        objectName: objMap.get(r.objectId) ?? r.objectId,
      })));
    } catch { console.error('[RelationsClient] 로드 실패'); }
    finally { setLoading(false); }
  }, [workspaceId]);

  useEffect(() => { void loadData(); }, [loadData]);

  /* ─── 관계 삭제 ─── */
  const deleteRelation = async (id: string) => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/relations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('관계 삭제됨');
      setDeleteTarget(null);
      await loadData();
    } catch { toast.error('삭제 실패'); }
    finally { setDeleting(false); }
  };

  return (
    <div className="p-6 space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-foreground">관계 매핑</h2>
          <p className="text-sm text-muted-foreground">
            {loading ? '로딩 중...' : `승인된 Relation ${relations.length}개`}
          </p>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)} disabled={allObjects.length === 0}>
          <Plus className="h-4 w-4 mr-1.5" />
          관계 등록
        </Button>
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin mr-2" />
          <span className="text-sm">로드 중...</span>
        </div>
      )}

      {/* 빈 상태 */}
      {!loading && relations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <LinkIcon className="h-10 w-10 opacity-20" />
          <p className="text-sm">등록된 관계가 없습니다.</p>
          <p className="text-xs text-center max-w-sm">
            "관계 등록" 버튼으로 직접 등록하거나, 승인 대기 페이지에서 추론된 관계를 승인하세요.
          </p>
          {allObjects.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />첫 관계 등록하기
            </Button>
          )}
        </div>
      )}

      {/* 관계 테이블 */}
      {!loading && relations.length > 0 && (
        <div className="rounded-xl glass-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">주체 (Subject)</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">관계 타입</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">객체 (Object)</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">출처</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">신뢰도</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody>
              {relations.map((rel) => (
                <tr key={rel.id} className="border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors group">
                  <td className="px-4 py-3 font-medium text-foreground">{rel.subjectName}</td>
                  <td className="px-4 py-3">
                    <Badge variant={getRelationVariant(rel.relationType)}>{rel.relationType}</Badge>
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground">{rel.objectName}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded',
                      rel.source === 'MANUAL' ? 'bg-blue-500/10 text-blue-400' : 'bg-muted text-muted-foreground',
                    )}>
                      {rel.source}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {rel.confidence != null ? `${Math.round(rel.confidence * 100)}%` : '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setDeleteTarget(rel)}
                      className="rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:bg-destructive/10"
                      title="삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 관계 등록 다이얼로그 */}
      <AddRelationDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        workspaceId={workspaceId}
        objects={allObjects}
        onSuccess={() => void loadData()}
      />

      {/* 삭제 확인 */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}
        title="관계 삭제"
        description={`"${deleteTarget?.subjectName} → ${deleteTarget?.relationType} → ${deleteTarget?.objectName}" 관계를 삭제하시겠습니까?`}
        confirmLabel="삭제"
        destructive
        loading={deleting}
        onConfirm={() => { if (deleteTarget) void deleteRelation(deleteTarget.id); }}
      />
    </div>
  );
}
