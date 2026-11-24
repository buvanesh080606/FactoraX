import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  FileBarChart2,
  FileSpreadsheet,
  Lock,
  ReceiptText,
  Search,
  ShieldCheck,
} from "lucide-react";
import { api, downloadAuthenticatedFile, extractErrorMessage } from "../../api/client";
import { DesktopShell } from "../../components/DesktopShell";
import { ReportViewerPanel } from "../../components/ReportViewerPanel";
import { ErrorBanner, LoadingState, StatusBadge } from "../../components/ui";
import type { Invoice } from "../../types/erp";
import { formatDate, formatDateTime, formatINR, unwrapList } from "../../utils/format";

const ROLE_META: Record<
  string,
  { label: string; subtitle: string; badgeClass: string; headerBg: string }
> = {
  ADMIN: {
    label: "Admin & Billing",
    subtitle: "Orders, GST invoices, dispatch, inventory adjustments & payments",
    badgeClass: "bg-brand-purple text-white",
    headerBg: "bg-brand-purple/10 border-brand-purple/20",
  },
  PRODUCTION: {
    label: "Production & BOM",
    subtitle: "BOM edits, production runs, consumption & batch costing",
    badgeClass: "bg-brand-magenta text-white",
    headerBg: "bg-brand-pink/70 border-brand-pinkBorder",
  },
  SALESMAN: {
    label: "Salesman / Field Sales",
    subtitle: "Customer order capture & mobile storefront activity",
    badgeClass: "bg-blue-600 text-white",
    headerBg: "bg-blue-50 border-blue-200",
  },
  ACCOUNTANT: {
    label: "Accountant / Auditor",
    subtitle: "Read-only audit sessions, GST & financial report reviews",
    badgeClass: "bg-emerald-600 text-white",
    headerBg: "bg-emerald-50 border-emerald-200",
  },
  OWNER: {
    label: "Owner / Executive",
    subtitle: "Executive oversight, approvals & company settings",
    badgeClass: "bg-amber-600 text-white",
    headerBg: "bg-amber-50 border-amber-200",
  },
  SYSTEM: {
    label: "System / Automated",
    subtitle: "Background & unattributed system events",
    badgeClass: "bg-slate-600 text-white",
    headerBg: "bg-slate-100 border-slate-200",
  },
};

const ROLE_ORDER = ["ADMIN", "PRODUCTION", "SALESMAN", "ACCOUNTANT", "OWNER", "SYSTEM"];

