import React, { useCallback, useEffect, useState } from "react";
import { CloudOff, RefreshCw, Trash2 } from "lucide-react";
import { api, extractErrorMessage } from "../../api/client";
import { useCart } from "../../contexts/CartContext";
import { ErrorBanner, LoadingState, Modal, StatusBadge } from "../../components/ui";
import type { SalesOrder } from "../../types/erp";
import { formatDate, formatDateTime, formatINR, formatQty, unwrapList } from "../../utils/format";
import { SalesmanShell } from "./SalesmanShell";

const STATUS_TABS = [
  { key: "ALL", label: "All" },
  { key: "PENDING_APPROVAL", label: "Pending Approval" },
  { key: "APPROVED", label: "Approved" },
  { key: "INVOICED", label: "Invoiced" },
  { key: "DISPATCHED", label: "Dispatched" },
  { key: "REJECTED", label: "Rejected" },
];

export default function SalesmanOrdersPage() {
  const { offlineQueue, syncOfflineOrders, removeOfflineOrder, isOnline } = useCart();
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customerSales, setCustomerSales] = useState<
    Array<{
      customer_id: number;
      customer_name: string;
      customer_state: string;
      order_count: number;
      ordered_total: string;
      invoiced_total: string;
      outstanding: string;
    }>
  >([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<SalesOrder | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { page_size: 100 };
      if (statusFilter !== "ALL") params.status = statusFilter;
      const [res, dashRes] = await Promise.all([
        api.get("/sales/orders/", { params }),
        api.get("/reports/dashboard/salesman/"),
      ]);
      setOrders(unwrapList<SalesOrder>(res.data));
      setCustomerSales(dashRes.data?.customer_sales || []);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    const res = await syncOfflineOrders();
    setSyncing(false);
    setSyncMsg(`Synced ${res.synced} order(s)${res.failed ? `, ${res.failed} failed` : ""}.`);
    loadOrders();
  };

  return (
    <SalesmanShell>
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="sf-card px-5 py-4">
          <h1 className="font-display text-xl font-extrabold text-brand-purple">My Orders</h1>
          <p className="text-xs text-sf-muted">Live factory approval, GST invoice &amp; dispatch tracking</p>
        </div>

      <div className="space-y-4">
        {/* Offline Queue */}
        {offlineQueue.length > 0 && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-extrabold text-amber-900">
                <CloudOff className="h-4 w-4" />
                Queued Offline ({offlineQueue.length}) — Not Submitted Yet
              </div>
              <button
                type="button"
                disabled={!isOnline || syncing}
                onClick={handleSync}
                className="inline-flex items-center gap-1 rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                Sync Now
              </button>
            </div>
            {offlineQueue.map((q) => (
              <div
                key={q.idempotency_key}
                className="rounded-xl bg-white p-3 border border-amber-200 flex items-center justify-between gap-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-bold text-sf-text truncate">{q.customer_name}</p>
                  <p className="text-sf-muted">
                    {q.items.length} item(s) · Est. {formatINR(q.estimated_total)}
                  </p>
                  {q.last_error && <p className="text-sf-danger mt-0.5">{q.last_error}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => removeOfflineOrder(q.idempotency_key)}
                  className="p-1.5 text-sf-danger"
                  aria-label="Discard queued order"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {syncMsg && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-semibold text-emerald-800">
            {syncMsg}
          </div>
        )}

        {/* Customer-wise Sales Summary for Salesman (PDF Sec 4.1) */}
        {customerSales.length > 0 && (
          <div className="sf-card overflow-hidden">
            <div className="px-4 py-3 border-b border-sf-border bg-brand-pink/50 font-display text-sm font-extrabold text-brand-purple">
              My Customer-wise Sales Summary
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                  <tr>
                    <th className="px-4 py-2.5 font-bold">Customer</th>
                    <th className="px-4 py-2.5 font-bold">Orders</th>
                    <th className="px-4 py-2.5 font-bold">Ordered Value</th>
                    <th className="px-4 py-2.5 font-bold">Invoiced Sales</th>
                    <th className="px-4 py-2.5 font-bold">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sf-border">
                  {customerSales.map((cs) => (
                    <tr key={cs.customer_id}>
                      <td className="px-4 py-2.5 font-bold text-brand-purple">
                        {cs.customer_name}{" "}
                        <span className="font-normal text-sf-muted">({cs.customer_state})</span>
                      </td>
                      <td className="px-4 py-2.5">{cs.order_count}</td>
                      <td className="px-4 py-2.5 font-semibold">{formatINR(cs.ordered_total)}</td>
                      <td className="px-4 py-2.5 font-bold text-sf-success">{formatINR(cs.invoiced_total)}</td>
                      <td className="px-4 py-2.5 font-bold text-brand-magenta">{formatINR(cs.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Status Filter Pills */}
        <div className="-mx-4 px-4 overflow-x-auto no-scrollbar">
          <div className="flex gap-2 w-max pb-1">
            {STATUS_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setStatusFilter(t.key)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold whitespace-nowrap transition ${
                  statusFilter === t.key
                    ? "bg-brand-purple text-white"
                    : "bg-white text-sf-text border border-sf-border"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {error && <ErrorBanner message={error} onRetry={loadOrders} />}
        {loading ? (
          <LoadingState message="Loading orders..." />
        ) : orders.length === 0 ? (
          <div className="sf-card p-8 text-center text-sm text-sf-muted">
            No orders found for this status.
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((ord) => (
              <button
                key={ord.id}
                type="button"
                onClick={() => setSelectedOrder(ord)}
                className="w-full sf-card p-4 text-left hover:border-brand-magenta transition"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-sm font-extrabold text-brand-purple">
                    {ord.order_number}
                  </span>
                  <StatusBadge status={ord.status} />
                </div>
                <p className="mt-1 text-sm font-semibold text-sf-text">{ord.customer_name}</p>
                <div className="mt-2 flex items-center justify-between text-xs text-sf-muted">
                  <span>
                    {formatDate(ord.order_date)} · {ord.items.length} line(s) ({formatQty(ord.total_quantity)} units)
                  </span>
                  <span className="font-extrabold text-brand-magenta text-sm">
                    {formatINR(ord.grand_total)}
                  </span>
                </div>
                {ord.invoice_number && (
                  <p className="mt-1.5 text-[11px] font-semibold text-brand-purple">
                    Invoice: {ord.invoice_number}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      </div>

      {/* Order Detail & Status History Modal */}
      <Modal
        open={Boolean(selectedOrder)}
        onClose={() => setSelectedOrder(null)}
        title={selectedOrder ? `Order ${selectedOrder.order_number}` : "Order Details"}
      >
        {selectedOrder && (
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-brand-purple">{selectedOrder.customer_name}</p>
                <p className="text-sf-muted">{selectedOrder.customer_state}</p>
              </div>
              <StatusBadge status={selectedOrder.status} />
            </div>

            {selectedOrder.rejection_reason && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-800">
                <strong>Rejection Reason:</strong> {selectedOrder.rejection_reason}
              </div>
            )}

            <div className="rounded-xl border border-sf-border divide-y divide-sf-border">
              {selectedOrder.items.map((i) => (
                <div key={i.id} className="p-3 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-sf-text">
                      {i.product_name} ({i.pack_size})
                    </p>
                    <p className="text-sf-muted">
                      {formatQty(i.quantity)} × {formatINR(i.unit_price)} (+{Number(i.gst_rate)}% GST)
                    </p>
                  </div>
                  <span className="font-bold text-brand-purple">{formatINR(i.line_total)}</span>
                </div>
              ))}
              <div className="p-3 flex justify-between bg-brand-pink/50 font-extrabold text-sm text-brand-purple">
                <span>Grand Total</span>
                <span>{formatINR(selectedOrder.grand_total)}</span>
              </div>
            </div>

            <div>
              <p className="font-bold uppercase text-sf-muted mb-2">Status Timeline</p>
              <div className="space-y-2 border-l-2 border-brand-magenta/30 pl-3">
                {selectedOrder.status_history.map((h) => (
                  <div key={h.id}>
                    <p className="font-bold text-sf-text">
                      {h.to_status.replace(/_/g, " ")} ·{" "}
                      <span className="font-normal text-sf-muted">{h.changed_by_name}</span>
                    </p>
                    {h.remarks && <p className="text-sf-muted">{h.remarks}</p>}
                    <p className="text-[10px] text-sf-muted/80">{formatDateTime(h.created_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </SalesmanShell>
  );
}
