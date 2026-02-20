'use client';

import { useEffect, useMemo, useState } from 'react';

type ChangeRequest = {
    id: number;
    request_type: string;
    payload: Record<string, unknown>;
    status: string;
    requested_by?: string | null;
    created_at: string;
};

export default function ApprovalsPage() {
    const [items, setItems] = useState<ChangeRequest[]>([]);
    const [selectedIds, setSelectedIds] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [processing, setProcessing] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/change-requests?status=PENDING');
            const data = await res.json();
            setItems(data.items ?? []);
            setSelectedIds([]);
        } finally {
            setLoading(false);
        }
    };

    const selectedCount = selectedIds.length;
    const allSelected = items.length > 0 && selectedCount === items.length;
    const hasSelection = selectedCount > 0;

    const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

    const toggleSelect = (id: number) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
    };

    const toggleSelectAll = () => {
        setSelectedIds(allSelected ? [] : items.map((item) => item.id));
    };

    const processBulk = async (status: 'APPROVED' | 'REJECTED') => {
        if (!hasSelection) return;
        setProcessing(true);
        try {
            await fetch('/api/change-requests/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, ids: selectedIds }),
            });
            await load();
        } finally {
            setProcessing(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    return (
        <div className="p-6">
            <h1 className="mb-4 text-2xl font-bold">Approvals</h1>
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <button
                    onClick={toggleSelectAll}
                    disabled={loading || items.length === 0 || processing}
                    className="rounded border border-white/20 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                    {allSelected ? '전체 해제' : '전체 선택'}
                </button>
                <button
                    onClick={() => processBulk('APPROVED')}
                    disabled={!hasSelection || loading || processing}
                    className="rounded bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                    선택 승인 ({selectedCount})
                </button>
                <button
                    onClick={() => processBulk('REJECTED')}
                    disabled={!hasSelection || loading || processing}
                    className="rounded bg-red-600 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                    선택 반려 ({selectedCount})
                </button>
            </div>
            {loading ? <p>Loading...</p> : null}
            <div className="space-y-3">
                {items.map((item) => (
                    <div key={item.id} className="rounded border border-white/10 bg-black/20 p-4">
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={selectedIdSet.has(item.id)}
                                onChange={() => toggleSelect(item.id)}
                                disabled={processing}
                            />
                            <p className="text-sm text-gray-400">
                                #{item.id} · {item.request_type} · by {item.requested_by ?? '-'}
                            </p>
                        </div>
                        <pre className="mt-2 overflow-auto rounded bg-black/40 p-2 text-xs text-gray-300">{JSON.stringify(item.payload, null, 2)}</pre>
                    </div>
                ))}
                {!loading && items.length === 0 ? <p className="text-sm text-gray-500">No pending requests.</p> : null}
            </div>
        </div>
    );
}
