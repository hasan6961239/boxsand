'use client';

import { useId, useState } from 'react';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/cn';

interface SortableListProps<T extends { id: string }> {
  items: T[];
  onReorder: (orderedIds: string[]) => void | Promise<void>;
  renderItem: (item: T) => React.ReactNode;
  className?: string;
}

/**
 * قائمة تُرتَّب بالسحب والإفلات.
 *
 * التفعيل بعد حركة ٨ بكسل (أو ضغطة ٢٥٠ مللي ثانية باللمس) حتى لا يتحوّل كل
 * نقر على زر داخل الصف إلى بداية سحب على الهاتف. والترتيب متاح بلوحة المفاتيح
 * أيضاً: مسافة للالتقاط، أسهم للتحريك.
 */
export function SortableList<T extends { id: string }>({
  items, onReorder, renderItem, className,
}: SortableListProps<T>) {
  const contextId = useId();
  const [order, setOrder] = useState(items);

  /*
   * الترتيب محفوظ محلياً ليستجيب السحب فوراً قبل أن يردّ الخادم. نعيد
   * المزامنة فقط حين تتغيّر القائمة القادمة من الخادم فعلاً (إضافة أو حذف أو
   * ترتيب جديد)، لا عند كل إعادة رسم — وإلا ارتدّ العنصر المسحوب إلى مكانه.
   */
  const propsSignature = items.map((item) => item.id).join(',');
  const [syncedFrom, setSyncedFrom] = useState(propsSignature);
  if (propsSignature !== syncedFrom) {
    setSyncedFrom(propsSignature);
    setOrder(items);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = order.findIndex((item) => item.id === active.id);
    const to = order.findIndex((item) => item.id === over.id);
    if (from === -1 || to === -1) return;

    const next = arrayMove(order, from, to);
    setOrder(next);
    void onReorder(next.map((item) => item.id));
  }

  return (
    <DndContext
      id={contextId}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `بدأ سحب العنصر ${active.id}`,
          onDragOver: () => '',
          onDragEnd: () => 'تم تغيير الترتيب',
          onDragCancel: () => 'أُلغي السحب',
        },
      }}
    >
      <SortableContext items={order.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <ul className={cn('space-y-2', className)}>
          {order.map((item) => (
            <SortableRow key={item.id} id={item.id}>
              {renderItem(item)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'surface-card flex items-stretch gap-0 overflow-hidden p-0',
        isDragging && 'z-10 opacity-90 shadow-lg',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="اسحب لإعادة الترتيب"
        className="flex shrink-0 cursor-grab touch-none items-center border-e border-border px-2 text-subtle transition-colors hover:bg-surface-2 hover:text-text active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}
