'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { compressImage, storagePath } from '@/lib/image';
import { toUserMessage } from '@/lib/errors';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';

interface UploaderProps {
  restaurantId: string;
  kind: 'logo' | 'cover' | 'product' | 'offer';
  value: string | null;
  onChange: (url: string | null) => void;
  label: string;
  hint?: string;
  /** نسبة العرض إلى الارتفاع في المعاينة */
  aspect?: 'square' | 'wide' | 'card';
  className?: string;
}

const ASPECT = {
  square: 'aspect-square max-w-32',
  wide: 'aspect-[16/7]',
  card: 'aspect-[4/3] max-w-56',
} as const;

export function ImageUploader({
  restaurantId, kind, value, onChange, label, hint, aspect = 'card', className,
}: UploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const compressed = await compressImage(file);
      const supabase = createClient();
      const path = storagePath(restaurantId, kind, compressed.name);

      const { error } = await supabase.storage
        .from('restaurant-media')
        .upload(path, compressed, { cacheControl: '31536000', upsert: false });
      if (error) throw error;

      const { data } = supabase.storage.from('restaurant-media').getPublicUrl(path);
      onChange(data.publicUrl);
      toast.success('تم رفع الصورة.');
    } catch (error) {
      toast.error(toUserMessage(error, 'رفع صورة'));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <p className="text-[0.8125rem] font-medium text-text">{label}</p>

      <div className={cn('relative overflow-hidden rounded-xl border border-dashed border-border-strong bg-surface-2', ASPECT[aspect])}>
        {value ? (
          <Image
            src={value}
            alt=""
            fill
            sizes="(max-width: 640px) 100vw, 320px"
            className={cn('object-cover', kind === 'logo' && 'object-contain p-2')}
            unoptimized={value.startsWith('/')}
          />
        ) : (
          <div className="grid h-full place-items-center text-subtle">
            <ImagePlus className="size-7" aria-hidden />
          </div>
        )}

        {busy && (
          <div className="absolute inset-0 grid place-items-center bg-surface/70 backdrop-blur-sm">
            <Loader2 className="size-6 animate-spin text-primary" aria-hidden />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {value ? 'تغيير الصورة' : 'رفع صورة'}
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-soft disabled:opacity-50"
          >
            <Trash2 className="size-3.5" aria-hidden />
            إزالة
          </button>
        )}
      </div>

      {hint && <p className="text-xs text-subtle">{hint}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
    </div>
  );
}
