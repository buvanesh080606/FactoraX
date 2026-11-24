import React, { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  AlertTriangle,
  Boxes,
  Factory,
  FileBarChart2,
  IndianRupee,
  LayoutDashboard,
  Package,
  ShoppingBag,
  TrendingUp,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, extractErrorMessage } from "../../api/client";
import { DesktopShell } from "../../components/DesktopShell";
import { ReportViewerPanel } from "../../components/ReportViewerPanel";
import { ErrorBanner, KpiCard, LoadingState, StatusBadge } from "../../components/ui";
import { formatDate, formatINR, formatQty } from "../../utils/format";

interface OwnerDashboardData {
  kpis: {
    revenue: string;
    total_sales: string;
    orders_today: number;
    sales_today: string;
    number_of_orders: number;
    pending_orders: number;
    finished_goods_value: string;
    raw_material_value: string;
    production_output: string;
    yield_variance_pct: string;
    cost_per_packet: string;
    customer_outstanding: string;
    collections: string;
    low_stock_count: number;
    variance_alerts_count: number;
  };
  charts: {
    monthly_sales: Array<{ month: string; revenue: number; taxable: number }>;
    product_sales: Array<{ product: string; revenue: number; quantity: number }>;
    production_trend: Array<{ label: string; expected: number; actual: number; cost_per_packet: number }>;
    inventory_distribution: Array<{ name: string; value: number }>;
    collections_vs_outstanding: Array<{ name: string; amount: number }>;
  };
  variance_alerts: Array<{
    id: string;
    alert_type: "YIELD" | "MATERIAL";
    run_number: string;
    run_date: string;
    product_name: string;
    item_label: string;
    planned_qty: string;
    actual_qty: string;
    unit_symbol: string;
    variance_pct: string;
  }>;
  low_stock_alerts: Array<{
    item_type: string;
    code: string;
    name: string;
    closing_stock: string;
    reorder_level: string;
    unit_symbol: string;
    status: string;
  }>;
}

const PIE_COLORS = ["#351044", "#B81762", "#D97706"];

