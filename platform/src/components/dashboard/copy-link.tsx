'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

export function CopyLink({ url, className }: { url: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard محجوب (سياق غير آمن أو رفض المستخدم) — نُبقي النص محدَّداً يدوياً
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={cn('flex items-stretch gap-2', className)}>
      <code className="nums min-w-0 flex-1 truncate rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-xs text-muted">
        {url}
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label="نسخ الرابط"
        className={cn(
          'grid w-11 shrink-0 place-items-center rounded-xl border transition-colors',
          copied ? 'border-success/40 bg-success-soft text-success' : 'border-border text-muted hover:bg-surface-2 hover:text-text',
        )}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
