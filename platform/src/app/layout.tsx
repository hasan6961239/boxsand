import type { Metadata, Viewport } from 'next';
import { ToastProvider } from '@/components/ui/toast';
import { themeBootstrapScript } from '@/components/theme-toggle';
import { PLATFORM, siteUrl } from '@/lib/config';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${PLATFORM.name} — ${PLATFORM.tagline}`,
    template: `%s · ${PLATFORM.name}`,
  },
  description: PLATFORM.description,
  applicationName: PLATFORM.name,
  openGraph: {
    type: 'website',
    locale: 'ar_LY',
    siteName: PLATFORM.name,
    title: `${PLATFORM.name} — ${PLATFORM.tagline}`,
    description: PLATFORM.description,
  },
  twitter: { card: 'summary_large_image' },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: '/apple-icon.png',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBF9F6' },
    { media: '(prefers-color-scheme: dark)', color: '#131110' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only-focusable fixed top-3 start-3 z-[100] rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-fg shadow-lg"
        >
          تخطَّ إلى المحتوى
        </a>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