export default function OwnerPortalPage() {
  const location = useLocation();
  const section = location.pathname.split("/")[2] || "dashboard";
  const [data, setData] = useState<OwnerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/reports/dashboard/owner/");
      setData(res.data);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (section === "dashboard") load();
  }, [section, load]);

  const navItems = [
    { to: "/owner/dashboard", label: "Executive Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
    { to: "/owner/reports", label: "Business & Audit Reports", icon: <FileBarChart2 className="h-4 w-4" /> },
  ];

  return (
    <DesktopShell roleTitle="Business Owner Executive" navItems={navItems}>
      {section === "reports" ? (
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-extrabold text-brand-purple">
            Executive Reports & Exports
          </h1>
          <ReportViewerPanel initialReport="product-costing" />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                Owner Executive Dashboard
              </h1>
              <p className="text-sm text-sf-muted">
                Live factory revenue, costing, production yield, inventory valuation & receivables
              </p>
            </div>
            <button onClick={load} className="sf-btn-secondary text-xs">
              Refresh Live Metrics
            </button>
          </div>

          {error && <ErrorBanner message={error} onRetry={load} />}
          {loading || !data ? (
            <LoadingState message="Computing live executive metrics..." />
          ) : (
            <>
              {/* Executive KPI Grid (All 5 PDF Summary Items + Revenue & Stock Value) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  label="Today's Orders"
                  value={data.kpis.orders_today}
                  subtext={`Total: ${data.kpis.number_of_orders} · Pending approval: ${data.kpis.pending_orders}`}
                  icon={<ShoppingBag className="h-5 w-5" />}
                  tone="magenta"
                />
                <KpiCard
                  label="Gross Revenue (Incl. GST)"
                  value={formatINR(data.kpis.revenue)}
                  subtext={`Sales today: ${formatINR(data.kpis.sales_today)}`}
                  icon={<IndianRupee className="h-5 w-5" />}
                  tone="purple"
                />
                <KpiCard
                  label="Outstanding Dues"
                  value={formatINR(data.kpis.customer_outstanding)}
                  subtext={`Collections received: ${formatINR(data.kpis.collections)}`}
                  icon={<TrendingUp className="h-5 w-5" />}
                  tone={Number(data.kpis.customer_outstanding) > 0 ? "warning" : "success"}
                />
                <KpiCard
                  label="Avg Cost / Good Packet"
                  value={formatINR(data.kpis.cost_per_packet)}
                  subtext={`Output: ${formatQty(data.kpis.production_output)} pkts · Avg yield var: ${data.kpis.yield_variance_pct}%`}
                  icon={<Factory className="h-5 w-5" />}
                  tone={Math.abs(Number(data.kpis.yield_variance_pct)) > 3 ? "warning" : "default"}
                />
                <KpiCard
                  label="Variance Alerts (>3%)"
                  value={data.kpis.variance_alerts_count}
                  subtext="Flagged yield & consumption runs"
                  icon={<AlertTriangle className="h-5 w-5" />}
                  tone={data.kpis.variance_alerts_count > 0 ? "danger" : "success"}
                />
                <KpiCard
                  label="Finished Goods Stock"
                  value={formatINR(data.kpis.finished_goods_value)}
                  subtext="Live ledger valuation"
                  icon={<Package className="h-5 w-5" />}
                />
                <KpiCard
                  label="Raw Material Stock"
                  value={formatINR(data.kpis.raw_material_value)}
                  subtext="Live ledger valuation"
                  icon={<Boxes className="h-5 w-5" />}
                />
                <KpiCard
                  label="Low Stock Alerts"
                  value={data.kpis.low_stock_count}
                  subtext="Items at or below reorder"
                  icon={<AlertTriangle className="h-5 w-5" />}
                  tone={data.kpis.low_stock_count > 0 ? "danger" : "success"}
                />
              </div>

              {/* Charts Row 1 */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="sf-card p-5">
                  <h3 className="font-display text-base font-bold text-brand-purple mb-4">
                    Monthly Sales Revenue (₹)
                  </h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.charts.monthly_sales}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E9DFE8" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="revenue" name="Gross Revenue" fill="#351044" radius={[6, 6, 0, 0]} />
                        <Bar dataKey="taxable" name="Taxable Sales" fill="#B81762" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="sf-card p-5">
                  <h3 className="font-display text-base font-bold text-brand-purple mb-4">
                    Product-wise Sales (₹)
                  </h3>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.charts.product_sales}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E9DFE8" />
                        <XAxis dataKey="product" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="revenue" name="Sales (₹)" fill="#B81762" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Charts Row 2 */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="sf-card p-5">
                  <h3 className="font-display text-base font-bold text-brand-purple mb-4">
                    Production Trend (Expected vs Actual)
                  </h3>
                  <div className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.charts.production_trend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E9DFE8" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="expected" name="Expected" fill="#746879" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="actual" name="Actual Good" fill="#16834A" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="sf-card p-5">
                  <h3 className="font-display text-base font-bold text-brand-purple mb-4">
                    Inventory Value Distribution (₹)
                  </h3>
                  <div className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.charts.inventory_distribution}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={48}
                          outerRadius={78}
                          paddingAngle={3}
                        >
                          {data.charts.inventory_distribution.map((_, idx) => (
                            <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="sf-card p-5">
                  <h3 className="font-display text-base font-bold text-brand-purple mb-4">
                    Collections vs Outstanding (₹)
                  </h3>
                  <div className="h-60">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={data.charts.collections_vs_outstanding}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E9DFE8" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Bar dataKey="amount" name="Amount (₹)" radius={[6, 6, 0, 0]}>
                          <Cell fill="#16834A" />
                          <Cell fill="#DC2626" />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Variance Alerts (>3% Tolerance) Table */}
              <div className="sf-card overflow-hidden">
                <div className="px-5 py-3.5 border-b border-sf-border bg-red-50/70 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-bold text-brand-purple">
                      Production &amp; Consumption Variance Alerts (&gt;3% Tolerance)
                    </h3>
                    <p className="text-[11px] text-sf-muted">
                      Flags batches where actual output or material usage deviated beyond tolerance
                    </p>
                  </div>
                  <StatusBadge
                    status={data.variance_alerts.length > 0 ? "FLAGGED" : "OK"}
                    label={`${data.variance_alerts.length} Active Alert${data.variance_alerts.length === 1 ? "" : "s"}`}
                  />
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                      <tr>
                        <th className="px-4 py-3 font-bold">Run No</th>
                        <th className="px-4 py-3 font-bold">Date</th>
                        <th className="px-4 py-3 font-bold">Type</th>
                        <th className="px-4 py-3 font-bold">Product</th>
                        <th className="px-4 py-3 font-bold">Item / Metric</th>
                        <th className="px-4 py-3 font-bold">Planned</th>
                        <th className="px-4 py-3 font-bold">Actual</th>
                        <th className="px-4 py-3 font-bold">Variance %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sf-border">
                      {data.variance_alerts.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-6 text-center text-sf-muted">
                            No variance alerts — all production runs are within 3% tolerance.
                          </td>
                        </tr>
                      ) : (
                        data.variance_alerts.map((v) => (
                          <tr key={v.id} className="bg-red-50/30 hover:bg-red-50/60">
                            <td className="px-4 py-2.5 font-bold text-brand-purple whitespace-nowrap">
                              {v.run_number}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(v.run_date)}</td>
                            <td className="px-4 py-2.5">
                              <StatusBadge
                                status={v.alert_type === "YIELD" ? "INVOICED" : "FLAGGED"}
                                label={v.alert_type}
                              />
                            </td>
                            <td className="px-4 py-2.5 font-semibold">{v.product_name}</td>
                            <td className="px-4 py-2.5 font-bold text-brand-purple">{v.item_label}</td>
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              {formatQty(v.planned_qty)} {v.unit_symbol}
                            </td>
                            <td className="px-4 py-2.5 font-bold whitespace-nowrap">
                              {formatQty(v.actual_qty)} {v.unit_symbol}
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusBadge status="FLAGGED" label={`${v.variance_pct}%`} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Low Stock Alerts Table */}
              <div className="sf-card overflow-hidden">
                <div className="px-5 py-3.5 border-b border-sf-border bg-brand-pink/50">
                  <h3 className="font-display text-base font-bold text-brand-purple">
                    Low Stock & Reorder Alerts
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                      <tr>
                        <th className="px-4 py-3 font-bold">Category</th>
                        <th className="px-4 py-3 font-bold">Item</th>
                        <th className="px-4 py-3 font-bold">Available</th>
                        <th className="px-4 py-3 font-bold">Reorder Level</th>
                        <th className="px-4 py-3 font-bold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sf-border">
                      {data.low_stock_alerts.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-sf-muted">
                            All materials and finished goods are above reorder level.
                          </td>
                        </tr>
                      ) : (
                        data.low_stock_alerts.map((a) => (
                          <tr key={`${a.item_type}-${a.code}`}>
                            <td className="px-4 py-2.5 font-semibold">{a.item_type}</td>
                            <td className="px-4 py-2.5 font-bold text-brand-purple">{a.name}</td>
                            <td className="px-4 py-2.5">
                              {formatQty(a.closing_stock)} {a.unit_symbol}
                            </td>
                            <td className="px-4 py-2.5">
                              {formatQty(a.reorder_level)} {a.unit_symbol}
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusBadge status={a.status} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </DesktopShell>
  );
}
