import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { LogOut, Menu, Search, X } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import { BrandLogo, NotificationBell } from "./ui";

export interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
}

export function DesktopShell({
  roleTitle,
  navItems,
  children,
  onSearch,
}: {
  roleTitle: string;
  navItems: NavItem[];
  children: React.ReactNode;
  onSearch?: (q: string) => void;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [query, setQuery] = useState("");

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const navContent = (
    <div className="flex h-full flex-col bg-brand-purple text-white">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <BrandLogo light />
        <button
          onClick={() => setSidebarOpen(false)}
          className="lg:hidden rounded-lg p-1.5 text-white/80 hover:bg-white/10"
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="px-5 py-3 border-b border-white/10">
        <span className="inline-flex rounded-full bg-brand-magenta/25 border border-brand-magenta/40 px-2.5 py-0.5 text-[11px] font-semibold text-brand-pink">
          {roleTitle}
        </span>
      </div>
      <nav className="flex-1 overflow-y-auto no-scrollbar px-3 py-2.5 space-y-0.5">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                isActive
                  ? "bg-brand-magenta text-white shadow-sm"
                  : "text-white/80 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            <span className="shrink-0">{item.icon}</span>
            <span className="truncate">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4">
        <div className="mb-3 rounded-xl bg-white/5 px-3 py-2.5">
          <p className="text-xs font-bold text-white truncate">{user?.full_name}</p>
          <p className="text-[11px] text-white/70 truncate">{user?.email}</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-semibold text-white hover:bg-brand-magenta transition"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-sf-bg flex">
      {/* Desktop Fixed Full-Height Sidebar (Always 100% Top-to-Bottom, Never Leaves Bottom Gap) */}
      <aside className="hidden lg:block lg:fixed lg:inset-y-0 lg:left-0 lg:w-64 lg:z-40 bg-brand-purple">
        {navContent}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-72 max-w-[82vw] h-full shadow-elevated">{navContent}</div>
          <div
            className="flex-1 bg-brand-purpleDark/50 backdrop-blur-[1px]"
            onClick={() => setSidebarOpen(false)}
          />
        </div>
      )}

      {/* Main Content Column */}
      <div className="flex-1 min-w-0 lg:pl-64 flex flex-col min-h-screen bg-sf-bg">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-sf-border bg-[#FBE7F2]/95 backdrop-blur px-4 sm:px-6 h-16">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sf-border text-brand-purple hover:bg-brand-pink"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            {onSearch ? (
              <div className="relative max-w-md w-full hidden sm:block">
                <Search className="h-4 w-4 text-sf-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    onSearch(e.target.value);
                  }}
                  placeholder="Quick search..."
                  className="sf-input pl-10 py-2"
                />
              </div>
            ) : (
              <div className="min-w-0">
                <p className="font-display text-sm sm:text-base font-bold text-brand-purple truncate">
                  {roleTitle}
                </p>
                <p className="text-[11px] text-sf-muted hidden sm:block">
                  One System. Every Role. Complete Control.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <NotificationBell />
            <div className="hidden sm:flex items-center gap-2.5 rounded-xl border border-sf-border bg-brand-pink/40 px-3 py-1.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-purple text-xs font-bold text-white">
                {(user?.full_name || "U").slice(0, 1).toUpperCase()}
              </div>
              <div className="leading-tight">
                <p className="text-xs font-bold text-sf-text">{user?.full_name}</p>
                <p className="text-[10px] font-semibold text-brand-magenta">{user?.role}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
