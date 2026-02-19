'use client';

import * as Dialog from '@radix-ui/react-dialog';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    description?: string;
    confirmText?: string;
    cancelText?: string;
    destructive?: boolean;
    loading?: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
}

export function ConfirmDialog({
    open,
    title,
    description,
    confirmText = '확인',
    cancelText = '취소',
    destructive = false,
    loading = false,
    onOpenChange,
    onConfirm,
}: ConfirmDialogProps) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm" />
                <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-[#101217] p-5 shadow-2xl focus:outline-none">
                    <Dialog.Title className="text-lg font-semibold text-white">{title}</Dialog.Title>
                    {description && <Dialog.Description className="mt-2 text-sm text-gray-300">{description}</Dialog.Description>}

                    <div className="mt-6 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => onOpenChange(false)}
                            disabled={loading}
                            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200 hover:bg-white/10 disabled:opacity-50"
                        >
                            {cancelText}
                        </button>
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={loading}
                            className={`rounded-md px-3 py-2 text-sm text-white disabled:opacity-50 ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary/90'
                                }`}
                        >
                            {loading ? '처리중...' : confirmText}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
