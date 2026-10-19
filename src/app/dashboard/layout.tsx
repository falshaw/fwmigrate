import Link from "next/link";

const navItems = [
  { href: "/dashboard", label: "Projects" },
  { href: "/dashboard/batch", label: "Batch Migration" },
  { href: "/dashboard/validate", label: "Validation" },
  { href: "/dashboard/integrate", label: "Change Manager" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#0a1628]">
      <header className="border-b border-white/10 bg-[#0d1e36]">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link
              href="/dashboard"
              className="text-xl font-bold text-orange-500"
            >
              FW Migrate
            </Link>
            <nav className="flex gap-4">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm text-gray-400 hover:text-white transition"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <Link href="/dashboard/projects/new" className="btn-brand text-sm">
            New Migration
          </Link>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
