import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./components/ThemeProvider";
import ThemeToggle from "./components/ThemeToggle";
import AuthProvider from "./components/AuthProvider";
import UserNav from "./components/UserNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GroundworX",
  description: "Construction Intelligence Platform",
};

// Inline script that runs before React hydrates. Reads the persisted theme
// preference and adds the matching class to <html> immediately, so the user
// never sees a flash of the wrong theme on first paint.
const themeBootstrapScript = `
(function() {
  try {
    var stored = localStorage.getItem('construction-dashboard-theme');
    var theme = (stored === 'light' || stored === 'dark') ? stored : 'dark';
    var html = document.documentElement;
    html.classList.remove('light', 'dark');
    html.classList.add(theme);
    html.style.colorScheme = theme;
  } catch (e) {
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-white text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
        <AuthProvider>
          <ThemeProvider>
            <nav className="border-b border-gray-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="max-w-6xl mx-auto px-4 flex items-center gap-6 h-12">
                <span className="font-semibold text-sm tracking-tight text-gray-900 dark:text-zinc-100">
                  Groundwor<span className="text-emerald-500">X</span>
                </span>
                <Link
                  href="/bids"
                  className="text-sm text-gray-600 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Projects
                </Link>
                <Link
                  href="/subcontractors"
                  className="text-sm text-gray-600 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Subcontractors
                </Link>
                <Link
                  href="/outreach"
                  className="text-sm text-gray-600 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Outreach
                </Link>
                <Link
                  href="/reports"
                  className="text-sm text-gray-600 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Reports
                </Link>
                <Link
                  href="/settings"
                  className="ml-auto text-sm text-gray-600 hover:text-gray-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                >
                  Settings
                </Link>
                <UserNav />
                <ThemeToggle />
              </div>
            </nav>
            {children}
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
