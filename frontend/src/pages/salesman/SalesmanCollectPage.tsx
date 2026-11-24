import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle2, IndianRupee } from "lucide-react";
import { api, extractErrorMessage } from "../../api/client";
import { ErrorBanner, LoadingState, Modal } from "../../components/ui";
import { formatDate, formatINR } from "../../utils/format";
import { SalesmanShell } from "./SalesmanShell";

interface ReceivableInvoice {
  invoice_id: number;
  invoice_number: string;
  invoice_date: string;
  customer_id: number;
  customer_name: string;
  grand_total: string;
  paid_amount: string;
  outstanding_amount: string;
  age_days: number;
}

export default function SalesmanCollectPage() {
  const [invoices, setInvoices] = useState<ReceivableInvoice[]>([]);
  const [totalOutstanding, setTotalOutstanding] = useState("0.00");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeInv, setActiveInv] = useState<ReceivableInvoice | null>(null);
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState("UPI");
  const [refNo, setRefNo] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/sales/receivables/");
      setTotalOutstanding(res.data.total_outstanding || "0.00");
      setInvoices(res.data.invoices || []);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeInv) return;
    setSubmitting(true);
    setError(null);
    try {
      const key =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `pay-${Date.now()}`;
      const res = await api.post("/sales/payments/", {
        customer: activeInv.customer_id,
        invoice: activeInv.invoice_id,
        amount,
        payment_mode: mode,
        reference_number: refNo,
        notes,
        idempotency_key: key,
      });
      setSuccessMsg(
        `Recorded ${res.data.payment_number} (${formatINR(res.data.amount)}) for ${activeInv.customer_name}.`
      );
      setActiveInv(null);
      setAmount("");
      setRefNo("");
      setNotes("");
      load();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SalesmanShell>
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="sf-card px-5 py-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-display text-xl font-extrabold text-brand-purple">Collections &amp; Outstanding</h1>
            <p className="text-xs text-sf-muted">Record Cash, UPI, Bank Transfer, or Cheque payments against invoices</p>
          </div>
          <div className="rounded-xl bg-brand-pink px-3.5 py-2 text-right border border-brand-pinkBorder">
            <p className="text-[10px] font-bold uppercase text-sf-muted">Total Receivables</p>
            <p className="font-display text-lg font-extrabold text-brand-magenta">{formatINR(totalOutstanding)}</p>
          </div>
        </div>

      <div className="space-y-3.5">
        {successMsg && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {successMsg}
          </div>
        )}
        {error && <ErrorBanner message={error} onRetry={load} />}

        {loading ? (
          <LoadingState message="Loading outstanding invoices..." />
        ) : invoices.length === 0 ? (
          <div className="sf-card p-8 text-center text-sm text-sf-muted">
            All assigned customer invoices are fully settled!
          </div>
        ) : (
          <div className="space-y-3">
            {invoices.map((inv) => (
              <div key={inv.invoice_id} className="sf-card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-sm font-extrabold text-brand-purple">
                      {inv.invoice_number}
                    </p>
                    <p className="text-xs font-semibold text-sf-text">{inv.customer_name}</p>
                    <p className="text-[11px] text-sf-muted">
                      {formatDate(inv.invoice_date)} · {inv.age_days} day(s) old
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase text-sf-muted">Due</p>
                    <p className="font-display text-base font-extrabold text-brand-magenta">
                      {formatINR(inv.outstanding_amount)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-sf-muted border-t border-sf-border pt-2">
                  <span>Billed: {formatINR(inv.grand_total)}</span>
                  <span>Paid: {formatINR(inv.paid_amount)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setActiveInv(inv);
                    setAmount(inv.outstanding_amount);
                  }}
                  className="w-full sf-btn-primary py-2 text-xs"
                >
                  <IndianRupee className="h-3.5 w-3.5" />
                  Record Payment Collection
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>

      <Modal
        open={Boolean(activeInv)}
        onClose={() => setActiveInv(null)}
        title={activeInv ? `Collect — ${activeInv.invoice_number}` : "Collect Payment"}
      >
        {activeInv && (
          <form onSubmit={handleRecordPayment} className="space-y-3.5">
            <div className="rounded-xl bg-brand-pink/60 p-3 text-xs">
              <p className="font-bold text-brand-purple">{activeInv.customer_name}</p>
              <p className="text-sf-muted mt-0.5">
                Outstanding Balance: <strong>{formatINR(activeInv.outstanding_amount)}</strong>
              </p>
            </div>
            <div>
              <label className="sf-label">Amount Collected (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={activeInv.outstanding_amount}
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="sf-input"
              />
            </div>
            <div>
              <label className="sf-label">Payment Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="sf-input"
              >
                <option value="UPI">UPI</option>
                <option value="CASH">Cash</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
                <option value="CHEQUE">Cheque</option>
              </select>
            </div>
            <div>
              <label className="sf-label">Reference / UTR / Cheque No</label>
              <input
                type="text"
                value={refNo}
                onChange={(e) => setRefNo(e.target.value)}
                placeholder="e.g. UPI-REF-12345"
                className="sf-input"
              />
            </div>
            <div>
              <label className="sf-label">Remarks</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional note"
                className="sf-input"
              />
            </div>
            <button type="submit" disabled={submitting} className="w-full sf-btn-primary">
              {submitting ? "Saving..." : "Confirm Payment Entry"}
            </button>
          </form>
        )}
      </Modal>
    </SalesmanShell>
  );
}
