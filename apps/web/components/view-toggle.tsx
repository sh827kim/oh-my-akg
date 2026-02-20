'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { LayoutGrid, List } from 'lucide-react';

export function ViewToggle({ currentView }: { currentView: 'card' | 'list' }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const toggleView = (view: 'card' | 'list') => {
        const params = new URLSearchParams(searchParams);
        params.set('view', view);
        router.replace(`${pathname}?${params.toString()}`);
    };

    return (
        <div className="flex items-center rounded-lg bg-white/5 p-1 border border-white/10">
            <button
                onClick={() => toggleView('card')}
                className={`rounded-md p-1.5 transition-all ${currentView === 'card'
                        ? 'bg-primary/20 text-primary shadow-sm'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                title="Card View"
            >
                <LayoutGrid className="h-4 w-4" />
            </button>
            <button
                onClick={() => toggleView('list')}
                className={`rounded-md p-1.5 transition-all ${currentView === 'list'
                        ? 'bg-primary/20 text-primary shadow-sm'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                title="List View"
            >
                <List className="h-4 w-4" />
            </button>
        </div>
    );
}
