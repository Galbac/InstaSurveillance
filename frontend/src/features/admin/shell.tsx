"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAdminAuth } from "./auth-context";
import { RoleBadge, InstagramIcon } from "./components/badges";
import {
  LayoutDashboard,
  Users,
  Activity,
  LifeBuoy,
  History,
  Sliders,
  Server,
  Clock,
  Menu,
  X,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Обзор", icon: <LayoutDashboard className="w-4 h-4" /> },
  { href: "/admin/users", label: "Пользователи", icon: <Users className="w-4 h-4" /> },
  { href: "/admin/profiles", label: "Instagram-профили", icon: <InstagramIcon className="w-4 h-4" /> },
  { href: "/admin/jobs", label: "Задания", icon: <Activity className="w-4 h-4" /> },
  { href: "/admin/support", label: "Обращения", icon: <LifeBuoy className="w-4 h-4" /> },
  { href: "/admin/audit", label: "Аудит", icon: <History className="w-4 h-4" />, adminOnly: true },
  { href: "/admin/limits", label: "Ограничения", icon: <Sliders className="w-4 h-4" />, adminOnly: true },
  { href: "/admin/system", label: "Система и диски", icon: <Server className="w-4 h-4" />, adminOnly: true },
];

function formatCountdown(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status, role, isAdmin, secondsRemaining, isPrivileged, openMfaModal } = useAdminAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const visibleNav = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  const getBreadcrumbs = () => {
    const parts = pathname.split("/").filter(Boolean);
    const crumbs = [{ label: "Админка", href: "/admin" }];

    if (parts.length > 1) {
      const section = parts[1];
      const nav = NAV_ITEMS.find((n) => n.href === `/admin/${section}`);
      if (nav) {
        crumbs.push({ label: nav.label, href: nav.href });
      } else {
        crumbs.push({ label: section, href: `/admin/${section}` });
      }
    }
    if (parts.length > 2) {
      crumbs.push({ label: "Карточка", href: pathname });
    }
    return crumbs;
  };

  const timerColor =
    secondsRemaining !== null && secondsRemaining <= 60
      ? "bg-rose-50 text-rose-700 border-rose-200 animate-pulse"
      : secondsRemaining !== null && secondsRemaining <= 180
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-purple-50 text-purple-700 border-purple-200";

  return (
    <div className="min-h-screen bg-slate-50/60 flex flex-col md:flex-row text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-slate-200/90 shrink-0 sticky top-0 h-screen z-30">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <Link href="/admin" className="flex items-center gap-2.5 font-bold text-base text-slate-900">
            <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center font-black text-sm shadow-sm">
              IS
            </div>
            <span>InstaSurveillance</span>
          </Link>
        </div>

        <div className="px-3 py-4 flex-1 overflow-y-auto space-y-1">
          <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Панель управления
          </div>
          {visibleNav.map((item) => {
            const active =
              item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? "bg-purple-600 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="truncate min-w-0">
              <p className="text-xs font-semibold text-slate-800 truncate">{status?.email || "Оператор"}</p>
              <div className="mt-0.5">
                <RoleBadge role={role || "operator"} />
              </div>
            </div>
          </div>

          <Link
            href="/app"
            className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-slate-600 hover:text-purple-700 bg-white hover:bg-purple-50 rounded-xl border border-slate-200 transition-colors"
          >
            <span>В кабинет</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-200/80 z-20 px-4 md:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="md:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
              aria-label="Открыть меню"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Breadcrumbs */}
            <nav className="flex items-center gap-1.5 text-xs text-slate-500 overflow-hidden" aria-label="Хлебные крошки">
              {getBreadcrumbs().map((crumb, idx, arr) => (
                <React.Fragment key={crumb.href}>
                  {idx > 0 && <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />}
                  {idx === arr.length - 1 ? (
                    <span className="font-semibold text-slate-800 truncate">{crumb.label}</span>
                  ) : (
                    <Link href={crumb.href} className="hover:text-purple-600 truncate">
                      {crumb.label}
                    </Link>
                  )}
                </React.Fragment>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {/* MFA Timer Pill */}
            <button
              type="button"
              onClick={openMfaModal}
              title={
                isPrivileged
                  ? `MFA действует ещё ${formatCountdown(secondsRemaining)}. Нажмите для продления`
                  : "MFA не активно. Нажмите для подтверждения"
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${timerColor}`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>
                {isPrivileged ? `MFA: ${formatCountdown(secondsRemaining)}` : "MFA неактивно"}
              </span>
            </button>

            <Link
              href="/app"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 hover:text-purple-700 bg-slate-100 hover:bg-purple-50 transition-colors"
            >
              <span>В кабинет</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 md:p-8 max-w-7xl w-full mx-auto">{children}</main>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-72 bg-white shadow-2xl flex flex-col z-10 p-5">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
              <span className="font-bold text-base text-slate-900">InstaSurveillance Admin</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 space-y-1 overflow-y-auto">
              {visibleNav.map((item) => {
                const active =
                  item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium ${
                      active
                        ? "bg-purple-600 text-white font-semibold"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>

            <div className="pt-4 border-t border-slate-100 space-y-3">
              <div className="text-xs text-slate-600 font-medium">{status?.email}</div>
              <Link
                href="/app"
                className="flex items-center justify-center gap-2 w-full py-2.5 text-xs font-semibold text-purple-700 bg-purple-50 rounded-xl"
              >
                В кабинет пользователя
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
