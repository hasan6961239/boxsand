import { calendar } from '../google.js';
import { config } from '../config.js';

const calendarId = () => config.env.calendarId;
const tz = () => config.env.timezone;

function fmt(dateTime) {
  if (!dateTime) return '';
  const d = new Date(dateTime);
  return new Intl.DateTimeFormat('ar-LY', {
    timeZone: tz(),
    weekday: 'short', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

export async function listEvents({ from, to }) {
  const res = await calendar().events.list({
    calendarId: calendarId(),
    timeMin: new Date(from).toISOString(),
    timeMax: new Date(to).toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  });
  const items = res.data.items || [];
  if (!items.length) return { count: 0, events: [], نص: 'ما فماش مواعيد في الفترة هذي.' };
  return {
    count: items.length,
    events: items.map((e) => ({
      id: e.id,
      العنوان: e.summary || '(بدون عنوان)',
      الوقت: fmt(e.start?.dateTime || e.start?.date),
      البداية_iso: e.start?.dateTime || e.start?.date,
      المكان: e.location || '',
      الوصف: e.description || '',
    })),
  };
}

export async function createEvent({ title, start, end, description, location }) {
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date(startDate.getTime() + 60 * 60 * 1000);
  const res = await calendar().events.insert({
    calendarId: calendarId(),
    requestBody: {
      summary: title,
      description: description || '',
      location: location || '',
      start: { dateTime: startDate.toISOString(), timeZone: tz() },
      end: { dateTime: endDate.toISOString(), timeZone: tz() },
    },
  });
  return { id: res.data.id, العنوان: title, الوقت: fmt(startDate), الحالة: 'تم التسجيل' };
}

export async function updateEvent({ eventId, title, start, end, description, location }) {
  const body = {};
  if (title) body.summary = title;
  if (description !== undefined) body.description = description;
  if (location !== undefined) body.location = location;
  if (start) body.start = { dateTime: new Date(start).toISOString(), timeZone: tz() };
  if (end) body.end = { dateTime: new Date(end).toISOString(), timeZone: tz() };
  const res = await calendar().events.patch({ calendarId: calendarId(), eventId, requestBody: body });
  return {
    id: res.data.id,
    العنوان: res.data.summary,
    الوقت: fmt(res.data.start?.dateTime),
    الحالة: 'تم التعديل',
  };
}

export async function deleteEvent({ eventId }) {
  await calendar().events.delete({ calendarId: calendarId(), eventId });
  return { الحالة: 'تم الحذف' };
}
