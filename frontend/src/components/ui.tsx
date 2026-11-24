import React, { useState } from "react";
import { AlertCircle, Bell, CheckCheck, Loader2, Wifi, WifiOff, X } from "lucide-react";
import { useNotifications } from "../contexts/NotificationContext";
import { formatDateTime } from "../utils/format";

export function BrandLogo({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl p-1.5 ${
          light ? "bg-[#FDF2F8]" : "bg-[#FDF2F8] border border-brand-pinkBorder"
        } shadow-sm`}
      >
        <img
          src="/images/factorax-mark.png"
          alt="FactoraX"
          className="h-full w-full object-contain"
        />
      </div>
      {!compact && (
        <div className="leading-tight">
          <div
            className={`font-display text-base font-extrabold tracking-tight ${
              light ? "text-white" : "text-brand-purple"
            }`}
          >
            Factora<span className="text-brand-magenta">X</span>
          </div>
          <div className={`text-[10px] font-medium ${light ? "text-white/75" : "text-sf-muted"}`}>
            Order. Produce. Audit.
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  SUBMITTED: "bg-slate-100 text-slate-700 border-slate-200",
  PENDING_APPROVAL: "bg-amber-50 text-amber-800 border-amber-200",
  PENDING: "bg-amber-50 text-amber-800 border-amber-200",
  DRAFT: "bg-slate-100 text-slate-700 border-slate-200",
  APPROVED: "bg-blue-50 text-blue-700 border-blue-200",
  INVOICED: "bg-purple-50 text-brand-purple border-purple-200",
  PARTIAL: "bg-amber-50 text-amber-800 border-amber-200",
  DISPATCHED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CONFIRMED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  IN_STOCK: "bg-emerald-50 text-emerald-700 border-emerald-200",
  OK: "bg-emerald-50 text-emerald-700 border-emerald-200",
  LOW_STOCK: "bg-amber-50 text-amber-800 border-amber-200",
  OUT_OF_STOCK: "bg-red-50 text-red-700 border-red-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  FLAGGED: "bg-red-50 text-red-700 border-red-200",
  CANCELLED: "bg-red-50 text-red-700 border-red-200",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const key = (status || "").toUpperCase();
  const cls = STATUS_STYLES[key] || "bg-brand-pink text-brand-purple border-brand-pinkBorder";
  const text = label || key.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap ${cls}`}
    >
      {text}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  subtext,
  icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: React.ReactNode;
  tone?: "default" | "purple" | "magenta" | "success" | "warning" | "danger";
}) {
  const iconBg = {
    default: "bg-brand-pink text-brand-purple",
    purple: "bg-brand-purple text-white",
    magenta: "bg-brand-magenta text-white",
    success: "bg-emerald-50 text-sf-success",
    warning: "bg-amber-50 text-sf-warning",
    danger: "bg-red-50 text-sf-danger",
  }[tone];

  return (
    <div className="sf-card p-4 sm:p-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-sf-muted truncate">
          {label}
        </p>
        <p className="mt-1.5 font-display text-xl sm:text-2xl font-extrabold text-sf-text truncate">
          {value}
        </p>
        {subtext && <p className="mt-1 text-xs text-sf-muted truncate">{subtext}</p>}
      </div>
      {icon && (
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconBg}`}>
          {icon}
        </div>
      )}
    </div>
  );
}

export function LoadingState({ message = "Loading data..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-sf-muted">
      <Loader2 className="h-7 w-7 animate-spin text-brand-magenta" />
      <p className="mt-2.5 text-sm font-medium">{message}</p>
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800 flex items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        <AlertCircle className="h-5 w-5 shrink-0 text-sf-danger mt-0.5" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-red-700 border border-red-200 hover:bg-red-100"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-brand-purpleDark/50 p-0 sm:p-4 backdrop-blur-[1px]">
      <div
        className={`w-full ${
          wide ? "sm:max-w-3xl" : "sm:max-w-lg"
        } max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white shadow-elevated border border-sf-border overflow-hidden`}
      >
        <div className="flex items-center justify-between border-b border-sf-border px-5 py-3.5 bg-brand-pink/50">
          <h3 className="font-display text-base font-bold text-brand-purple">{title}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-sf-muted hover:bg-white hover:text-sf-text"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function NotificationBell({ light = false }: { light?: boolean }) {
  const { notifications, unreadCount, wsConnected, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative flex h-10 w-10 items-center justify-center rounded-xl transition ${
          light
            ? "bg-white/10 text-white hover:bg-white/20"
            : "border border-sf-border bg-white text-sf-text hover:bg-brand-pink"
        }`}
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand-magenta px-1 text-[10px] font-bold text-white shadow">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed right-3 left-3 sm:left-auto sm:absolute sm:right-0 top-16 sm:top-12 z-50 sm:w-96 rounded-2xl border border-sf-border bg-white shadow-elevated overflow-hidden">
            <div className="flex items-center justify-between border-b border-sf-border bg-brand-pink/60 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-brand-purple">Notifications</span>
                <span
                  title={wsConnected ? "Live WebSocket connected" : "Auto-sync active"}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    wsConnected
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {wsConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                  {wsConnected ? "Live" : "Sync"}
                </span>
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={() => markAllRead()}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-magenta hover:underline"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-sf-border">
              {notifications.length === 0 ? (
                <p className="p-6 text-center text-sm text-sf-muted">No notifications yet.</p>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => !n.is_read && markRead(n.id)}
                    className={`w-full text-left px-4 py-3 transition hover:bg-brand-pink/40 ${
                      !n.is_read ? "bg-brand-pink/30" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold text-sf-text">{n.title}</p>
                      {!n.is_read && (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-magenta" />
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-sf-muted line-clamp-2">{n.message}</p>
                    <p className="mt-1 text-[10px] text-sf-muted/80">
                      {formatDateTime(n.created_at)}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
