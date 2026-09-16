import type { Metadata } from 'next';
import { getPlatformSettings } from '@/lib/platform';
import { SettingsClient } from './settings-client';

export const metadata: Metadata = { title: 'إعدادات المنصة' };

export default async function AdminSettingsPage() {
  const settings = await getPlatformSettings();
  return <SettingsClient settings={settings} />;
}
