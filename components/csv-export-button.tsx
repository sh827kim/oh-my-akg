'use client';

import { Download } from 'lucide-react';

interface ExportButtonProps {
    data: Array<Record<string, string | number | boolean | null | undefined>>;
    filename?: string;
}

export function CsvExportButton({ data, filename = 'export.csv' }: ExportButtonProps) {
    const handleExport = () => {
        if (!data || data.length === 0) return;

        // Extract headers
        const headers = Object.keys(data[0]);

        // Convert to CSV
        const csvContent = [
            headers.join(','),
            ...data.map(row =>
                headers.map(header => {
                    const val = row[header];
                    // Handle strings with commas or newlines
                    if (typeof val === 'string') {
                        return `"${val.replace(/"/g, '""')}"`;
                    }
                    return val;
                }).join(',')
            )
        ].join('\n');

        // Create download link
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <button
            onClick={handleExport}
            className="flex items-center space-x-2 rounded-md bg-[#2a2a2a] px-3 py-2 text-sm font-medium text-white hover:bg-[#333] transition-colors"
        >
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
        </button>
    );
}
