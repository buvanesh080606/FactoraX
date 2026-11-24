import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  Minus,
  Plus,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { api, extractErrorMessage } from "../../api/client";
import { useCart } from "../../contexts/CartContext";
import { ErrorBanner, Modal } from "../../components/ui";
import type { Customer, SalesOrder } from "../../types/erp";
import { formatINR, formatQty, unwrapList } from "../../utils/format";
import { SalesmanShell } from "./SalesmanShell";

export default function SalesmanCartPage() {
  const navigate = useNavigate();
  const {
    selectedCustomer,
    setSelectedCustomer,
    items,
    updateQty,
    removeItem,
    clearCart,
    subtotal,
    gstEstimate,
    grandTotal,
    isOnline,
    enqueueOfflineOrder,
  } = useCart();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<SalesOrder | null>(null);
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);

  const loadCustomers = useCallback(async () => {
    try {
      const res = await api.get("/masters/customers/", { params: { page_size: 100 } });
      const list = unwrapList<Customer>(res.data);
      setCustomers(list);
      if (!selectedCustomer && list.length > 0) setSelectedCustomer(list[0]);
    } catch {
      // keep existing selection if offline
    }
  }, [selectedCustomer, setSelectedCustomer]);

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  const overStockItems = items.filter(
    (i) => i.quantity > Number(i.product.available_stock)
  );

  const handleSubmitOrder = async () => {
    setError(null);
    if (!selectedCustomer) {
      setError("Please select a customer before submitting.");
      return;
    }
    if (items.length === 0) {
      setError("Your cart is empty.");
      return;
    }

    if (!isOnline) {
      const queued = enqueueOfflineOrder(deliveryNotes);
      setDeliveryNotes("");
      setQueuedNotice(
        `Saved offline (${queued.idempotency_key.slice(0, 8)}). It is NOT submitted to the factory yet — tap Sync when online.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `sf-${Date.now()}`;
      const res = await api.post("/sales/orders/", {
        customer: selectedCustomer.id,
        delivery_notes: deliveryNotes,
        idempotency_key: idempotencyKey,
        items: items.map((i) => ({
          product: i.product.id,
          quantity: i.quantity,
        })),
      });
      setConfirmedOrder(res.data);
      clearCart();
      setDeliveryNotes("");
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SalesmanShell>
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="sf-card px-5 py-4 bg-white flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="font-display text-xl font-extrabold text-brand-purple">Order Cart &amp; Checkout</h1>
            <p className="text-xs text-sf-muted">Review items, verify live factory stock, and submit to billing desk</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/salesman/home")}
            className="sf-btn-secondary py-1.5 text-xs"
          >
            + Add More Products
          </button>
        </div>

      <div className="space-y-4">
        {error && <ErrorBanner message={error} />}

        {queuedNotice && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 space-y-2">
            <div className="flex items-center gap-2 font-bold">
              <CloudOff className="h-4 w-4 text-amber-700" />
              Queued Offline (Pending Sync)
            </div>
            <p>{queuedNotice}</p>
            <button
              onClick={() => navigate("/salesman/orders")}
              className="sf-btn-secondary py-1.5 text-xs"
            >
              View Offline Queue
            </button>
          </div>
        )}

        {/* Customer selector */}
        <div className="sf-card p-4">
          <label className="sf-label" htmlFor="cart-customer">
            Selected Customer
          </label>
          <select
            id="cart-customer"
            value={selectedCustomer?.id ?? ""}
            onChange={(e) => {
              const found = customers.find((c) => c.id === Number(e.target.value)) || null;
              setSelectedCustomer(found);
            }}
            className="sf-input"
          >
            <option value="">-- Choose customer --</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.state} · {c.customer_type})
              </option>
            ))}
          </select>
          {selectedCustomer && (
            <div className="mt-2.5 rounded-xl bg-brand-pink/60 p-3 text-xs text-sf-muted space-y-0.5">
              <p className="font-bold text-brand-purple">{selectedCustomer.name}</p>
              <p>
                {selectedCustomer.state} · GSTIN: {selectedCustomer.gstin || "Unregistered"}
              </p>
              <p>{selectedCustomer.address}</p>
            </div>
          )}
        </div>

        {/* Cart items */}
        {items.length === 0 ? (
          <div className="sf-card p-8 text-center">
            <ShoppingCart className="h-10 w-10 text-sf-muted/50 mx-auto" />
            <p className="mt-3 text-sm font-bold text-sf-text">Your order cart is empty</p>
            <p className="mt-1 text-xs text-sf-muted">Add products from the catalog to build an order.</p>
            <button
              onClick={() => navigate("/salesman/home")}
              className="mt-4 sf-btn-primary text-xs"
            >
              Browse Products
            </button>
          </div>
        ) : (
          <>
            {overStockItems.length > 0 && (
              <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <strong>Stock warning:</strong>{" "}
                  {overStockItems
                    .map(
                      (i) =>
                        `${i.product.name} (requested ${i.quantity}, available ${formatQty(
                          i.product.available_stock
                        )})`
                    )
                    .join(", ")}
                  . You may still submit, but Admin will require production stock before approval.
                </div>
              </div>
            )}

            <div className="sf-card divide-y divide-sf-border">
              {items.map((item) => (
                <div key={item.product.id} className="p-3.5 flex items-center gap-3">
                  <img
                    src={item.product.image_url || "/products/murukku.jpg"}
                    alt={item.product.name}
                    className="h-14 w-14 rounded-xl bg-brand-pink p-1.5 object-contain shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-sf-text truncate">{item.product.name}</p>
                    <p className="text-xs text-sf-muted">
                      {item.product.pack_size} · {formatINR(item.product.selling_price)} +{" "}
                      {Number(item.product.gst_rate)}% GST
                    </p>
                    <p className="text-[11px] text-sf-muted">
                      Available: {formatQty(item.product.available_stock)} {item.product.unit_symbol}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <div className="flex items-center gap-1.5 rounded-xl border border-sf-border bg-sf-bg p-1">
                      <button
                        type="button"
                        onClick={() => updateQty(item.product.id, item.quantity - 1)}
                        className="h-7 w-7 flex items-center justify-center rounded-lg bg-white text-brand-purple"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={item.quantity}
                        onChange={(e) =>
                          updateQty(item.product.id, Math.max(1, Number(e.target.value) || 1))
                        }
                        className="w-12 text-center text-xs font-bold bg-transparent focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => updateQty(item.product.id, item.quantity + 1)}
                        className="h-7 w-7 flex items-center justify-center rounded-lg bg-brand-magenta text-white"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(item.product.id)}
                      className="inline-flex items-center gap-1 text-[11px] text-sf-danger hover:underline"
                    >
                      <Trash2 className="h-3 w-3" /> Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Delivery Notes */}
            <div className="sf-card p-4">
              <label className="sf-label" htmlFor="delivery-notes">
                Delivery Notes
              </label>
              <textarea
                id="delivery-notes"
                rows={2}
                value={deliveryNotes}
                onChange={(e) => setDeliveryNotes(e.target.value)}
                placeholder="Shop timing, landmark, preferred transport..."
                className="sf-input"
              />
            </div>

            {/* Totals & Submit */}
            <div className="sf-card p-4 space-y-2 text-sm">
              <div className="flex justify-between text-sf-muted">
                <span>Subtotal</span>
                <span className="font-semibold text-sf-text">{formatINR(subtotal)}</span>
              </div>
              <div className="flex justify-between text-sf-muted">
                <span>GST Estimate (5%)</span>
                <span className="font-semibold text-sf-text">{formatINR(gstEstimate)}</span>
              </div>
              <div className="flex justify-between border-t border-sf-border pt-2.5 text-base font-extrabold text-brand-purple">
                <span>Grand Total</span>
                <span>{formatINR(grandTotal)}</span>
              </div>

              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmitOrder}
                className="mt-3 w-full sf-btn-primary py-3.5 text-sm"
              >
                {submitting
                  ? "Submitting to Factory..."
                  : isOnline
                  ? "Submit Order to Factory"
                  : "Save Order Offline (Sync Later)"}
              </button>
            </div>
          </>
        )}
      </div>
      </div>

      {/* Real API Order Confirmation Modal */}
      <Modal
        open={Boolean(confirmedOrder)}
        onClose={() => setConfirmedOrder(null)}
        title="Order Submitted to Factory"
      >
        {confirmedOrder && (
          <div className="space-y-4">
            <div className="flex flex-col items-center text-center py-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-sf-success">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h4 className="mt-2 font-display text-lg font-extrabold text-brand-purple">
                {confirmedOrder.order_number}
              </h4>
              <p className="text-xs text-sf-muted mt-1">
                Confirmed in FactoraX database & sent to Admin for approval.
              </p>
            </div>
            <div className="rounded-xl bg-brand-pink/60 p-3.5 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-sf-muted">Customer</span>
                <span className="font-bold text-sf-text">{confirmedOrder.customer_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sf-muted">Status</span>
                <span className="font-bold text-brand-purple">{confirmedOrder.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sf-muted">Grand Total</span>
                <span className="font-bold text-brand-magenta">
                  {formatINR(confirmedOrder.grand_total)}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setConfirmedOrder(null);
                  navigate("/salesman/orders");
                }}
                className="flex-1 sf-btn-purple text-xs"
              >
                Track My Orders
              </button>
              <button
                onClick={() => {
                  setConfirmedOrder(null);
                  navigate("/salesman/home");
                }}
                className="flex-1 sf-btn-secondary text-xs"
              >
                Continue Shopping
              </button>
            </div>
          </div>
        )}
      </Modal>
    </SalesmanShell>
  );
}
