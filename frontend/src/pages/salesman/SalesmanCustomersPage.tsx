import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Phone, ShoppingBag } from "lucide-react";
import { api, extractErrorMessage } from "../../api/client";
import { useCart } from "../../contexts/CartContext";
import { ErrorBanner, LoadingState } from "../../components/ui";
import type { Customer } from "../../types/erp";
import { formatINR, unwrapList } from "../../utils/format";
import { SalesmanShell } from "./SalesmanShell";

export default function SalesmanCustomersPage() {
  const navigate = useNavigate();
  const { setSelectedCustomer } = useCart();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/masters/customers/", { params: { search, page_size: 100 } });
      setCustomers(unwrapList<Customer>(res.data));
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SalesmanShell>
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="sf-card px-5 py-4">
          <h1 className="font-display text-xl font-extrabold text-brand-purple">Assigned Customers</h1>
          <p className="text-xs text-sf-muted">Select a store to start an order or review live outstanding balance</p>
        </div>

      <div className="space-y-3.5">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer, state, or GSTIN..."
          className="sf-input rounded-full"
        />

        {error && <ErrorBanner message={error} onRetry={load} />}
        {loading ? (
          <LoadingState message="Loading customers..." />
        ) : (
          <div className="space-y-3">
            {customers.map((c) => (
              <div key={c.id} className="sf-card p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-sm font-extrabold text-brand-purple">
                      {c.name}
                    </h3>
                    <p className="text-xs text-sf-muted">
                      {c.customer_type} · {c.state} · GSTIN: {c.gstin || "Unregistered"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] uppercase font-bold text-sf-muted">Outstanding</p>
                    <p className="text-sm font-extrabold text-brand-magenta">
                      {formatINR(c.outstanding_balance)}
                    </p>
                  </div>
                </div>
                {c.address && (
                  <p className="text-xs text-sf-muted flex items-start gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {c.address}
                  </p>
                )}
                {c.phone && (
                  <p className="text-xs text-sf-muted flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 shrink-0" />
                    {c.contact_person ? `${c.contact_person} · ` : ""}
                    {c.phone}
                  </p>
                )}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCustomer(c);
                      navigate("/salesman/home");
                    }}
                    className="w-full sf-btn-primary py-2 text-xs"
                  >
                    <ShoppingBag className="h-3.5 w-3.5" />
                    Start Order for {c.name}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </SalesmanShell>
  );
}
