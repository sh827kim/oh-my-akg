'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LayoutDashboard, Network, Layers, Settings, ClipboardCheck, Search } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';

const navItems = [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/graph', label: 'Dependency Graph', icon: Network },
    { href: '/architecture', label: 'Architecture', icon: Layers },
    // { href: '/kafka', label: 'Kafka Topics', icon: MessageSquare }, // Will be enabled later
    { href: '/approvals', label: 'Approvals', icon: ClipboardCheck },
    { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
    const pathname = usePathname();
    const router = useRouter();
    const searchParams = useSearchParams();

    const handleSearch = useDebouncedCallback((term: string) => {
        const params = new URLSearchParams(searchParams.toString());
        if (term) {
            params.set('q', term);
        } else {
            params.delete('q');
        }
        router.replace(`${pathname}?${params.toString()}`);
    }, 300);

    return (
        <aside className="w-64 border-r border-white/10 bg-black/40 flex flex-col h-full backdrop-blur-md">
            <div className="flex h-16 items-center px-6">
                <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-gradient-to-tr from-primary to-secondary animate-pulse" />
                    <span className="text-lg font-bold tracking-wider text-white">
                        ARCHI<span className="text-primary">.AI</span>
                    </span>
                </div>
            </div>

            <div className="px-3 mb-2">
                <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search className="h-4 w-4 text-gray-500" />
                    </div>
                    <input
                        type="text"
                        placeholder="Global Search (Cmd+K)"
                        className="w-full rounded-md bg-white/5 border border-white/10 pl-9 pr-3 py-2 text-sm text-gray-300 placeholder-gray-500 focus:outline-none focus:border-primary/50 transition-colors"
                        onChange={(e) => handleSearch(e.target.value)}
                        defaultValue={searchParams.get('q')?.toString()}
                    />
                </div>
            </div>

            <nav className="flex-1 space-y-1 px-3 py-2">
                {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${isActive
                                    ? 'bg-primary/20 text-primary'
                                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                                }`}
                        >
                            <item.icon className={`h-4 w-4 ${isActive ? 'text-primary' : 'text-gray-500'}`} />
                            {item.label}
                        </Link>
                    );
                })}
            </nav>

            <div className="p-4 border-t border-white/10">
                <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500" />
                    <div>
                        <p className="text-sm font-medium text-white">Admin User</p>
                        <p className="text-xs text-gray-500">admin@archi.ai</p>
                    </div>
                </div>
            </div>
        </aside>
    );
}
