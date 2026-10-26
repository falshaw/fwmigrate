"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutGrid,
  List,
  Plus,
  Layers,
  ShieldCheck,
  Send,
  Menu,
  X,
  LogOut,
  Users,
  type LucideIcon,
} from "lucide-react";
import { LogoMark } from "@/components/AppBackground";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useRole } from "@/components/RoleContext";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (path: string) => boolean;
  /** Hidden for viewers (the page only creates data) */
  write?: boolean;
  adminOnly?: boolean;
};

const isProjectPage = (p: string) =>
  p.startsWith("/dashboard/projects") && p !== "/dashboard/projects/new";

const MAIN: NavItem[] = [
  {
    href: "/dashboard",
    label: "Overview",
    icon: LayoutGrid,
    match: (p) => p === "/dashboard",
  },
  {
    href: "/dashboard/projects",
    label: "Projects",
    icon: List,
    match: isProjectPage,
  },
  {
    href: "/dashboard/projects/new",
    label: "New migration",
    icon: Plus,
    match: (p) => p === "/dashboard/projects/new",
    write: true,
  },
  {
    href: "/dashboard/batch",
    label: "Batch",
    icon: Layers,
    match: (p) => p.startsWith("/dashboard/batch"),
  },
];

const TOOLS: NavItem[] = [
  {
    href: "/dashboard/validate",
    label: "Validation",
    icon: ShieldCheck,
    match: (p) => p.startsWith("/dashboard/validate"),
  },
  {
    href: "/dashboard/integrate",
    label: "Change manager",
    icon: Send,
    match: (p) => p.startsWith("/dashboard/integrate"),
  },
  {
    href: "/dashboard/users",
    label: "Users",
    icon: Users,
    match: (p) => p.startsWith("/dashboard/users"),
    adminOnly: true,
  },
];

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Admin",
  CONSULTANT: "Consultant",
  VIEWER: "Viewer (read only)",
};

function initials(name: string) {
  const parts = name.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const role = useRole();
  const visible = (item: NavItem) =>
    !(item.write && role === "VIEWER") && !(item.adminOnly && role !== "ADMIN");
  const render = (item: NavItem) => {
    const on = item.match(pathname);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        className={`side-link ${on ? "on" : ""}`}
        aria-current={on ? "page" : undefined}
      >
        <Icon aria-hidden />
        {item.label}
      </Link>
    );
  };
  return (
    <>
      {MAIN.filter(visible).map(render)}
      <div className="eyebrow mx-3 mt-3.5 mb-1">Tools</div>
      {TOOLS.filter(visible).map(render)}
    </>
  );
}

export function Sidebar({ name, email }: { name: string; email: string }) {
  const pathname = usePathname();
  const role = useRole();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const userBlock = (
    <div className="flex items-center gap-2.5 min-w-0">
      <span
        className="grid place-items-center w-8 h-8 rounded-full bg-accent text-white text-[11px] font-bold shrink-0"
        aria-hidden
      >
        {initials(name || email)}
      </span>
      <div className="min-w-0">
        <div className="font-semibold truncate">{name || email}</div>
        {name && (
          <div className="text-xs text-ink-65 truncate" title={email}>
            {email}
          </div>
        )}
        <div className="text-xs text-ink-45">{ROLE_LABEL[role] ?? role}</div>
      </div>
    </div>
  );

  const signOutButton = (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/login" })}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-65 hover:text-ink"
    >
      <LogOut className="w-3.5 h-3.5" aria-hidden />
      Sign out
    </button>
  );

  return (
    <>
      {/* Desktop: labelled glass sidebar */}
      <aside
        className="glass hidden lg:flex sticky top-7 w-[228px] shrink-0 flex-col gap-1 px-3.5 py-[18px] min-h-[calc(100vh-56px)]"
        aria-label="Main"
      >
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 font-bold text-base px-2 pt-0.5 pb-[18px]"
        >
          <LogoMark />
          <span>
            FW <span className="text-accent">Migrate</span>
          </span>
        </Link>
        <nav className="flex flex-col gap-1">
          <NavLinks pathname={pathname} />
        </nav>
        <div className="mt-auto border-t border-g-line pt-3.5 px-2 grid gap-3 text-[13px]">
          {userBlock}
          <div className="flex items-center justify-between gap-2">
            {signOutButton}
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Mobile and tablet: glass top bar with a drop-down menu */}
      <header className="glass lg:hidden w-full !rounded-[18px] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 font-bold text-[15px] mr-auto"
          >
            <LogoMark size={32} />
            <span>
              FW <span className="text-accent">Migrate</span>
            </span>
          </Link>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="theme-btn !px-2.5"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
          >
            {open ? <X aria-hidden /> : <Menu aria-hidden />}
          </button>
        </div>
        {open && (
          <div id="mobile-nav" className="mt-3 border-t border-g-line pt-3">
            <nav className="flex flex-col gap-1" aria-label="Main">
              <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            </nav>
            <div className="mt-3 border-t border-g-line pt-3 px-2 flex items-center justify-between gap-3 text-[13px]">
              {userBlock}
              {signOutButton}
            </div>
          </div>
        )}
      </header>
    </>
  );
}
