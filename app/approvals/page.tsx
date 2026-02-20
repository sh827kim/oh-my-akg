'use client';

import { useEffect, useState } from 'react';

type ChangeRequest = {
    id: number;
    project_id: string | null;
    change_type: string;
    payload: Record<string, unknown>;
    status: string;
    created_at: string;
};

export default function ApprovalsPage() {
    const [items, setItems] = useState<ChangeRequest[]>([]);
    const [loading, setLoading] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/change-requests?status=PENDING');
            const data = await res.json();
            setItems(data.items ?? []);
        } finally {
            setLoading(false);
        }
    };

    const processRequest = async (id: number, status: 'APPROVED' | 'REJECTED') => {
        await fetch(`/api/change-requests/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        await load();
    };

    useEffect(() => {
        load();
    }, []);

    return (
        <div className="p-6">
            <h1 className="mb-4 text-2xl font-bold">Approvals</h1>
            {loading ? <p>Loading...</p> : null}
            <div className="space-y-3">
                {items.map((item) => (
                    <div key={item.id} className="rounded border border-white/10 bg-black/20 p-4">
                        <p className="text-sm text-gray-400">#{item.id} · {item.change_type}</p>
                        <pre className="mt-2 overflow-auto rounded bg-black/40 p-2 text-xs text-gray-300">{JSON.stringify(item.payload, null, 2)}</pre>
                        <div className="mt-3 flex gap-2">
                            <button
                                onClick={() => processRequest(item.id, 'APPROVED')}
                                className="rounded bg-green-600 px-3 py-1 text-sm text-white"
                            >
                                Approve
                            </button>
                            <button
                                onClick={() => processRequest(item.id, 'REJECTED')}
                                className="rounded bg-red-600 px-3 py-1 text-sm text-white"
                            >
                                Reject
                            </button>
                        </div>
                    </div>
                ))}
                {!loading && items.length === 0 ? <p className="text-sm text-gray-500">No pending requests.</p> : null}
            </div>
        </div>
    );
}
