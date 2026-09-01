import type { Metadata } from 'next';
import './globals.css';
import { LanguageProvider } from '../lib/i18n';

export const metadata: Metadata = {
  title: 'dealerADMIN | Operaciones de leads bajo control',
  description: 'Enrutamiento seguro de leads y flujo operativo para equipos de HighLevel.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body><LanguageProvider>{children}</LanguageProvider></body>
    </html>
  );
}
