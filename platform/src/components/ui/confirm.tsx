'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './modal';
import { Button } from './button';

interface ConfirmProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** تأكيد قبل أي عملية لا رجعة فيها — الحذف تحديداً. */
export function ConfirmDialog({
  open, onCancel, onConfirm, title, message,
  confirmLabel = 'تأكيد', cancelLabel = 'إلغاء', danger = true,
}: ConfirmProps) {
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onCancel}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={handleConfirm}
            loading={busy}
            loadingText="جارٍ التنفيذ…"
            data-autofocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-4 pt-1">
        {danger && (
          <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-danger-soft text-danger">
            <AlertTriangle className="size-5" aria-hidden />
          </div>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-bold text-text">{title}</h2>
          <p className="mt-1.5 text-sm text-muted leading-relaxed">{message}</p>
        </div>
      </div>
    </Modal>
  );
}

/** خطّاف يختصر إدارة حالة حوار التأكيد في الصفحات. */
export function useConfirm() {
  const [state, setState] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    onConfirm: () => void | Promise<void>;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });

  return {
    confirmProps: {
      ...state,
      onCancel: () => setState((s) => ({ ...s, open: false })),
      onConfirm: async () => {
        await state.onConfirm();
        setState((s) => ({ ...s, open: false }));
      },
    },
    ask: (options: { title: string; message: string; confirmLabel?: string; onConfirm: () => void | Promise<void> }) =>
      setState({ ...options, open: true }),
  };
}
