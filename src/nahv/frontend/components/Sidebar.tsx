'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Dashboard', icon: '◼' },
  { href: '/leads', label: 'Leads', icon: '◼' },
  { href: '/pipeline', label: 'Pipeline', icon: '◼' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-indigo-900 text-white flex flex-col shrink-0">
      <div className="px-6 py-6 border-b border-indigo-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-400 rounded-lg flex items-center justify-center text-sm font-bold">N</div>
          <div>
            <h1 className="text-base font-bold leading-tight">Nahv</h1>
            <p className="text-indigo-400 text-xs">Sales & Leads</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-indigo-700 text-white font-medium'
                  : 'text-indigo-300 hover:bg-indigo-800 hover:text-white'
              }`}
            >
              <span className={`w-2 h-2 rounded-sm ${active ? 'bg-indigo-300' : 'bg-indigo-600'}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-6 py-4 border-t border-indigo-800">
        <p className="text-indigo-500 text-xs">Nahv v1.0</p>
      </div>
    </aside>
  );
}
