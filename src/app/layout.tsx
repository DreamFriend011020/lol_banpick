import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LoL Tournament Draft & RoFS Ban/Pick',
  description: '실시간 LoL RoFS(Rule of First Selection) 및 5:5 토너먼트 드래프트 밴픽 웹 애플리케이션',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="antialiased bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  );
}

