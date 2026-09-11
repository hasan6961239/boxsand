import { can, config } from '../config.js';
import { localIsoNow } from '../prompt.js';
import * as cal from './calendar.js';
import * as drv from './drive.js';
import * as rem from './reminders.js';

// Tool and parameter names must stay ASCII — the Gemini API rejects anything
// else. The descriptions carry the Arabic so the model still reasons in it.
const S = { type: 'string' };

const REGISTRY = [
  {
    name: 'get_current_time',
    permission: null,
    declaration: {
      name: 'get_current_time',
      description: 'يرجّع التاريخ والوقت الحالي بتوقيت المستخدم. استعمله قبل أي حساب زمني بدل التخمين.',
      parameters: { type: 'object', properties: {} },
    },
    run: async () => ({ الآن: localIsoNow(), المنطقة_الزمنية: config.env.timezone }),
  },
  {
    name: 'list_events',
    permission: 'قراءة_التقويم',
    declaration: {
      name: 'list_events',
      description: 'يعرض المواعيد المسجلة في تقويم جوجل بين تاريخين.',
      parameters: {
        type: 'object',
        properties: {
          from: { ...S, description: 'بداية الفترة بالتوقيت المحلي، صيغة YYYY-MM-DDTHH:mm' },
          to: { ...S, description: 'نهاية الفترة بالتوقيت المحلي، صيغة YYYY-MM-DDTHH:mm' },
        },
        required: ['from', 'to'],
      },
    },
    run: async (a) => cal.listEvents({ from: rem.parseLocal(a.from), to: rem.parseLocal(a.to) }),
  },
  {
    name: 'create_event',
    permission: 'تعديل_التقويم',
    declaration: {
      name: 'create_event',
      description: 'يسجّل موعداً جديداً في تقويم جوجل.',
      parameters: {
        type: 'object',
        properties: {
          title: { ...S, description: 'عنوان الموعد' },
          start: { ...S, description: 'وقت البداية بالتوقيت المحلي، صيغة YYYY-MM-DDTHH:mm' },
          end: { ...S, description: 'وقت النهاية (اختياري، الافتراضي ساعة)' },
          location: { ...S, description: 'المكان (اختياري)' },
          description: { ...S, description: 'تفاصيل إضافية (اختياري)' },
        },
        required: ['title', 'start'],
      },
    },
    run: async (a) => cal.createEvent({
      title: a.title,
      start: rem.parseLocal(a.start),
      end: a.end ? rem.parseLocal(a.end) : null,
      location: a.location,
      description: a.description,
    }),
  },
  {
    name: 'update_event',
    permission: 'تعديل_التقويم',
    declaration: {
      name: 'update_event',
      description: 'يعدّل موعداً موجوداً. جيب المعرّف من list_events أولاً.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { ...S, description: 'معرّف الموعد' },
          title: S,
          start: { ...S, description: 'صيغة YYYY-MM-DDTHH:mm' },
          end: S,
          location: S,
        },
        required: ['event_id'],
      },
    },
    run: async (a) => cal.updateEvent({
      eventId: a.event_id,
      title: a.title,
      start: a.start ? rem.parseLocal(a.start) : null,
      end: a.end ? rem.parseLocal(a.end) : null,
      location: a.location,
    }),
  },
  {
    name: 'delete_event',
    permission: 'تعديل_التقويم',
    declaration: {
      name: 'delete_event',
      description: 'يحذف موعداً من التقويم باستعمال معرّفه.',
      parameters: {
        type: 'object',
        properties: { event_id: S },
        required: ['event_id'],
      },
    },
    run: async (a) => cal.deleteEvent({ eventId: a.event_id }),
  },
  {
    name: 'create_reminder',
    permission: 'التذكيرات',
    declaration: {
      name: 'create_reminder',
      description: 'يسجّل تذكيراً يتبعث للمستخدم على الواتساب في الوقت المحدد بالضبط.',
      parameters: {
        type: 'object',
        properties: {
          text: { ...S, description: 'نص التذكير كما يقرأه المستخدم' },
          at: { ...S, description: 'وقت الإرسال بالتوقيت المحلي، صيغة YYYY-MM-DDTHH:mm' },
          repeat: {
            ...S,
            description: 'اختياري: تكرار التذكير',
            enum: ['daily', 'weekly', 'monthly'],
          },
        },
        required: ['text', 'at'],
      },
    },
    run: async (a, ctx) => rem.createReminder({
      phone: ctx.user.phone, text: a.text, at: a.at, repeat: a.repeat,
    }),
  },
  {
    name: 'list_reminders',
    permission: 'التذكيرات',
    declaration: {
      name: 'list_reminders',
      description: 'يعرض التذكيرات القادمة المسجلة للمستخدم.',
      parameters: { type: 'object', properties: {} },
    },
    run: async (_a, ctx) => rem.listReminders({ phone: ctx.user.phone }),
  },
  {
    name: 'cancel_reminder',
    permission: 'التذكيرات',
    declaration: {
      name: 'cancel_reminder',
      description: 'يلغي تذكيراً برقمه المعروض في list_reminders.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'integer', description: 'رقم التذكير' } },
        required: ['id'],
      },
    },
    run: async (a, ctx) => rem.cancelReminder({ phone: ctx.user.phone, id: a.id }),
  },
  {
    name: 'save_note',
    permission: null,
    declaration: {
      name: 'save_note',
      description: 'يحفظ معلومة يبي المستخدم يتذكّرها لاحقاً (رقم، عنوان، فكرة، كلمة سر مش حساسة).',
      parameters: {
        type: 'object',
        properties: { text: S },
        required: ['text'],
      },
    },
    run: async (a, ctx) => rem.saveNote({ phone: ctx.user.phone, text: a.text }),
  },
  {
    name: 'list_notes',
    permission: null,
    declaration: {
      name: 'list_notes',
      description: 'يعرض الملاحظات المحفوظة للمستخدم.',
      parameters: { type: 'object', properties: {} },
    },
    run: async (_a, ctx) => rem.listNotes({ phone: ctx.user.phone }),
  },
  {
    name: 'search_drive',
    permission: 'قراءة_درايف',
    declaration: {
      name: 'search_drive',
      description: 'يدوّر على ملفات في جوجل درايف بالاسم ويرجّع معرّفاتها.',
      parameters: {
        type: 'object',
        properties: { name: { ...S, description: 'جزء من اسم الملف' } },
        required: ['name'],
      },
    },
    run: async (a) => drv.searchFiles({ query: a.name }),
  },
  {
    name: 'send_drive_file',
    permission: 'قراءة_درايف',
    declaration: {
      name: 'send_drive_file',
      description: 'ينزّل ملفاً من درايف ويبعثه للمستخدم في الشات. جيب المعرّف من search_drive أولاً.',
      parameters: {
        type: 'object',
        properties: { file_id: { ...S, description: 'معرّف الملف في درايف' } },
        required: ['file_id'],
      },
    },
    run: async (a, ctx) => {
      const file = await drv.downloadFile({ fileId: a.file_id });
      // Queued, not sent here, so the agent loop controls ordering.
      ctx.attachments.push(file);
      return { الحالة: 'الملف جاهز وبيتبعث توا', الاسم: file.name };
    },
  },
];

export function declarationsFor(user) {
  return REGISTRY
    .filter((t) => !t.permission || can(user, t.permission))
    .map((t) => t.declaration);
}

export async function runTool(name, args, ctx) {
  const tool = REGISTRY.find((t) => t.name === name);
  if (!tool) return { خطأ: `أداة غير معروفة: ${name}` };
  if (tool.permission && !can(ctx.user, tool.permission)) {
    return { خطأ: 'الشخص هذا ما عندوش صلاحية للعملية هذي.' };
  }
  try {
    return await tool.run(args || {}, ctx);
  } catch (err) {
    return { خطأ: err?.message || String(err) };
  }
}

export { drv as driveTools };
