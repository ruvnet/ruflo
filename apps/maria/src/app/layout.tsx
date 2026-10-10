import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import './globals.css';

export const metadata: Metadata = {
  title: 'MarIA',
  description: 'Agent OS — pilotage de missions Claude Code et Ruflo',
};

const THEME_SCRIPT = `try{var t=localStorage.getItem('maria.theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={GeistSans.variable} data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Applique le thème choisi avant le premier affichage (évite un flash du mauvais thème). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
