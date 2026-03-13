import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MeshSearch Dashboard',
  description: 'Private Web Search for AI Agents — Relay network status, payment flows, and encrypted search history',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <nav className="border-b border-gray-200 dark:border-gray-800 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-mesh-600">MeshSearch</span>
              <span className="text-sm text-gray-500">Dashboard</span>
            </div>
            <div className="flex gap-6 text-sm">
              <a href="/" className="hover:text-mesh-600 transition-colors">Network</a>
              <a href="/history" className="hover:text-mesh-600 transition-colors">History</a>
              <a href="/payments" className="hover:text-mesh-600 transition-colors">Payments</a>
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-6 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
