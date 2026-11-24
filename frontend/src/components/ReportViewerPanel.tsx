import React, { useCallback, useEffect, useState } from "react";
import { Download, FileSpreadsheet, FileText, Search } from "lucide-react";
import { api, downloadAuthenticatedFile, extractErrorMessage } from "../api/client";
import { ErrorBanner, LoadingState } from "./ui";

export const AUDIT_REPORTS = [
  { key: "sales-register", label: "Sales Register" },
  { key: "customer-sales", label: "Customer-wise Sales" },
  { key: "product-sales", label: "Product-wise Sales" },
  { key: "purchase-register", label: "Purchase Register" },
  { key: "gst-summary", label: "GST Outward Supply" },
  { key: "stock-summary", label: "Stock Summary" },
  { key: "stock-ledger", label: "Stock Ledger" },
  { key: "production-report", label: "Production Report" },
  { key: "consumption-variance", label: "Planned vs Actual" },
  { key: "yield-wastage", label: "Yield & Wastage" },
  { key: "payments", label: "Payments Register" },
  { key: "outstanding-ageing", label: "Outstanding Ageing" },
  { key: "product-costing", label: "Product Costing" },
];

interface ReportPayload {
  report_key: string;
  title: string;
  columns: Array<{ key: string; label: string }>;
  summary: Record<string, string | number>;
  count: number;
  page: number;
  page_size: number;
  results: Array<Record<string, string | number>>;
}

export function ReportViewerPanel({ initialReport = "sales-register" }: { initialReport?: string }) {
  const [reportKey, setReportKey] = useState(initialReport);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/reports/${reportKey}/`, {
        params: {
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
          search: search || undefined,
          page,
          page_size: 25,
        },
      });
      setData(res.data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [reportKey, dateFrom, dateTo, search, page]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const handleExport = async (fmt: "csv" | "xlsx" | "pdf") => {
    setExporting(fmt);
    try {
      const qs = new URLSearchParams({ format: fmt });
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);
      if (search) qs.set("search", search);
      await downloadAuthenticatedFile(
        `/reports/${reportKey}/export/?${qs.toString()}`,
        `${reportKey}.${fmt}`
      );
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setExporting(null);
    }
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1;

  return (
    <div className="space-y-4">
      {/* Report Selector Pills */}
      <div className="flex flex-wrap gap-1.5">
        {AUDIT_REPORTS.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => {
              setReportKey(r.key);
              setPage(1);
            }}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
              reportKey === r.key
                ? "bg-brand-purple text-white shadow-sm"
                : "bg-white border border-sf-border text-sf-text hover:bg-brand-pink"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Filters & Export Bar */}
      <div className="sf-card p-4 flex flex-col lg:flex-row lg:items-end justify-between gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 flex-1">
          <div>
            <label className="sf-label">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="sf-input py-2"
            />
          </div>
          <div>
            <label className="sf-label">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="sf-input py-2"
            />
          </div>
          <div>
            <label className="sf-label">Search</label>
            <div className="relative">
              <Search className="h-4 w-4 text-sf-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Filter rows..."
                className="sf-input py-2 pl-9"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={exporting !== null}
            onClick={() => handleExport("csv")}
            className="sf-btn-secondary py-2 text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            {exporting === "csv" ? "Exporting..." : "CSV"}
          </button>
          <button
            type="button"
            disabled={exporting !== null}
            onClick={() => handleExport("xlsx")}
            className="sf-btn-secondary py-2 text-xs"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-sf-success" />
            {exporting === "xlsx" ? "Exporting..." : "Excel"}
          </button>
          <button
            type="button"
            disabled={exporting !== null}
            onClick={() => handleExport("pdf")}
            className="sf-btn-purple py-2 text-xs"
          >
            <FileText className="h-3.5 w-3.5" />
            {exporting === "pdf" ? "Exporting..." : "PDF"}
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={loadReport} />}

      {loading ? (
        <LoadingState message="Generating report from PostgreSQL..." />
      ) : data ? (
        <div className="sf-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sf-border bg-brand-pink/50 px-5 py-3.5">
            <div>
              <h3 className="font-display text-base font-extrabold text-brand-purple">
                {data.title}
              </h3>
              <p className="text-xs text-sf-muted">{data.count} record(s)</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.summary || {}).map(([k, v]) => (
                <span
                  key={k}
                  className="rounded-lg bg-white border border-sf-border px-2.5 py-1 text-xs font-semibold text-brand-purple"
                >
                  {k.replace(/_/g, " ")}: <strong className="text-brand-magenta">{v}</strong>
                </span>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                <tr>
                  {data.columns.map((c) => (
                    <th key={c.key} className="px-4 py-3 font-bold whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-sf-border">
                {data.results.length === 0 ? (
                  <tr>
                    <td
                      colSpan={data.columns.length}
                      className="px-4 py-8 text-center text-sf-muted"
                    >
                      No records match your filters.
                    </td>
                  </tr>
                ) : (
                  data.results.map((row, idx) => (
                    <tr key={idx} className="hover:bg-brand-pink/30">
                      {data.columns.map((c) => (
                        <td key={c.key} className="px-4 py-2.5 whitespace-nowrap text-sf-text">
                          {String(row[c.key] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-sf-border px-4 py-3 text-xs">
              <span className="text-sf-muted">
                Page {data.page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="sf-btn-secondary py-1 px-3 text-xs"
                >
                  Previous
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="sf-btn-secondary py-1 px-3 text-xs"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
