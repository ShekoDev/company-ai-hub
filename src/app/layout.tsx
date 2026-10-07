import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Company AI Hub',
  description: 'بوابة الذكاء الاصطناعي الموحّدة للشركة',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