export default function AccountantPortalPage() {
  const location = useLocation();
  const section = location.pathname.split("/")[2] || "dashboard";

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [auditLogs, setAuditLogs] = useState<
    Array<{
      id: number;
      user_name: string;
      user_role: string;
      action: string;
      entity_type: string;
      summary: string;
      created_at: string;
    }>
  >([]);
  const [selectedRole, setSelectedRole] = useState<string>("ALL");
  const [auditSearch, setAuditSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadExtras = useCallback(async () => {
    if (section !== "invoices" && section !== "audit-logs") return;
    setLoading(true);
    setError(null);
    try {
      if (section === "invoices") {
        const res = await api.get("/sales/invoices/", { params: { page_size: 100 } });
        setInvoices(unwrapList<Invoice>(res.data));
      } else {
        const res = await api.get("/auth/audit-logs/", { params: { page_size: 200 } });
        setAuditLogs(unwrapList(res.data));
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [section]);

  useEffect(() => {
    loadExtras();
  }, [loadExtras]);

  const normalizedLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return auditLogs
      .map((a) => ({
        ...a,
        roleKey: (a.user_role || "SYSTEM").toUpperCase(),
      }))
      .filter((a) => {
        if (!q) return true;
        return (
          (a.user_name || "").toLowerCase().includes(q) ||
          a.roleKey.toLowerCase().includes(q) ||
          (a.action || "").toLowerCase().includes(q) ||
          (a.entity_type || "").toLowerCase().includes(q) ||
          (a.summary || "").toLowerCase().includes(q)
        );
      });
  }, [auditLogs, auditSearch]);

  const logsByRole = useMemo(() => {
    const map: Record<string, typeof normalizedLogs> = {};
    for (const r of ROLE_ORDER) map[r] = [];
    for (const log of normalizedLogs) {
      const key = ROLE_META[log.roleKey] ? log.roleKey : "SYSTEM";
      map[key].push(log);
    }
    return map;
  }, [normalizedLogs]);

  const visibleRoleKeys = useMemo(() => {
    if (selectedRole !== "ALL") return [selectedRole];
    return ROLE_ORDER.filter((r) => (logsByRole[r]?.length || 0) > 0);
  }, [selectedRole, logsByRole]);

  const navItems = [
    { to: "/accountant/dashboard", label: "Audit Reports (13)", icon: <FileBarChart2 className="h-4 w-4" /> },
    { to: "/accountant/gst", label: "GST & Tax Summary", icon: <FileSpreadsheet className="h-4 w-4" /> },
    { to: "/accountant/invoices", label: "GST Invoices (PDF)", icon: <ReceiptText className="h-4 w-4" /> },
    { to: "/accountant/audit-logs", label: "System Audit Trail", icon: <ShieldCheck className="h-4 w-4" /> },
  ];

  return (
    <DesktopShell roleTitle="Accountant / Auditor (Read-Only)" navItems={navItems}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-brand-purple">
            {section === "invoices"
              ? "GST Tax Invoices (Read-Only)"
              : section === "audit-logs"
              ? "Immutable System Audit Trail"
              : section === "gst"
              ? "GST Outward Supply & Compliance"
              : "Accountant & Audit Reporting Hub"}
          </h1>
          <p className="text-sm text-sf-muted">
            All reports are queried directly from PostgreSQL operational records.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-pink border border-brand-pinkBorder px-3 py-1 text-xs font-bold text-brand-purple">
          <Lock className="h-3.5 w-3.5 text-brand-magenta" />
          Read-Only Audit Access
        </span>
      </div>

      {section === "dashboard" && <ReportViewerPanel initialReport="sales-register" />}
      {section === "gst" && <ReportViewerPanel initialReport="gst-summary" />}

      {section === "invoices" && (
        <div className="space-y-4">
          {error && <ErrorBanner message={error} onRetry={loadExtras} />}
          {loading ? (
            <LoadingState />
          ) : (
            <div className="sf-card overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                  <tr>
                    <th className="px-4 py-3 font-bold">Invoice No</th>
                    <th className="px-4 py-3 font-bold">Date</th>
                    <th className="px-4 py-3 font-bold">Customer</th>
                    <th className="px-4 py-3 font-bold">Supply</th>
                    <th className="px-4 py-3 font-bold">Taxable</th>
                    <th className="px-4 py-3 font-bold">GST</th>
                    <th className="px-4 py-3 font-bold">Total</th>
                    <th className="px-4 py-3 font-bold">Outstanding</th>
                    <th className="px-4 py-3 font-bold">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sf-border">
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-brand-pink/30">
                      <td className="px-4 py-3 font-bold text-brand-purple whitespace-nowrap">
                        {inv.invoice_number}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{inv.customer_name}</p>
                        <p className="text-[11px] text-sf-muted">
                          {inv.customer_state} · {inv.customer_gstin || "Unregistered"}
                        </p>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge
                          status={inv.is_inter_state ? "INVOICED" : "APPROVED"}
                          label={inv.is_inter_state ? "IGST" : "CGST+SGST"}
                        />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatINR(inv.taxable_total)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {inv.is_inter_state
                          ? formatINR(inv.igst_total)
                          : `${formatINR(inv.cgst_total)} + ${formatINR(inv.sgst_total)}`}
                      </td>
                      <td className="px-4 py-3 font-bold whitespace-nowrap">
                        {formatINR(inv.grand_total)}
                      </td>
                      <td className="px-4 py-3 font-bold text-brand-magenta whitespace-nowrap">
                        {formatINR(inv.outstanding_amount)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          onClick={() =>
                            downloadAuthenticatedFile(
                              `/sales/invoices/${inv.id}/pdf/`,
                              `${inv.invoice_number.replace(/\//g, "-")}.pdf`
                            )
                          }
                          className="sf-btn-secondary py-1 px-2.5 text-xs"
                        >
                          Download PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {section === "audit-logs" && (
        <div className="space-y-4">
          {error && <ErrorBanner message={error} onRetry={loadExtras} />}

          {/* Role Filter Tabs + Search Bar */}
          <div className="sf-card p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedRole("ALL")}
                  className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                    selectedRole === "ALL"
                      ? "bg-brand-purple text-white shadow-sm"
                      : "bg-sf-bg text-brand-purple hover:bg-brand-pink"
                  }`}
                >
                  All Roles Grouped ({normalizedLogs.length})
                </button>
                {ROLE_ORDER.filter((r) => r !== "SYSTEM" || (logsByRole.SYSTEM?.length || 0) > 0).map(
                  (roleKey) => {
                    const count = logsByRole[roleKey]?.length || 0;
                    const active = selectedRole === roleKey;
                    return (
                      <button
                        key={roleKey}
                        type="button"
                        onClick={() => setSelectedRole(roleKey)}
                        className={`rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                          active
                            ? "bg-brand-magenta text-white shadow-sm"
                            : "bg-sf-bg text-sf-text hover:bg-brand-pink"
                        }`}
                      >
                        {ROLE_META[roleKey].label.split(" ")[0]} ({count})
                      </button>
                    );
                  }
                )}
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="h-3.5 w-3.5 text-sf-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Search user, action, entity..."
                  className="sf-input pl-8 py-1.5 text-xs"
                />
              </div>
            </div>
          </div>

          {loading ? (
            <LoadingState />
          ) : visibleRoleKeys.length === 0 ? (
            <div className="sf-card p-8 text-center text-sm text-sf-muted">
              No audit entries match the current filter.
            </div>
          ) : (
            <div className="space-y-5">
              {visibleRoleKeys.map((roleKey) => {
                const meta = ROLE_META[roleKey] || ROLE_META.SYSTEM;
                const rows = logsByRole[roleKey] || [];
                return (
                  <div key={roleKey} className="sf-card overflow-hidden">
                    <div
                      className={`px-5 py-3.5 border-b flex flex-wrap items-center justify-between gap-2 ${meta.headerBg}`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold tracking-wide uppercase ${meta.badgeClass}`}
                        >
                          {roleKey}
                        </span>
                        <div>
                          <h2 className="font-display text-sm font-extrabold text-brand-purple leading-tight">
                            {meta.label}
                          </h2>
                          <p className="text-[11px] text-sf-muted">{meta.subtitle}</p>
                        </div>
                      </div>
                      <span className="rounded-full bg-white/90 border border-sf-border px-2.5 py-0.5 text-[11px] font-bold text-brand-purple">
                        {rows.length} {rows.length === 1 ? "entry" : "entries"}
                      </span>
                    </div>

                    {rows.length === 0 ? (
                      <p className="p-5 text-xs text-sf-muted">
                        No audit entries recorded for {meta.label} yet.
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-xs">
                          <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                            <tr>
                              <th className="px-4 py-2.5 font-bold">Timestamp</th>
                              <th className="px-4 py-2.5 font-bold">User</th>
                              <th className="px-4 py-2.5 font-bold">Action</th>
                              <th className="px-4 py-2.5 font-bold">Entity</th>
                              <th className="px-4 py-2.5 font-bold">Summary</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-sf-border">
                            {rows.map((a) => (
                              <tr key={a.id} className="hover:bg-brand-pink/30">
                                <td className="px-4 py-2.5 whitespace-nowrap text-sf-muted">
                                  {formatDateTime(a.created_at)}
                                </td>
                                <td className="px-4 py-2.5 whitespace-nowrap font-semibold text-brand-purple">
                                  {a.user_name || "System"}
                                </td>
                                <td className="px-4 py-2.5 whitespace-nowrap">
                                  <StatusBadge status="INVOICED" label={a.action} />
                                </td>
                                <td className="px-4 py-2.5 whitespace-nowrap">{a.entity_type}</td>
                                <td className="px-4 py-2.5">{a.summary}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </DesktopShell>
  );
}
