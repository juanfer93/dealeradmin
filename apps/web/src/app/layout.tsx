import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'dealerADMIN | Operator access',
  description: 'Secure operator console for lead routing.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
