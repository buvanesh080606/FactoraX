import React, { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Download,
  Factory,
  FileBarChart2,
  FileMinus2,
  IndianRupee,
  LayoutDashboard,
  Mail,
  MessageCircle,
  Package,
  Pencil,
  Plus,
  ReceiptText,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Truck,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { api, downloadAuthenticatedFile, extractErrorMessage } from "../../api/client";
import { DesktopShell } from "../../components/DesktopShell";
import { ReportViewerPanel } from "../../components/ReportViewerPanel";
import { ErrorBanner, KpiCard, LoadingState, Modal, StatusBadge } from "../../components/ui";
import type {
  CompanySetting,
  Customer,
  InventorySummaryRow,
  Invoice,
  MaterialItem,
  Product,
  ProductionRun,
  SalesOrder,
  StockLedgerEntry,
  Supplier,
  Unit,
  User,
} from "../../types/erp";
import { formatDate, formatDateTime, formatINR, formatQty, getLocalDateInputValue, unwrapList } from "../../utils/format";

export default function AdminErpPage() {
  const location = useLocation();
  const section = location.pathname.split("/")[2] || "dashboard";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [globalSearch, setGlobalSearch] = useState("");

  const [dashData, setDashData] = useState<any>(null);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [orderStatusFilter, setOrderStatusFilter] = useState("ALL");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rawMats, setRawMats] = useState<MaterialItem[]>([]);
  const [pkgMats, setPkgMats] = useState<MaterialItem[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [invSummary, setInvSummary] = useState<InventorySummaryRow[]>([]);
  const [invView, setInvView] = useState<"INVENTORY" | "LEDGER">("INVENTORY");
  const [invTab, setInvTab] = useState<"ALL" | "RAW" | "PACKAGING" | "FINISHED">("ALL");
  const [invStatusFilter, setInvStatusFilter] = useState<"ALL" | "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK">("ALL");
  const [ledger, setLedger] = useState<StockLedgerEntry[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [prodRuns, setProdRuns] = useState<ProductionRun[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [dispatches, setDispatches] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [receivables, setReceivables] = useState<any>(null);
  const [companySetting, setCompanySetting] = useState<CompanySetting | null>(null);
  const [users, setUsers] = useState<User[]>([]);

  // Interactive Modals
  const [stockCheckOrder, setStockCheckOrder] = useState<{ order: SalesOrder; check: any } | null>(null);
  const [rejectOrder, setRejectOrder] = useState<SalesOrder | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [editOrder, setEditOrder] = useState<SalesOrder | null>(null);
  const [editItems, setEditItems] = useState<Array<{ product: number; product_name: string; quantity: string; unit_price: string }>>([]);
  const [editNotes, setEditNotes] = useState("");
  const [cnInvoice, setCnInvoice] = useState<Invoice | null>(null);
  const [cnForm, setCnForm] = useState({ amount: "", reason: "", restock_finished_goods: false });

  const [custModal, setCustModal] = useState(false);
  const [newCust, setNewCust] = useState({
    code: "",
    name: "",
    customer_type: "RETAILER",
    state: "Tamil Nadu",
    gstin: "",
    phone: "",
    address: "",
  });

  const [prodModal, setProdModal] = useState(false);
  const [editingProdId, setEditingProdId] = useState<number | null>(null);
  const [uploadingProdImg, setUploadingProdImg] = useState(false);
  const [newProd, setNewProd] = useState({
    sku: "",
    name: "",
    category: "MURUKKU",
    pack_size: "200 g",
    unit: "",
    hsn_code: "21069099",
    gst_rate: "5.00",
    selling_price: "50.00",
    image_url: "/products/murukku.jpg",
    description: "",
  });

  const [purchaseModal, setPurchaseModal] = useState(false);
  const [newPurchase, setNewPurchase] = useState({
    supplier: "",
    invoice_ref: "",
    material_type: "RAW",
    material_id: "",
    quantity: "50",
    unit_rate: "45",
  });

  const [supplierModal, setSupplierModal] = useState(false);
  const [newSup, setNewSup] = useState({ code: "", name: "", state: "Tamil Nadu", gstin: "", phone: "" });

  const [adjModal, setAdjModal] = useState(false);
  const [newAdj, setNewAdj] = useState({
    mode: "adjustments",
    item_type: "FINISHED",
    item_id: "",
    quantity: "50",
    unit_cost: "",
    notes: "",
  });

  const [dispatchModal, setDispatchModal] = useState<Invoice | null>(null);
  const [dispatchForm, setDispatchForm] = useState({ vehicle_no: "", transporter: "", notes: "" });

  const [paymentModal, setPaymentModal] = useState(false);
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [paymentFilter, setPaymentFilter] = useState<"ALL" | "PENDING_DUE" | "NO_PENDING_DUE">("ALL");
  const [payForm, setPayForm] = useState({
    customer: "",
    customer_text: "",
    invoice: "",
    amount: "",
    payment_status: "PENDING_DUE" as "PENDING_DUE" | "NO_PENDING_DUE",
    pending_amount: "",
    payment_date: getLocalDateInputValue(),
    payment_mode: "UPI",
    reference_number: "",
    notes: "",
  });

  const loadSection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (section === "dashboard") {
        const res = await api.get("/reports/dashboard/admin/");
        setDashData(res.data);
      } else if (section === "orders") {
        const params: any = { page_size: 100 };
        if (orderStatusFilter !== "ALL") params.status = orderStatusFilter;
        if (globalSearch) params.search = globalSearch;
        const res = await api.get("/sales/orders/", { params });
        setOrders(unwrapList<SalesOrder>(res.data));
      } else if (section === "customers") {
        const res = await api.get("/masters/customers/", { params: { search: globalSearch, page_size: 100 } });
        setCustomers(unwrapList<Customer>(res.data));
      } else if (section === "products") {
        const [pRes, uRes] = await Promise.all([
          api.get("/masters/products/", { params: { search: globalSearch, page_size: 100 } }),
          api.get("/masters/units/"),
        ]);
        setProducts(unwrapList<Product>(pRes.data));
        setUnits(unwrapList<Unit>(uRes.data));
      } else if (section === "inventory") {
        const [sRes, lRes, pRes, rRes, pkRes] = await Promise.all([
          api.get("/inventory/summary/", {
            params: { item_type: invTab === "ALL" ? undefined : invTab, search: globalSearch || undefined },
          }),
          api.get("/inventory/ledger/", { params: { page_size: 50 } }),
          api.get("/masters/products/", { params: { page_size: 100 } }),
          api.get("/masters/raw-materials/", { params: { page_size: 100 } }),
          api.get("/masters/packaging-materials/", { params: { page_size: 100 } }),
        ]);
        setInvSummary(sRes.data.results || []);
        setLedger(unwrapList<StockLedgerEntry>(lRes.data));
        setProducts(unwrapList<Product>(pRes.data));
        setRawMats(unwrapList<MaterialItem>(rRes.data));
        setPkgMats(unwrapList<MaterialItem>(pkRes.data));
      } else if (section === "purchases") {
        const [puRes, supRes, rRes, pkRes] = await Promise.all([
          api.get("/purchases/", { params: { page_size: 100 } }),
          api.get("/masters/suppliers/", { params: { page_size: 100 } }),
          api.get("/masters/raw-materials/", { params: { page_size: 100 } }),
          api.get("/masters/packaging-materials/", { params: { page_size: 100 } }),
        ]);
        setPurchases(unwrapList(puRes.data));
        setSuppliers(unwrapList<Supplier>(supRes.data));
        setRawMats(unwrapList<MaterialItem>(rRes.data));
        setPkgMats(unwrapList<MaterialItem>(pkRes.data));
      } else if (section === "production") {
        const res = await api.get("/production/runs/", { params: { page_size: 50 } });
        setProdRuns(unwrapList<ProductionRun>(res.data));
      } else if (section === "invoices") {
        const res = await api.get("/sales/invoices/", { params: { search: globalSearch, page_size: 100 } });
        setInvoices(unwrapList<Invoice>(res.data));
      } else if (section === "dispatch") {
        const [invRes, dspRes] = await Promise.all([
          api.get("/sales/invoices/", { params: { page_size: 100 } }),
          api.get("/sales/dispatches/", { params: { page_size: 100 } }),
        ]);
        setInvoices(unwrapList<Invoice>(invRes.data));
        setDispatches(unwrapList(dspRes.data));
      } else if (section === "payments") {
        const [pRes, rRes, cRes, invRes] = await Promise.all([
          api.get("/sales/payments/", { params: { page_size: 100 } }),
          api.get("/sales/receivables/"),
          api.get("/masters/customers/", { params: { page_size: 100 } }),
          api.get("/sales/invoices/", { params: { page_size: 100 } }),
        ]);
        setPayments(unwrapList(pRes.data));
        setReceivables(rRes.data);
        setCustomers(unwrapList<Customer>(cRes.data));
        setInvoices(unwrapList<Invoice>(invRes.data));
      } else if (section === "settings") {
        const [cRes, uRes] = await Promise.all([
          api.get("/auth/company-settings/"),
          api.get("/auth/users/", { params: { page_size: 100 } }),
        ]);
        setCompanySetting(cRes.data);
        setUsers(unwrapList<User>(uRes.data));
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [section, orderStatusFilter, globalSearch, invTab]);

  useEffect(() => {
    if (section !== "reports") loadSection();
    else setLoading(false);
  }, [section, loadSection]);

  const showToast = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 6000);
  };

  // Order Actions
  const handleInspectStock = async (order: SalesOrder) => {
    try {
      const res = await api.get(`/sales/orders/${order.id}/stock-check/`);
      setStockCheckOrder({ order, check: res.data });
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const handleApproveOrder = async (orderId: number) => {
    setError(null);
    try {
      const res = await api.post(`/sales/orders/${orderId}/approve/`, {});
      showToast(`Order ${res.data.order_number} approved.`);
      setStockCheckOrder(null);
      loadSection();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const handleRejectOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectOrder) return;
    try {
      await api.post(`/sales/orders/${rejectOrder.id}/reject/`, { reason: rejectReason });
      showToast(`Order ${rejectOrder.order_number} rejected.`);
      setRejectOrder(null);
      setRejectReason("");
      loadSection();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const handleGenerateInvoice = async (orderId: number) => {
    setError(null);
    try {
      const res = await api.post(`/sales/orders/${orderId}/generate-invoice/`, {});
      showToast(
        `Generated GST Invoice ${res.data.invoice_number} (${res.data.is_inter_state ? "IGST" : "CGST+SGST"} · ${formatINR(res.data.grand_total)}).`
      );
      loadSection();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const handleCreateDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchModal) return;
    try {
      const res = await api.post("/sales/dispatches/", {
        invoice: dispatchModal.id,
        ...dispatchForm,
      });
      showToast(`Dispatched ${res.data.dispatch_number} — finished stock updated in ledger.`);
      setDispatchModal(null);
      setDispatchForm({ vehicle_no: "", transporter: "", notes: "" });
      loadSection();
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  const navItems = [
    { to: "/admin/dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> },
    { to: "/admin/orders", label: "Orders & Approvals", icon: <ShoppingBag className="h-4 w-4" /> },
    { to: "/admin/customers", label: "Customers", icon: <Users className="h-4 w-4" /> },
    { to: "/admin/products", label: "Products", icon: <Package className="h-4 w-4" /> },
    { to: "/admin/inventory", label: "Inventory & Ledger", icon: <Boxes className="h-4 w-4" /> },
    { to: "/admin/purchases", label: "Purchases & Suppliers", icon: <ShoppingCart className="h-4 w-4" /> },
    { to: "/admin/production", label: "Production Overview", icon: <Factory className="h-4 w-4" /> },
    { to: "/admin/invoices", label: "Billing & GST Invoices", icon: <ReceiptText className="h-4 w-4" /> },
    { to: "/admin/dispatch", label: "Dispatch", icon: <Truck className="h-4 w-4" /> },
    { to: "/admin/payments", label: "Payments & Ageing", icon: <IndianRupee className="h-4 w-4" /> },
    { to: "/admin/reports", label: "Reports & Exports", icon: <FileBarChart2 className="h-4 w-4" /> },
    { to: "/admin/settings", label: "Settings & Users", icon: <Settings className="h-4 w-4" /> },
  ];

  return (
    <DesktopShell
      roleTitle="Admin & Billing ERP"
      navItems={navItems}
      onSearch={["orders", "customers", "products", "inventory", "invoices"].includes(section) ? setGlobalSearch : undefined}
    >
      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-semibold text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} onRetry={loadSection} />
        </div>
      )}

      {section === "reports" ? (
        <div className="space-y-4">
          <h1 className="font-display text-2xl font-extrabold text-brand-purple">
            Operational & Financial Reports
          </h1>
          <ReportViewerPanel initialReport="sales-register" />
        </div>
      ) : loading ? (
        <LoadingState />
      ) : (
        <>
          {/* 1. DASHBOARD */}
          {section === "dashboard" && dashData && (
            <div className="space-y-6">
              <div>
                <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                  Admin ERP Dashboard
                </h1>
                <p className="text-sm text-sf-muted">
                  Real-time order pipeline, stock position, and collections from PostgreSQL
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard label="Orders Today" value={dashData.kpis.orders_today} icon={<ShoppingBag className="h-5 w-5" />} tone="purple" />
                <KpiCard label="Sales Today" value={formatINR(dashData.kpis.sales_today)} icon={<IndianRupee className="h-5 w-5" />} tone="magenta" />
                <KpiCard label="Pending Approval" value={dashData.kpis.pending_approval} subtext={`Approved ready to bill: ${dashData.kpis.approved_orders}`} icon={<AlertTriangle className="h-5 w-5" />} tone="warning" />
                <KpiCard label="Outstanding Payments" value={formatINR(dashData.kpis.outstanding_payments)} subtext={`Finished stock: ${formatQty(dashData.kpis.finished_goods_stock)} pkts · Low stock: ${dashData.kpis.low_stock_count}`} icon={<Boxes className="h-5 w-5" />} tone="danger" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="sf-card overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-sf-border bg-brand-pink/50 font-display text-sm font-bold text-brand-purple">
                    Orders Pending Approval
                  </div>
                  <div className="divide-y divide-sf-border">
                    {dashData.pending_orders.length === 0 ? (
                      <p className="p-5 text-xs text-sf-muted">No pending orders.</p>
                    ) : (
                      dashData.pending_orders.map((o: any) => (
                        <div key={o.id} className="px-5 py-3 flex items-center justify-between gap-2 text-xs">
                          <div>
                            <p className="font-bold text-brand-purple">{o.order_number} · {o.customer_name}</p>
                            <p className="text-sf-muted">By {o.salesman_name} on {formatDate(o.order_date)}</p>
                          </div>
                          <span className="font-extrabold text-brand-magenta">{formatINR(o.grand_total)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="sf-card overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-sf-border bg-brand-pink/50 font-display text-sm font-bold text-brand-purple">
                    Recent Audit Activity
                  </div>
                  <div className="divide-y divide-sf-border max-h-80 overflow-y-auto">
                    {dashData.recent_activity.map((a: any) => (
                      <div key={a.id} className="px-5 py-3 text-xs">
                        <p className="font-semibold text-sf-text">{a.summary}</p>
                        <p className="text-[11px] text-sf-muted mt-0.5">
                          {a.user_name} · {formatDateTime(a.created_at)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 2. ORDERS */}
          {section === "orders" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                  Order Management & Approvals
                </h1>
                <div className="flex flex-wrap gap-1.5">
                  {["ALL", "PENDING_APPROVAL", "APPROVED", "INVOICED", "DISPATCHED", "REJECTED"].map((st) => (
                    <button
                      key={st}
                      onClick={() => setOrderStatusFilter(st)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                        orderStatusFilter === st
                          ? "bg-brand-purple text-white"
                          : "bg-white border border-sf-border text-sf-text"
                      }`}
                    >
                      {st.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sf-card overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                    <tr>
                      <th className="px-4 py-3 font-bold">Order ID</th>
                      <th className="px-4 py-3 font-bold">Date</th>
                      <th className="px-4 py-3 font-bold">Salesman</th>
                      <th className="px-4 py-3 font-bold">Customer</th>
                      <th className="px-4 py-3 font-bold">Qty</th>
                      <th className="px-4 py-3 font-bold">Total</th>
                      <th className="px-4 py-3 font-bold">Stock</th>
                      <th className="px-4 py-3 font-bold">Status</th>
                      <th className="px-4 py-3 font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sf-border">
                    {orders.map((ord) => (
                      <tr key={ord.id} className="hover:bg-brand-pink/30">
                        <td className="px-4 py-3 font-bold text-brand-purple whitespace-nowrap">{ord.order_number}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDate(ord.order_date)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{ord.salesman_name}</td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{ord.customer_name}</p>
                          <p className="text-[11px] text-sf-muted">{ord.customer_state}</p>
                        </td>
                        <td className="px-4 py-3 font-semibold">{formatQty(ord.total_quantity)}</td>
                        <td className="px-4 py-3 font-bold whitespace-nowrap">{formatINR(ord.grand_total)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusBadge
                            status={ord.stock_sufficient ? "IN_STOCK" : "OUT_OF_STOCK"}
                            label={ord.stock_sufficient ? "SUFFICIENT" : "SHORTAGE"}
                          />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusBadge status={ord.status} />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {["SUBMITTED", "PENDING_APPROVAL"].includes(ord.status) && (
                              <>
                                <button
                                  onClick={() => {
                                    setEditOrder(ord);
                                    setEditNotes(ord.delivery_notes || "");
                                    setEditItems(
                                      ord.items.map((it) => ({
                                        product: it.product,
                                        product_name: `${it.product_name} (${it.pack_size})`,
                                        quantity: String(Number(it.quantity)),
                                        unit_price: String(it.unit_price),
                                      }))
                                    );
                                  }}
                                  className="sf-btn-secondary py-1 px-2 text-[11px]"
                                  title="Edit quantities or prices"
                                >
                                  <Pencil className="h-3 w-3" /> Edit
                                </button>
                                <button
                                  onClick={() => handleInspectStock(ord)}
                                  className="sf-btn-purple py-1 px-2.5 text-[11px]"
                                >
                                  Stock &amp; Approve
                                </button>
                                <button
                                  onClick={() => setRejectOrder(ord)}
                                  className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                            {ord.status === "APPROVED" && (
                              <button
                                onClick={() => handleGenerateInvoice(ord.id)}
                                className="sf-btn-primary py-1 px-2.5 text-[11px]"
                              >
                                Generate GST Invoice
                              </button>
                            )}
                            {ord.invoice_id && (
                              <button
                                onClick={() =>
                                  downloadAuthenticatedFile(
                                    `/sales/invoices/${ord.invoice_id}/pdf/`,
                                    `${(ord.invoice_number || "invoice").replace(/\//g, "-")}.pdf`
                                  )
                                }
                                className="sf-btn-secondary py-1 px-2.5 text-[11px]"
                              >
                                <Download className="h-3 w-3" /> PDF
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3. CUSTOMERS */}
          {section === "customers" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-extrabold text-brand-purple">Customers</h1>
                <button onClick={() => setCustModal(true)} className="sf-btn-primary text-xs">
                  <Plus className="h-4 w-4" /> Add Customer
                </button>
              </div>
              <div className="sf-card overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                    <tr>
                      <th className="px-4 py-3 font-bold">Code</th>
                      <th className="px-4 py-3 font-bold">Name</th>
                      <th className="px-4 py-3 font-bold">Type</th>
                      <th className="px-4 py-3 font-bold">State</th>
                      <th className="px-4 py-3 font-bold">GSTIN</th>
                      <th className="px-4 py-3 font-bold">Salesman</th>
                      <th className="px-4 py-3 font-bold">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sf-border">
                    {customers.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-3 font-bold text-brand-purple">{c.code}</td>
                        <td className="px-4 py-3 font-semibold">{c.name}</td>
                        <td className="px-4 py-3">{c.customer_type}</td>
                        <td className="px-4 py-3">{c.state}</td>
                        <td className="px-4 py-3 font-mono">{c.gstin || "—"}</td>
                        <td className="px-4 py-3">{c.assigned_salesman_name || "Unassigned"}</td>
                        <td className="px-4 py-3 font-bold text-brand-magenta">
                          {formatINR(c.outstanding_balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 4. PRODUCTS */}
          {section === "products" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-extrabold text-brand-purple">Finished Products</h1>
                <button
                  onClick={() => {
                    setEditingProdId(null);
                    setNewProd({
                      sku: "",
                      name: "",
                      category: "MURUKKU",
                      pack_size: "200 g",
                      unit: String(units.find((u) => u.symbol === "pkt")?.id || units[0]?.id || ""),
                      hsn_code: "21069099",
                      gst_rate: "5.00",
                      selling_price: "50.00",
                      image_url: "/products/murukku.jpg",
                      description: "",
                    });
                    setProdModal(true);
                  }}
                  className="sf-btn-primary text-xs"
                >
                  <Plus className="h-4 w-4" /> Add Product
                </button>
              </div>
              <div className="sf-card overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-brand-pink/70 border-b border-sf-border text-brand-purple uppercase">
                    <tr>
                      <th className="px-4 py-3 font-bold">Thumbnail</th>
                      <th className="px-4 py-3 font-bold">SKU</th>
                      <th className="px-4 py-3 font-bold">Product</th>
                      <th className="px-4 py-3 font-bold">Category</th>
                      <th className="px-4 py-3 font-bold">HSN</th>
                      <th className="px-4 py-3 font-bold">Price</th>
                      <th className="px-4 py-3 font-bold">GST</th>
                      <th className="px-4 py-3 font-bold">Available Stock</th>
                      <th className="px-4 py-3 font-bold">Status</th>
                      <th className="px-4 py-3 font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sf-border">
                    {products.map((p) => (
                      <tr key={p.id} className="hover:bg-brand-pink/35">
                        <td className="px-4 py-2">
                          <img
                            src={p.image_url || "/products/murukku.jpg"}
                            alt={p.name}
                            className="h-11 w-11 rounded-xl object-cover border border-sf-border bg-brand-pink"
                          />
                        </td>
                        <td className="px-4 py-3 font-bold text-brand-purple whitespace-nowrap">{p.sku}</td>
                        <td className="px-4 py-3 font-semibold">{p.name} ({p.pack_size})</td>
                        <td className="px-4 py-3">{p.category}</td>
                        <td className="px-4 py-3 font-mono">{p.hsn_code}</td>
                        <td className="px-4 py-3 font-bold whitespace-nowrap">{formatINR(p.selling_price)}</td>
                        <td className="px-4 py-3">{Number(p.gst_rate)}%</td>
                        <td className="px-4 py-3 font-bold whitespace-nowrap">{formatQty(p.available_stock)} {p.unit_symbol}</td>
                        <td className="px-4 py-3"><StatusBadge status={p.stock_status} /></td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingProdId(p.id);
                                setNewProd({
                                  sku: p.sku,
                                  name: p.name,
                                  category: p.category,
                                  pack_size: p.pack_size,
                                  unit: String(p.unit),
                                  hsn_code: p.hsn_code,
                                  gst_rate: String(p.gst_rate),
                                  selling_price: String(p.selling_price),
                                  image_url: p.image_url || "/products/murukku.jpg",
                                  description: p.description || "",
                                });
                                setProdModal(true);
                              }}
                              className="sf-btn-secondary py-1 px-2 text-[11px]"
                            >
                              <Pencil className="h-3 w-3" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(`Remove product "${p.name} (${p.pack_size})"?`)) return;
                                try {
                                  const res = await api.delete(`/masters/products/${p.id}/`);
                                  showToast(res.data?.detail || `Removed ${p.name}.`);
                                  loadSection();
                                } catch (err) {
                                  setError(extractErrorMessage(err));
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100"
                            >
                              <Trash2 className="h-3 w-3" /> Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 5. INVENTORY & STOCK LEDGER */}
          {section === "inventory" && (
            <div className="space-y-5">
              {/* Header with Separate 1. Inventory | 2. Stock Ledger Switcher */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                    {invView === "INVENTORY" ? "Inventory Summary" : "Stock Ledger & Stock Status"}
                  </h1>
                  <p className="text-xs text-sf-muted">
                    Closing Stock = Opening + Receipts − Issues + Adjustments (single source of truth)
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Primary Right-Side Mode Switcher: 1. Inventory | 2. Stock Ledger */}
                  <div className="inline-flex rounded-xl bg-brand-pink p-1 border border-brand-pinkBorder">
                    <button
                      type="button"
                      onClick={() => setInvView("INVENTORY")}
                      className={`rounded-lg px-3.5 py-1.5 text-xs font-extrabold transition ${
                        invView === "INVENTORY"
                          ? "bg-brand-purple text-white shadow-sm"
                          : "text-brand-purple hover:bg-white/60"
                      }`}
                    >
                      1. Inventory
                    </button>
                    <button
                      type="button"
                      onClick={() => setInvView("LEDGER")}
                      className={`rounded-lg px-3.5 py-1.5 text-xs font-extrabold transition ${
                        invView === "LEDGER"
                          ? "bg-brand-purple text-white shadow-sm"
                          : "text-brand-purple hover:bg-white/60"
                      }`}
                    >
                      2. Stock Ledger
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setNewAdj((a) => ({ ...a, item_id: String(products[0]?.id || "") }));
                      setAdjModal(true);
                    }}
                    className="sf-btn-primary py-2 text-xs"
                  >
                    + Stock Entry / Adj
                  </button>
                </div>
              </div>

              {/* VIEW 1: INVENTORY ONLY */}
              {invView === "INVENTORY" && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {(["ALL", "RAW", "PACKAGING", "FINISHED"] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setInvTab(t)}
                          className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                            invTab === t
                              ? "bg-brand-purple text-white"
                              : "bg-sf-surface border border-sf-border text-sf-text hover:bg-brand-pink"
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          { k: "ALL", l: "All Status" },
                          { k: "IN_STOCK", l: `In Stock (${invSummary.filter((x) => x.status === "IN_STOCK").length})` },
                          { k: "LOW_STOCK", l: `Low Stock (${invSummary.filter((x) => x.status === "LOW_STOCK").length})` },
                          { k: "OUT_OF_STOCK", l: `Out of Stock (${invSummary.filter((x) => x.status === "OUT_OF_STOCK").length})` },
                        ] as const
                      ).map((st) => (
                        <button
                          key={st.k}
                          type="button"
                          onClick={() => setInvStatusFilter(st.k)}
                          className={`rounded-xl px-3 py-1.5 text-xs font-bold ${
                            invStatusFilter === st.k
                              ? "bg-brand-magenta text-white"
                              : "bg-sf-surface border border-sf-border text-sf-text hover:bg-brand-pink"
                          }`}
                        >
                          {st.l}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="sf-card overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead className="bg-brand-pink/70 border-b border-sf-border text-brand-purple uppercase">
                        <tr>
                          <th className="px-4 py-3 font-bold">Type</th>
                          <th className="px-4 py-3 font-bold">Item</th>
                          <th className="px-4 py-3 font-bold">Opening</th>
                          <th className="px-4 py-3 font-bold">Receipts</th>
                          <th className="px-4 py-3 font-bold">Issues</th>
                          <th className="px-4 py-3 font-bold">Adj</th>
                          <th className="px-4 py-3 font-bold">Closing</th>
                          <th className="px-4 py-3 font-bold">Avg Cost</th>
                          <th className="px-4 py-3 font-bold">Value</th>
                          <th className="px-4 py-3 font-bold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-sf-border">
                        {invSummary
                          .filter((r) => invStatusFilter === "ALL" || r.status === invStatusFilter)
                          .map((r) => (
                            <tr key={`${r.item_type}-${r.item_id}`} className="hover:bg-brand-pink/40">
                              <td className="px-4 py-2.5 text-sf-muted font-semibold">{r.item_type}</td>
                              <td className="px-4 py-2.5 font-bold text-brand-purple">{r.name}</td>
                              <td className="px-4 py-2.5">{formatQty(r.opening_stock)}</td>
                              <td className="px-4 py-2.5 text-sf-success font-semibold">+{formatQty(r.receipts)}</td>
                              <td className="px-4 py-2.5 text-sf-danger font-semibold">-{formatQty(r.issues)}</td>
                              <td className="px-4 py-2.5">{formatQty(r.adjustments)}</td>
                              <td className="px-4 py-2.5 font-extrabold">
                                {formatQty(r.closing_stock)} {r.unit_symbol}
                              </td>
                              <td className="px-4 py-2.5">{formatINR(r.unit_cost)}</td>
                              <td className="px-4 py-2.5 font-bold">{formatINR(r.stock_value)}</td>
                              <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* VIEW 2: STOCK LEDGER — DIVIDED INTO (A) IN STOCK / LOW STOCK STATUS & (B) RECENT LEDGER MOVEMENTS */}
              {invView === "LEDGER" && (
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
                  {/* Left Panel: In Stock vs Low Stock Status Breakdown */}
                  <div className="sf-card overflow-hidden">
                    <div className="px-4 py-3 border-b border-sf-border bg-brand-pink/70 font-display text-sm font-bold text-brand-purple flex items-center justify-between">
                      <span>In Stock / Low Stock Status</span>
                      <span className="text-[11px] font-semibold text-brand-magenta">
                        {invSummary.filter((r) => r.status !== "IN_STOCK").length} alert(s)
                      </span>
                    </div>
                    <div className="p-3.5 space-y-3">
                      <div>
                        <p className="text-[11px] font-extrabold uppercase tracking-wide text-amber-800 mb-1.5">
                          Low Stock / Out of Stock ({invSummary.filter((r) => r.status !== "IN_STOCK").length})
                        </p>
                        <div className="space-y-1.5">
                          {invSummary.filter((r) => r.status !== "IN_STOCK").length === 0 ? (
                            <p className="text-xs text-sf-muted">No low stock items.</p>
                          ) : (
                            invSummary
                              .filter((r) => r.status !== "IN_STOCK")
                              .map((r) => (
                                <div
                                  key={`low-${r.item_type}-${r.item_id}`}
                                  className="rounded-xl border border-amber-300 bg-amber-50/90 px-3 py-2 flex items-center justify-between gap-2 text-xs"
                                >
                                  <div className="min-w-0">
                                    <p className="font-bold text-sf-text truncate">{r.name}</p>
                                    <p className="text-[10px] text-sf-muted">
                                      {r.item_type} · Reorder: {formatQty(r.reorder_level)} {r.unit_symbol}
                                    </p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="font-extrabold text-amber-900">
                                      {formatQty(r.closing_stock)} {r.unit_symbol}
                                    </p>
                                    <StatusBadge status={r.status} />
                                  </div>
                                </div>
                              ))
                          )}
                        </div>
                      </div>

                      <div className="border-t border-sf-border pt-3">
                        <p className="text-[11px] font-extrabold uppercase tracking-wide text-emerald-800 mb-1.5">
                          Healthy In Stock ({invSummary.filter((r) => r.status === "IN_STOCK").length})
                        </p>
                        <div className="space-y-1.5 max-h-80 overflow-y-auto no-scrollbar">
                          {invSummary
                            .filter((r) => r.status === "IN_STOCK")
                            .map((r) => (
                              <div
                                key={`ok-${r.item_type}-${r.item_id}`}
                                className="rounded-xl border border-sf-border bg-white/70 px-3 py-2 flex items-center justify-between gap-2 text-xs"
                              >
                                <div className="min-w-0">
                                  <p className="font-semibold text-brand-purple truncate">{r.name}</p>
                                  <p className="text-[10px] text-sf-muted">{r.item_type}</p>
                                </div>
                                <span className="font-bold text-sf-success shrink-0">
                                  {formatQty(r.closing_stock)} {r.unit_symbol}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Panel (2 cols): Recent Stock Ledger Movements */}
                  <div className="xl:col-span-2 sf-card overflow-hidden">
                    <div className="px-5 py-3 border-b border-sf-border bg-brand-pink/70 font-display text-sm font-bold text-brand-purple flex items-center justify-between">
                      <span>Recent Stock Ledger Movements</span>
                      <span className="text-xs font-semibold text-sf-muted">{ledger.length} entries</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-sf-bg/70 border-b border-sf-border text-brand-purple uppercase">
                          <tr>
                            <th className="px-4 py-2.5 font-bold">Timestamp</th>
                            <th className="px-4 py-2.5 font-bold">Item</th>
                            <th className="px-4 py-2.5 font-bold">Movement</th>
                            <th className="px-4 py-2.5 font-bold">Delta</th>
                            <th className="px-4 py-2.5 font-bold">Balance</th>
                            <th className="px-4 py-2.5 font-bold">Reference</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-sf-border">
                          {ledger.map((e) => (
                            <tr key={e.id} className="hover:bg-brand-pink/40">
                              <td className="px-4 py-2 text-sf-muted whitespace-nowrap">{formatDateTime(e.created_at)}</td>
                              <td className="px-4 py-2 font-semibold">{e.item_name}</td>
                              <td className="px-4 py-2">{e.movement_type.replace(/_/g, " ")}</td>
                              <td className={`px-4 py-2 font-bold ${Number(e.quantity_delta) >= 0 ? "text-sf-success" : "text-sf-danger"}`}>
                                {Number(e.quantity_delta) >= 0 ? "+" : ""}{formatQty(e.quantity_delta)} {e.unit_symbol}
                              </td>
                              <td className="px-4 py-2 font-bold">{formatQty(e.running_balance)} {e.unit_symbol}</td>
                              <td className="px-4 py-2 text-sf-muted">{e.reference_no || e.source_type}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 6. PURCHASES & SUPPLIERS */}
          {section === "purchases" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                  Purchases & Suppliers
                </h1>
                <div className="flex gap-2">
                  <button onClick={() => setSupplierModal(true)} className="sf-btn-secondary text-xs">
                    + Add Supplier
                  </button>
                  <button
                    onClick={() => {
                      setNewPurchase((p) => ({
                        ...p,
                        supplier: String(suppliers[0]?.id || ""),
                        material_id: String(rawMats[0]?.id || ""),
                      }));
                      setPurchaseModal(true);
                    }}
                    className="sf-btn-primary text-xs"
                  >
                    + Record Purchase Receipt
                  </button>
                </div>
              </div>

              <div className="sf-card overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                    <tr>
                      <th className="px-4 py-3 font-bold">Purchase No</th>
                      <th className="px-4 py-3 font-bold">Date</th>
                      <th className="px-4 py-3 font-bold">Supplier</th>
                      <th className="px-4 py-3 font-bold">Items</th>
                      <th className="px-4 py-3 font-bold">Total</th>
                      <th className="px-4 py-3 font-bold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sf-border">
                    {purchases.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-3 font-bold text-brand-purple">{p.purchase_number}</td>
                        <td className="px-4 py-3">{formatDate(p.purchase_date)}</td>
                        <td className="px-4 py-3 font-semibold">{p.supplier_name}</td>
                        <td className="px-4 py-3">
                          {p.items.map((i: any) => `${i.material_name} (${formatQty(i.quantity)} ${i.unit_symbol} @ ${formatINR(i.unit_rate)})`).join(", ")}
                        </td>
                        <td className="px-4 py-3 font-bold">{formatINR(p.total_amount)}</td>
                        <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 7. PRODUCTION OVERVIEW */}
          {section === "production" && (
            <div className="space-y-4">
              <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                Factory Production Overview
              </h1>
              <div className="sf-card overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                    <tr>
                      <th className="px-4 py-3 font-bold">Run No</th>
                      <th className="px-4 py-3 font-bold">Date</th>
                      <th className="px-4 py-3 font-bold">Product</th>
                      <th className="px-4 py-3 font-bold">Good / Expected</th>
                      <th className="px-4 py-3 font-bold">Yield Var</th>
                      <th className="px-4 py-3 font-bold">Total Cost</th>
                      <th className="px-4 py-3 font-bold">Cost / Pkt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sf-border">
                    {prodRuns.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-bold text-brand-purple">{r.run_number}</td>
                        <td className="px-4 py-3">{formatDate(r.run_date)}</td>
                        <td className="px-4 py-3 font-semibold">{r.product_name} ({r.product_pack_size})</td>
                        <td className="px-4 py-3">{formatQty(r.actual_good_output_qty)} / {formatQty(r.expected_output_qty)}</td>
                        <td className="px-4 py-3"><StatusBadge status={r.has_variance_flag ? "FLAGGED" : "OK"} label={`${r.yield_variance_pct}%`} /></td>
                        <td className="px-4 py-3">{formatINR(r.total_production_cost)}</td>
                        <td className="px-4 py-3 font-bold text-brand-magenta">{formatINR(r.cost_per_good_packet)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 8. BILLING & GST INVOICES */}
          {section === "invoices" && (
            <div className="space-y-4">
              <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                Billing & GST Tax Invoices
              </h1>
              <div className="sf-card overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                    <tr>
                      <th className="px-4 py-3 font-bold">Invoice No</th>
                      <th className="px-4 py-3 font-bold">Date</th>
                      <th className="px-4 py-3 font-bold">Customer</th>
                      <th className="px-4 py-3 font-bold">Tax Type</th>
                      <th className="px-4 py-3 font-bold">Taxable</th>
                      <th className="px-4 py-3 font-bold">CGST / SGST / IGST</th>
                      <th className="px-4 py-3 font-bold">Total</th>
                      <th className="px-4 py-3 font-bold">Outstanding</th>
                      <th className="px-4 py-3 font-bold">Dispatch</th>
                      <th className="px-4 py-3 font-bold">PDF</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sf-border">
                    {invoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-4 py-3 font-bold text-brand-purple whitespace-nowrap">{inv.invoice_number}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDate(inv.invoice_date)}</td>
                        <td className="px-4 py-3">
                          <p className="font-semibold">{inv.customer_name}</p>
                          <p className="text-[11px] text-sf-muted">{inv.customer_state}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusBadge status={inv.is_inter_state ? "INVOICED" : "APPROVED"} label={inv.is_inter_state ? "IGST 5%" : "CGST+SGST"} />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatINR(inv.taxable_total)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {inv.is_inter_state
                            ? `IGST ${formatINR(inv.igst_total)}`
                            : `C:${formatINR(inv.cgst_total)} S:${formatINR(inv.sgst_total)}`}
                        </td>
                        <td className="px-4 py-3 font-bold whitespace-nowrap">{formatINR(inv.grand_total)}</td>
                        <td className="px-4 py-3 font-bold text-brand-magenta whitespace-nowrap">{formatINR(inv.outstanding_amount)}</td>
                        <td className="px-4 py-3"><StatusBadge status={inv.dispatch_status} /></td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() =>
                                downloadAuthenticatedFile(
                                  `/sales/invoices/${inv.id}/pdf/`,
                                  `${inv.invoice_number.replace(/\//g, "-")}.pdf`
                                )
                              }
                              className="sf-btn-purple py-1 px-2.5 text-[11px]"
                            >
                              <Download className="h-3 w-3" /> PDF
                            </button>
                            <a
                              href={`https://wa.me/${(inv.customer_phone || "").replace(/[^0-9]/g, "")}?text=${encodeURIComponent(
                                `FactoraX GST Invoice ${inv.invoice_number} for ${inv.customer_name}\nDate: ${inv.invoice_date}\nTaxable: Rs.${inv.taxable_total}\nTotal: Rs.${inv.grand_total}\nOutstanding: Rs.${inv.outstanding_amount}`
                              )}`}
                              target="_blank"
                              rel="noreferrer"
                              title="Share via WhatsApp"
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100"
                            >
                              <MessageCircle className="h-3 w-3" /> WA
                            </a>
                            <a
                              href={`mailto:${inv.customer_email || ""}?subject=${encodeURIComponent(
                                `GST Invoice ${inv.invoice_number} - ${inv.seller_name}`
                              )}&body=${encodeURIComponent(
                                `Dear ${inv.customer_name},\n\nPlease find your GST Tax Invoice details:\nInvoice No: ${inv.invoice_number}\nDate: ${inv.invoice_date}\nTaxable Amount: Rs.${inv.taxable_total}\nTotal Amount: Rs.${inv.grand_total}\nBalance Outstanding: Rs.${inv.outstanding_amount}\n\nThank you,\n${inv.seller_name}`
                              )}`}
                              title="Share via Email"
                              className="sf-btn-secondary py-1 px-2 text-[11px]"
                            >
                              <Mail className="h-3 w-3" />
                            </a>
                            {Number(inv.grand_total) - Number(inv.credit_notes_total || 0) > 0 && (
                              <button
                                onClick={() => {
                                  setCnInvoice(inv);
                                  setCnForm({
                                    amount: String(
                                      (Number(inv.grand_total) - Number(inv.credit_notes_total || 0)).toFixed(2)
                                    ),
                                    reason: "",
                                    restock_finished_goods: false,
                                  });
                                }}
                                title="Issue Credit Note (cancel/adjust without deleting posted invoice)"
                                className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-100"
                              >
                                <FileMinus2 className="h-3 w-3" /> CN
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 9. DISPATCH */}
          {section === "dispatch" && (
            <div className="space-y-5">
              <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                Dispatch & Stock Release
              </h1>
              <div className="sf-card overflow-hidden">
                <div className="px-5 py-3 border-b border-sf-border bg-brand-pink/50 font-display text-sm font-bold text-brand-purple">
                  Invoices Pending Dispatch
                </div>
                <div className="divide-y divide-sf-border">
                  {invoices.filter((i) => i.dispatch_status !== "DISPATCHED").length === 0 ? (
                    <p className="p-5 text-xs text-sf-muted">All generated invoices have been dispatched.</p>
                  ) : (
                    invoices
                      .filter((i) => i.dispatch_status !== "DISPATCHED")
                      .map((inv) => (
                        <div key={inv.id} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                          <div>
                            <p className="font-bold text-brand-purple">
                              {inv.invoice_number} · {inv.customer_name}
                            </p>
                            <p className="text-sf-muted">
                              {inv.items.map((it) => `${it.product_name}: rem ${formatQty(it.remaining_qty)}`).join(" | ")}
                            </p>
                          </div>
                          <button onClick={() => setDispatchModal(inv)} className="sf-btn-primary py-1.5 text-xs">
                            <Truck className="h-3.5 w-3.5" /> Confirm Dispatch
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>

              <div className="sf-card overflow-x-auto">
                <div className="px-5 py-3 border-b border-sf-border bg-brand-pink/50 font-display text-sm font-bold text-brand-purple">
                  Completed Dispatch Register
                </div>
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                    <tr>
                      <th className="px-4 py-3 font-bold">Dispatch No</th>
                      <th className="px-4 py-3 font-bold">Date</th>
                      <th className="px-4 py-3 font-bold">Invoice</th>
                      <th className="px-4 py-3 font-bold">Customer</th>
                      <th className="px-4 py-3 font-bold">Vehicle / Transporter</th>
                      <th className="px-4 py-3 font-bold">Dispatched By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sf-border">
                    {dispatches.map((d) => (
                      <tr key={d.id}>
                        <td className="px-4 py-3 font-bold text-brand-purple">{d.dispatch_number}</td>
                        <td className="px-4 py-3">{formatDate(d.dispatch_date)}</td>
                        <td className="px-4 py-3">{d.invoice_number}</td>
                        <td className="px-4 py-3 font-semibold">{d.customer_name}</td>
                        <td className="px-4 py-3">{d.vehicle_no || "—"} {d.transporter ? `· ${d.transporter}` : ""}</td>
                        <td className="px-4 py-3">{d.dispatched_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 10. PAYMENTS & RECEIVABLES */}
          {section === "payments" && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                  Payments & Customer Receivables
                </h1>
                <button
                  onClick={() => {
                    setEditingPaymentId(null);
                    setPayForm({
                      customer: "",
                      customer_text: "",
                      invoice: "",
                      amount: "",
                      payment_status: "NO_PENDING_DUE",
                      pending_amount: "",
                      payment_date: getLocalDateInputValue(),
                      payment_mode: "UPI",
                      reference_number: "",
                      notes: "",
                    });
                    setPaymentModal(true);
                  }}
                  className="sf-btn-primary text-xs"
                >
                  <Plus className="h-4 w-4" /> Record Payment
                </button>
              </div>

              {receivables && (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                  <KpiCard label="Total Outstanding" value={formatINR(receivables.total_outstanding)} tone="magenta" />
                  <KpiCard label="0–30 Days" value={formatINR(receivables.ageing_buckets["0_30"])} />
                  <KpiCard label="31–60 Days" value={formatINR(receivables.ageing_buckets["31_60"])} />
                  <KpiCard label="61–90 Days" value={formatINR(receivables.ageing_buckets["61_90"])} />
                  <KpiCard label="90+ Days" value={formatINR(receivables.ageing_buckets["90_plus"])} tone="danger" />
                </div>
              )}

              {/* Filter Pills: Separate Pending vs Non-Pending Payments */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { key: "ALL", label: `All Payments (${payments.length})` },
                      {
                        key: "PENDING_DUE",
                        label: `Pending Due (${
                          payments.filter((p) => p.payment_status === "PENDING_DUE" || Number(p.pending_amount) > 0).length
                        })`,
                      },
                      {
                        key: "NO_PENDING_DUE",
                        label: `No Pending Due (${
                          payments.filter((p) => p.payment_status !== "PENDING_DUE" && Number(p.pending_amount) <= 0).length
                        })`,
                      },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setPaymentFilter(tab.key)}
                      className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                        paymentFilter === tab.key
                          ? "bg-brand-purple text-white shadow-sm"
                          : "bg-sf-surface border border-sf-border text-sf-text hover:bg-brand-pink"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sf-card overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-brand-pink/70 border-b border-sf-border text-brand-purple uppercase">
                    <tr>
                      <th className="px-4 py-3 font-bold">Payment No</th>
                      <th className="px-4 py-3 font-bold">Date</th>
                      <th className="px-4 py-3 font-bold">Customer</th>
                      <th className="px-4 py-3 font-bold">Mode</th>
                      <th className="px-4 py-3 font-bold">Ref No</th>
                      <th className="px-4 py-3 font-bold">Paid</th>
                      <th className="px-4 py-3 font-bold">Pending Status</th>
                      <th className="px-4 py-3 font-bold">Pending Due</th>
                      <th className="px-4 py-3 font-bold">Allocated To</th>
                      <th className="px-4 py-3 font-bold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sf-border">
                    {payments
                      .filter((p) => {
                        const isPend = p.payment_status === "PENDING_DUE" || Number(p.pending_amount) > 0;
                        if (paymentFilter === "PENDING_DUE") return isPend;
                        if (paymentFilter === "NO_PENDING_DUE") return !isPend;
                        return true;
                      })
                      .map((p) => {
                        const isPend = p.payment_status === "PENDING_DUE" || Number(p.pending_amount) > 0;
                        return (
                          <tr key={p.id} className="hover:bg-brand-pink/35">
                            <td className="px-4 py-3 font-bold text-brand-purple whitespace-nowrap">{p.payment_number}</td>
                            <td className="px-4 py-3 whitespace-nowrap">{formatDate(p.payment_date)}</td>
                            <td className="px-4 py-3 font-semibold">{p.customer_name}</td>
                            <td className="px-4 py-3"><StatusBadge status="APPROVED" label={p.payment_mode} /></td>
                            <td className="px-4 py-3 font-mono">{p.reference_number || "—"}</td>
                            <td className="px-4 py-3 font-bold text-sf-success whitespace-nowrap">{formatINR(p.amount)}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <StatusBadge
                                status={isPend ? "PENDING_APPROVAL" : "CONFIRMED"}
                                label={isPend ? "PENDING DUE" : "NO PENDING DUE"}
                              />
                            </td>
                            <td className={`px-4 py-3 font-extrabold whitespace-nowrap ${isPend ? "text-brand-magenta" : "text-sf-muted"}`}>
                              {formatINR(p.pending_amount || 0)}
                            </td>
                            <td className="px-4 py-3">
                              {p.allocations.length > 0
                                ? p.allocations
                                    .map((a: any) => `${a.invoice_number} (${formatINR(a.allocated_amount)})`)
                                    .join(", ")
                                : "Manual / Direct"}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingPaymentId(p.id);
                                    setPayForm({
                                      customer: String(p.customer),
                                      customer_text: p.customer_name || "",
                                      invoice: p.allocations?.[0]?.invoice
                                        ? String(p.allocations[0].invoice)
                                        : "",
                                      amount: String(p.amount),
                                      payment_status: isPend ? "PENDING_DUE" : "NO_PENDING_DUE",
                                      pending_amount: isPend ? String(p.pending_amount || "") : "",
                                      payment_date: p.payment_date || getLocalDateInputValue(),
                                      payment_mode: p.payment_mode || "UPI",
                                      reference_number: p.reference_number || "",
                                      notes: p.notes || "",
                                    });
                                    setPaymentModal(true);
                                  }}
                                  className="sf-btn-secondary py-1 px-2 text-[11px]"
                                  title="Edit payment"
                                >
                                  <Pencil className="h-3 w-3" /> Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (
                                      !window.confirm(
                                        `Remove payment ${p.payment_number} (${formatINR(p.amount)})? This will restore the customer's outstanding balance.`
                                      )
                                    ) {
                                      return;
                                    }
                                    try {
                                      await api.delete(`/sales/payments/${p.id}/`);
                                      showToast(`Removed payment ${p.payment_number} (logged in audit trail).`);
                                      loadSection();
                                    } catch (err) {
                                      setError(extractErrorMessage(err));
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100"
                                  title="Remove payment"
                                >
                                  <Trash2 className="h-3 w-3" /> Remove
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 12. SETTINGS & USERS */}
          {section === "settings" && companySetting && (
            <div className="space-y-6">
              <h1 className="font-display text-2xl font-extrabold text-brand-purple">
                Factory Settings & User Roles
              </h1>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    const res = await api.patch("/auth/company-settings/", companySetting);
                    setCompanySetting(res.data);
                    showToast("Factory settings saved.");
                  } catch (err) {
                    setError(extractErrorMessage(err));
                  }
                }}
                className="sf-card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
              >
                <div>
                  <label className="sf-label">Company Name</label>
                  <input
                    className="sf-input"
                    value={companySetting.company_name}
                    onChange={(e) => setCompanySetting({ ...companySetting, company_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="sf-label">Seller GSTIN</label>
                  <input
                    className="sf-input"
                    value={companySetting.gstin}
                    onChange={(e) => setCompanySetting({ ...companySetting, gstin: e.target.value })}
                  />
                </div>
                <div>
                  <label className="sf-label">Seller State</label>
                  <input
                    className="sf-input"
                    value={companySetting.state}
                    onChange={(e) => setCompanySetting({ ...companySetting, state: e.target.value })}
                  />
                </div>
                <div>
                  <label className="sf-label">Invoice Prefix</label>
                  <input
                    className="sf-input"
                    value={companySetting.invoice_prefix}
                    onChange={(e) => setCompanySetting({ ...companySetting, invoice_prefix: e.target.value })}
                  />
                </div>
                <div>
                  <label className="sf-label">Financial Year</label>
                  <input
                    className="sf-input"
                    value={companySetting.financial_year}
                    onChange={(e) => setCompanySetting({ ...companySetting, financial_year: e.target.value })}
                  />
                </div>
                <div>
                  <label className="sf-label">Variance Tolerance (%)</label>
                  <input
                    type="number"
                    step="0.5"
                    className="sf-input"
                    value={companySetting.variance_tolerance_pct}
                    onChange={(e) =>
                      setCompanySetting({ ...companySetting, variance_tolerance_pct: e.target.value })
                    }
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
                  <button type="submit" className="sf-btn-primary">
                    Save Company Configuration
                  </button>
                </div>
              </form>

              <div className="sf-card overflow-x-auto">
                <div className="px-5 py-3 border-b border-sf-border bg-brand-pink/50 font-display text-sm font-bold text-brand-purple">
                  Registered System Users
                </div>
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-sf-bg border-b border-sf-border text-sf-muted uppercase">
                    <tr>
                      <th className="px-4 py-2.5 font-bold">Username</th>
                      <th className="px-4 py-2.5 font-bold">Name</th>
                      <th className="px-4 py-2.5 font-bold">Email</th>
                      <th className="px-4 py-2.5 font-bold">Role</th>
                      <th className="px-4 py-2.5 font-bold">Territory</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sf-border">
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className="px-4 py-2.5 font-bold text-brand-purple">{u.username}</td>
                        <td className="px-4 py-2.5 font-semibold">{u.full_name}</td>
                        <td className="px-4 py-2.5">{u.email}</td>
                        <td className="px-4 py-2.5"><StatusBadge status="INVOICED" label={u.role} /></td>
                        <td className="px-4 py-2.5 text-sf-muted">{u.territory || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Edit Pending Order Quantities & Prices Modal (PDF Sec 4.2) */}
      <Modal
        open={Boolean(editOrder)}
        onClose={() => setEditOrder(null)}
        title={editOrder ? `Edit Pending Order — ${editOrder.order_number}` : "Edit Order"}
        wide
      >
        {editOrder && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.patch(`/sales/orders/${editOrder.id}/`, {
                  delivery_notes: editNotes,
                  items: editItems.map((it) => ({
                    product: it.product,
                    quantity: it.quantity,
                    unit_price: it.unit_price,
                  })),
                });
                setEditOrder(null);
                showToast(`Updated ${editOrder.order_number} (change recorded in audit log).`);
                loadSection();
              } catch (err) {
                setError(extractErrorMessage(err));
              }
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              {editItems.map((it, idx) => (
                <div key={it.product} className="grid grid-cols-12 gap-2 items-center rounded-xl bg-brand-pink/40 p-2.5">
                  <div className="col-span-6 text-xs font-bold text-brand-purple">{it.product_name}</div>
                  <div className="col-span-3">
                    <label className="text-[10px] font-bold text-sf-muted">Qty</label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      required
                      value={it.quantity}
                      onChange={(e) =>
                        setEditItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, quantity: e.target.value } : row))
                        )
                      }
                      className="sf-input py-1.5 text-xs"
                    />
                  </div>
                  <div className="col-span-3">
                    <label className="text-[10px] font-bold text-sf-muted">Rate (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={it.unit_price}
                      onChange={(e) =>
                        setEditItems((prev) =>
                          prev.map((row, i) => (i === idx ? { ...row, unit_price: e.target.value } : row))
                        )
                      }
                      className="sf-input py-1.5 text-xs"
                    />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <label className="sf-label">Delivery Notes</label>
              <input className="sf-input" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditOrder(null)} className="sf-btn-secondary">Cancel</button>
              <button type="submit" className="sf-btn-primary">Save Order Changes</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Issue Credit Note Modal (PDF Sec 7: Posted invoices cancelled via Credit Note, never deleted) */}
      <Modal
        open={Boolean(cnInvoice)}
        onClose={() => setCnInvoice(null)}
        title={cnInvoice ? `Issue Credit Note — ${cnInvoice.invoice_number}` : "Credit Note"}
      >
        {cnInvoice && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const res = await api.post(`/sales/invoices/${cnInvoice.id}/credit-note/`, cnForm);
                setCnInvoice(null);
                showToast(`Issued ${res.data.credit_note_number} for ${formatINR(res.data.amount)} (invoice preserved for audit).`);
                loadSection();
              } catch (err) {
                setError(extractErrorMessage(err));
              }
            }}
            className="space-y-3"
          >
            <p className="text-xs text-sf-muted">
              Posted GST invoices are never deleted. Issue an audit-tracked Credit Note to cancel or adjust{" "}
              <strong>{cnInvoice.invoice_number}</strong> ({cnInvoice.customer_name}).
            </p>
            <div>
              <label className="sf-label">Credit Amount (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                className="sf-input"
                value={cnForm.amount}
                onChange={(e) => setCnForm({ ...cnForm, amount: e.target.value })}
              />
            </div>
            <div>
              <label className="sf-label">Reason (Mandatory for Audit Trail)</label>
              <textarea
                required
                rows={2}
                className="sf-input"
                placeholder="e.g. Damaged consignment / invoice cancellation / rate correction"
                value={cnForm.reason}
                onChange={(e) => setCnForm({ ...cnForm, reason: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-medium text-sf-text cursor-pointer">
              <input
                type="checkbox"
                checked={cnForm.restock_finished_goods}
                onChange={(e) => setCnForm({ ...cnForm, restock_finished_goods: e.target.checked })}
                className="rounded text-brand-magenta"
              />
              Restock dispatched finished goods back into Stock Ledger (RETURN movement)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setCnInvoice(null)} className="sf-btn-secondary">Cancel</button>
              <button type="submit" className="sf-btn-primary">Issue Credit Note</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Stock Check & Approval Modal */}
      <Modal
        open={Boolean(stockCheckOrder)}
        onClose={() => setStockCheckOrder(null)}
        title={stockCheckOrder ? `Live Stock Check — ${stockCheckOrder.order.order_number}` : "Stock Check"}
      >
        {stockCheckOrder && (
          <div className="space-y-4 text-xs">
            <p className="text-sf-muted">
              Customer: <strong className="text-brand-purple">{stockCheckOrder.order.customer_name}</strong> ({stockCheckOrder.order.customer_state})
            </p>
            <div className="rounded-xl border border-sf-border divide-y divide-sf-border">
              {stockCheckOrder.check.items.map((item: any) => (
                <div key={item.order_item_id} className="p-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-bold text-sf-text">{item.product_name}</p>
                    <p className="text-sf-muted">
                      Ordered: {formatQty(item.ordered_qty)} · Available: {formatQty(item.available_stock)} {item.unit_symbol}
                    </p>
                  </div>
                  {item.is_sufficient ? (
                    <StatusBadge status="IN_STOCK" label="OK" />
                  ) : (
                    <StatusBadge status="OUT_OF_STOCK" label={`Short by ${formatQty(item.shortage_qty)}`} />
                  )}
                </div>
              ))}
            </div>
            {!stockCheckOrder.check.is_sufficient && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-red-800 font-semibold">
                Approval blocked: insufficient finished goods inventory. Produce additional stock before approving.
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setStockCheckOrder(null)} className="sf-btn-secondary">
                Close
              </button>
              <button
                disabled={!stockCheckOrder.check.is_sufficient}
                onClick={() => handleApproveOrder(stockCheckOrder.order.id)}
                className="sf-btn-primary"
              >
                Approve Order
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reject Order Modal */}
      <Modal open={Boolean(rejectOrder)} onClose={() => setRejectOrder(null)} title="Reject Order">
        <form onSubmit={handleRejectOrder} className="space-y-4">
          <p className="text-xs text-sf-muted">
            Provide a reason for rejecting <strong>{rejectOrder?.order_number}</strong>:
          </p>
          <textarea
            required
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="e.g. Insufficient stock / credit hold / duplicate order"
            className="sf-input"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRejectOrder(null)} className="sf-btn-secondary">Cancel</button>
            <button type="submit" className="inline-flex items-center gap-1.5 rounded-xl bg-sf-danger px-4 py-2 text-xs font-bold text-white">
              <XCircle className="h-4 w-4" /> Confirm Reject
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Customer Modal */}
      <Modal open={custModal} onClose={() => setCustModal(false)} title="Add Customer">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post("/masters/customers/", newCust);
              setCustModal(false);
              showToast("Customer created.");
              loadSection();
            } catch (err) {
              setError(extractErrorMessage(err));
            }
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div><label className="sf-label">Code</label><input required className="sf-input" placeholder="CUST-005" value={newCust.code} onChange={(e) => setNewCust({ ...newCust, code: e.target.value })} /></div>
            <div><label className="sf-label">Type</label><select className="sf-input" value={newCust.customer_type} onChange={(e) => setNewCust({ ...newCust, customer_type: e.target.value })}><option value="RETAILER">Retailer</option><option value="DISTRIBUTOR">Distributor</option><option value="WHOLESALER">Wholesaler</option><option value="SUPERMARKET">Supermarket</option></select></div>
          </div>
          <div><label className="sf-label">Customer Name</label><input required className="sf-input" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="sf-label">State</label><input required className="sf-input" value={newCust.state} onChange={(e) => setNewCust({ ...newCust, state: e.target.value })} /></div>
            <div><label className="sf-label">GSTIN</label><input className="sf-input" value={newCust.gstin} onChange={(e) => setNewCust({ ...newCust, gstin: e.target.value })} /></div>
          </div>
          <div><label className="sf-label">Phone</label><input className="sf-input" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} /></div>
          <div><label className="sf-label">Address</label><textarea className="sf-input" rows={2} value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} /></div>
          <button type="submit" className="w-full sf-btn-primary">Create Customer</button>
        </form>
      </Modal>

      {/* Add / Edit Product Modal (with Thumbnail Upload & Quick-Pick Gallery) */}
      <Modal
        open={prodModal}
        onClose={() => {
          setProdModal(false);
          setEditingProdId(null);
        }}
        title={editingProdId ? "Edit Finished Product" : "Add Finished Product"}
        wide
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              const payload = { ...newProd, unit: Number(newProd.unit) };
              if (editingProdId) {
                await api.patch(`/masters/products/${editingProdId}/`, payload);
                showToast(`Updated product "${newProd.name}".`);
              } else {
                await api.post("/masters/products/", payload);
                showToast(`Product "${newProd.name}" created. Record opening stock or a production run to add inventory.`);
              }
              setProdModal(false);
              setEditingProdId(null);
              loadSection();
            } catch (err) {
              setError(extractErrorMessage(err));
            }
          }}
          className="space-y-4"
        >
          {/* Product Thumbnail Picker + Upload */}
          <div className="rounded-2xl border border-sf-border bg-brand-pink/40 p-3.5 space-y-3">
            <label className="sf-label mb-0">Product Thumbnail Image</label>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <img
                src={newProd.image_url || "/products/murukku.jpg"}
                alt="Preview"
                className="h-20 w-20 rounded-2xl object-cover border-2 border-brand-magenta/40 bg-white shrink-0 shadow-sm"
              />
              <div className="flex-1 w-full space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sf-btn-purple py-1.5 px-3 text-xs cursor-pointer">
                    <Upload className="h-3.5 w-3.5" />
                    {uploadingProdImg ? "Uploading..." : "Upload Image File"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      disabled={uploadingProdImg}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploadingProdImg(true);
                        try {
                          const fd = new FormData();
                          fd.append("image", file);
                          const res = await api.post("/masters/products/upload-image/", fd, {
                            headers: { "Content-Type": "multipart/form-data" },
                          });
                          setNewProd((prev) => ({ ...prev, image_url: res.data.image_url }));
                        } catch (err) {
                          setError(extractErrorMessage(err));
                        } finally {
                          setUploadingProdImg(false);
                        }
                      }}
                    />
                  </label>
                  <span className="text-[11px] text-sf-muted">or quick-pick:</span>
                  {[
                    { label: "Murukku", url: "/products/murukku.jpg" },
                    { label: "Mixture", url: "/products/mixture.jpg" },
                    { label: "Chips", url: "/products/chips.jpg" },
                    { label: "Sweets", url: "/products/sweets.jpg" },
                  ].map((preset) => (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => setNewProd((prev) => ({ ...prev, image_url: preset.url }))}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold transition ${
                        newProd.image_url === preset.url
                          ? "border-brand-magenta bg-brand-magenta text-white"
                          : "border-sf-border bg-white text-sf-text hover:bg-brand-pink"
                      }`}
                    >
                      <img src={preset.url} alt="" className="h-4 w-4 rounded object-cover" />
                      {preset.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Or paste image URL (e.g. /products/chips.jpg or https://...)"
                  className="sf-input py-1.5 text-xs"
                  value={newProd.image_url}
                  onChange={(e) => setNewProd({ ...newProd, image_url: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className="sf-label">SKU</label><input required className="sf-input" value={newProd.sku} onChange={(e) => setNewProd({ ...newProd, sku: e.target.value })} /></div>
            <div>
              <label className="sf-label">Category</label>
              <select
                className="sf-input"
                value={newProd.category}
                onChange={(e) => {
                  const cat = e.target.value;
                  const defaultImg =
                    cat === "MIXTURE"
                      ? "/products/mixture.jpg"
                      : cat === "CHIPS"
                      ? "/products/chips.jpg"
                      : cat === "SWEETS"
                      ? "/products/sweets.jpg"
                      : "/products/murukku.jpg";
                  setNewProd((prev) => ({
                    ...prev,
                    category: cat,
                    image_url: prev.image_url.startsWith("/products/") ? defaultImg : prev.image_url,
                  }));
                }}
              >
                <option value="MURUKKU">Murukku</option>
                <option value="MIXTURE">Mixture</option>
                <option value="CHIPS">Chips</option>
                <option value="SWEETS">Sweets</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="sf-label">Product Name</label><input required className="sf-input" value={newProd.name} onChange={(e) => setNewProd({ ...newProd, name: e.target.value })} /></div>
            <div><label className="sf-label">HSN Code</label><input required className="sf-input" value={newProd.hsn_code} onChange={(e) => setNewProd({ ...newProd, hsn_code: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="sf-label">Pack Size</label><input className="sf-input" value={newProd.pack_size} onChange={(e) => setNewProd({ ...newProd, pack_size: e.target.value })} /></div>
            <div><label className="sf-label">Price (₹)</label><input type="number" step="0.01" required className="sf-input" value={newProd.selling_price} onChange={(e) => setNewProd({ ...newProd, selling_price: e.target.value })} /></div>
            <div><label className="sf-label">GST %</label><input type="number" step="0.5" className="sf-input" value={newProd.gst_rate} onChange={(e) => setNewProd({ ...newProd, gst_rate: e.target.value })} /></div>
          </div>
          <div>
            <label className="sf-label">Description (Shown in Salesman Store)</label>
            <input className="sf-input" placeholder="Crispy South Indian snack..." value={newProd.description} onChange={(e) => setNewProd({ ...newProd, description: e.target.value })} />
          </div>
          <button type="submit" className="w-full sf-btn-primary">
            {editingProdId ? "Update Product" : "Save Product"}
          </button>
        </form>
      </Modal>

      {/* Add Supplier Modal */}
      <Modal open={supplierModal} onClose={() => setSupplierModal(false)} title="Add Supplier">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post("/masters/suppliers/", newSup);
              setSupplierModal(false);
              showToast("Supplier created.");
              loadSection();
            } catch (err) {
              setError(extractErrorMessage(err));
            }
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div><label className="sf-label">Code</label><input required className="sf-input" placeholder="SUP-003" value={newSup.code} onChange={(e) => setNewSup({ ...newSup, code: e.target.value })} /></div>
            <div><label className="sf-label">State</label><input required className="sf-input" value={newSup.state} onChange={(e) => setNewSup({ ...newSup, state: e.target.value })} /></div>
          </div>
          <div><label className="sf-label">Supplier Name</label><input required className="sf-input" value={newSup.name} onChange={(e) => setNewSup({ ...newSup, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="sf-label">GSTIN</label><input className="sf-input" value={newSup.gstin} onChange={(e) => setNewSup({ ...newSup, gstin: e.target.value })} /></div>
            <div><label className="sf-label">Phone</label><input className="sf-input" value={newSup.phone} onChange={(e) => setNewSup({ ...newSup, phone: e.target.value })} /></div>
          </div>
          <button type="submit" className="w-full sf-btn-primary">Save Supplier</button>
        </form>
      </Modal>

      {/* Record Purchase Modal */}
      <Modal open={purchaseModal} onClose={() => setPurchaseModal(false)} title="Record & Confirm Purchase">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post("/purchases/", {
                supplier: Number(newPurchase.supplier),
                invoice_ref: newPurchase.invoice_ref,
                auto_confirm: true,
                items: [
                  {
                    material_type: newPurchase.material_type,
                    raw_material: newPurchase.material_type === "RAW" ? Number(newPurchase.material_id) : null,
                    packaging_material: newPurchase.material_type === "PACKAGING" ? Number(newPurchase.material_id) : null,
                    quantity: newPurchase.quantity,
                    unit_rate: newPurchase.unit_rate,
                  },
                ],
              });
              setPurchaseModal(false);
              showToast("Purchase confirmed & stock ledger updated.");
              loadSection();
            } catch (err) {
              setError(extractErrorMessage(err));
            }
          }}
          className="space-y-3"
        >
          <div>
            <label className="sf-label">Supplier</label>
            <select required className="sf-input" value={newPurchase.supplier} onChange={(e) => setNewPurchase({ ...newPurchase, supplier: e.target.value })}>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="sf-label">Supplier Invoice Ref</label>
            <input className="sf-input" placeholder="INV-2025-01" value={newPurchase.invoice_ref} onChange={(e) => setNewPurchase({ ...newPurchase, invoice_ref: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="sf-label">Material Type</label>
              <select
                className="sf-input"
                value={newPurchase.material_type}
                onChange={(e) => {
                  const mt = e.target.value;
                  const list = mt === "RAW" ? rawMats : pkgMats;
                  setNewPurchase({ ...newPurchase, material_type: mt, material_id: String(list[0]?.id || "") });
                }}
              >
                <option value="RAW">Raw Material</option>
                <option value="PACKAGING">Packaging Material</option>
              </select>
            </div>
            <div>
              <label className="sf-label">Material</label>
              <select className="sf-input" value={newPurchase.material_id} onChange={(e) => setNewPurchase({ ...newPurchase, material_id: e.target.value })}>
                {(newPurchase.material_type === "RAW" ? rawMats : pkgMats).map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.unit_symbol})</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="sf-label">Quantity</label><input type="number" step="0.01" required className="sf-input" value={newPurchase.quantity} onChange={(e) => setNewPurchase({ ...newPurchase, quantity: e.target.value })} /></div>
            <div><label className="sf-label">Unit Rate (₹)</label><input type="number" step="0.01" required className="sf-input" value={newPurchase.unit_rate} onChange={(e) => setNewPurchase({ ...newPurchase, unit_rate: e.target.value })} /></div>
          </div>
          <button type="submit" className="w-full sf-btn-primary">Confirm Receipt & Update Stock</button>
        </form>
      </Modal>

      {/* Controlled Stock Movement Modal */}
      <Modal open={adjModal} onClose={() => setAdjModal(false)} title="Record Opening Stock / Adjustment">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.post(`/inventory/${newAdj.mode}/`, {
                item_type: newAdj.item_type,
                item_id: Number(newAdj.item_id),
                quantity: newAdj.quantity,
                unit_cost: newAdj.unit_cost || undefined,
                notes: newAdj.notes,
              });
              setAdjModal(false);
              showToast("Stock ledger movement recorded.");
              loadSection();
            } catch (err) {
              setError(extractErrorMessage(err));
            }
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="sf-label">Movement Kind</label>
              <select className="sf-input" value={newAdj.mode} onChange={(e) => setNewAdj({ ...newAdj, mode: e.target.value })}>
                <option value="adjustments">Stock Adjustment (+/-)</option>
                <option value="opening-stock">Opening Stock (+)</option>
              </select>
            </div>
            <div>
              <label className="sf-label">Category</label>
              <select
                className="sf-input"
                value={newAdj.item_type}
                onChange={(e) => {
                  const t = e.target.value;
                  const first = t === "RAW" ? rawMats[0]?.id : t === "PACKAGING" ? pkgMats[0]?.id : products[0]?.id;
                  setNewAdj({ ...newAdj, item_type: t, item_id: String(first || "") });
                }}
              >
                <option value="FINISHED">Finished Goods</option>
                <option value="RAW">Raw Material</option>
                <option value="PACKAGING">Packaging Material</option>
              </select>
            </div>
          </div>
          <div>
            <label className="sf-label">Item</label>
            <select className="sf-input" value={newAdj.item_id} onChange={(e) => setNewAdj({ ...newAdj, item_id: e.target.value })}>
              {(newAdj.item_type === "RAW" ? rawMats : newAdj.item_type === "PACKAGING" ? pkgMats : products).map((m: any) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="sf-label">Quantity Delta</label><input type="number" step="0.01" required className="sf-input" value={newAdj.quantity} onChange={(e) => setNewAdj({ ...newAdj, quantity: e.target.value })} /></div>
            <div><label className="sf-label">Unit Cost (optional)</label><input type="number" step="0.01" className="sf-input" value={newAdj.unit_cost} onChange={(e) => setNewAdj({ ...newAdj, unit_cost: e.target.value })} /></div>
          </div>
          <div><label className="sf-label">Audit Reason / Notes</label><input required className="sf-input" value={newAdj.notes} onChange={(e) => setNewAdj({ ...newAdj, notes: e.target.value })} /></div>
          <button type="submit" className="w-full sf-btn-primary">Commit Ledger Movement</button>
        </form>
      </Modal>

      {/* Dispatch Modal */}
      <Modal
        open={Boolean(dispatchModal)}
        onClose={() => setDispatchModal(null)}
        title={dispatchModal ? `Dispatch — ${dispatchModal.invoice_number}` : "Dispatch"}
      >
        <form onSubmit={handleCreateDispatch} className="space-y-3">
          <div><label className="sf-label">Vehicle Number</label><input className="sf-input" placeholder="TN-45-BZ-4412" value={dispatchForm.vehicle_no} onChange={(e) => setDispatchForm({ ...dispatchForm, vehicle_no: e.target.value })} /></div>
          <div><label className="sf-label">Transporter</label><input className="sf-input" placeholder="Kaveri Cargo" value={dispatchForm.transporter} onChange={(e) => setDispatchForm({ ...dispatchForm, transporter: e.target.value })} /></div>
          <div><label className="sf-label">Notes</label><input className="sf-input" value={dispatchForm.notes} onChange={(e) => setDispatchForm({ ...dispatchForm, notes: e.target.value })} /></div>
          <button type="submit" className="w-full sf-btn-primary">Confirm Dispatch & Deduct Stock</button>
        </form>
      </Modal>

      {/* Record / Edit Payment Modal (Manual Customer Input + Pending Due / No Pending Due Toggle) */}
      <Modal
        open={paymentModal}
        onClose={() => {
          setPaymentModal(false);
          setEditingPaymentId(null);
        }}
        title={editingPaymentId ? "Edit Payment Entry" : "Record Customer Payment"}
      >
        {(() => {
          const customerInvs = invoices.filter(
            (i) =>
              String(i.customer) === payForm.customer &&
              (Number(i.outstanding_amount) > 0 || String(i.id) === payForm.invoice)
          );

          return (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError(null);
                try {
                  const statusPayload = {
                    payment_status: payForm.payment_status,
                    pending_amount:
                      payForm.payment_status === "PENDING_DUE"
                        ? payForm.pending_amount || "0.00"
                        : "0.00",
                  };

                  if (editingPaymentId) {
                    await api.patch(`/sales/payments/${editingPaymentId}/`, {
                      invoice: payForm.invoice ? Number(payForm.invoice) : null,
                      amount: payForm.amount,
                      payment_date: payForm.payment_date || undefined,
                      payment_mode: payForm.payment_mode,
                      reference_number: payForm.reference_number,
                      notes: payForm.notes,
                      ...statusPayload,
                    });
                    setPaymentModal(false);
                    setEditingPaymentId(null);
                    showToast("Payment updated cleanly (logged in audit trail).");
                    loadSection();
                    return;
                  }

                  let customerId = payForm.customer ? Number(payForm.customer) : null;
                  const typedName = payForm.customer_text.trim();
                  if (!customerId && typedName) {
                    const exactMatch = customers.find(
                      (c) => c.name.toLowerCase() === typedName.toLowerCase()
                    );
                    if (exactMatch) {
                      customerId = exactMatch.id;
                    } else {
                      const code = `CUST-${Date.now().toString().slice(-5)}`;
                      const createdCust = await api.post("/masters/customers/", {
                        code,
                        name: typedName,
                        customer_type: "RETAILER",
                        state: "Tamil Nadu",
                      });
                      customerId = createdCust.data.id;
                    }
                  }
                  if (!customerId) {
                    setError("Please enter a customer name.");
                    return;
                  }

                  await api.post("/sales/payments/", {
                    customer: customerId,
                    invoice: payForm.invoice ? Number(payForm.invoice) : null,
                    amount: payForm.amount,
                    payment_date: payForm.payment_date || undefined,
                    payment_mode: payForm.payment_mode,
                    reference_number: payForm.reference_number,
                    notes: payForm.notes,
                    ...statusPayload,
                  });
                  setPaymentModal(false);
                  showToast("Payment recorded and saved.");
                  loadSection();
                } catch (err) {
                  setError(extractErrorMessage(err));
                }
              }}
              className="space-y-3.5"
            >
              {/* Manual Customer Input (No dropdown) */}
              <div>
                <label className="sf-label">
                  Customer Name {editingPaymentId ? "(Locked on Edit)" : "(Type Customer Name)"}
                </label>
                <input
                  type="text"
                  required
                  list="sf-payment-customers"
                  disabled={Boolean(editingPaymentId)}
                  placeholder="Enter customer name (e.g. Retailer A - Sri Saravana Stores)"
                  className="sf-input"
                  value={payForm.customer_text}
                  onChange={(e) => {
                    const val = e.target.value;
                    const match = customers.find(
                      (c) => c.name.toLowerCase() === val.trim().toLowerCase()
                    );
                    const inv = match
                      ? invoices.find(
                          (i) => i.customer === match.id && Number(i.outstanding_amount) > 0
                        )
                      : undefined;
                    setPayForm({
                      ...payForm,
                      customer_text: val,
                      customer: match ? String(match.id) : "",
                      invoice: inv ? String(inv.id) : "",
                    });
                  }}
                />
                <datalist id="sf-payment-customers">
                  {customers.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
                {!editingPaymentId && payForm.customer_text.trim() && !payForm.customer && (
                  <p className="mt-1 text-[11px] font-semibold text-brand-magenta">
                    New customer "{payForm.customer_text.trim()}" will be added automatically on save.
                  </p>
                )}
              </div>

              {/* Amount Paid & Payment Mode */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="sf-label">Amount Paid (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="e.g. 4000"
                    className="sf-input"
                    value={payForm.amount}
                    onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  />
                </div>
                <div>
                  <label className="sf-label">Payment Mode</label>
                  <select
                    className="sf-input"
                    value={payForm.payment_mode}
                    onChange={(e) => setPayForm({ ...payForm, payment_mode: e.target.value })}
                  >
                    <option value="UPI">UPI</option>
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="CHEQUE">Cheque</option>
                  </select>
                </div>
              </div>

              {/* Pending Status Option: Pending Due vs No Pending Due */}
              <div className="rounded-2xl border border-sf-border bg-brand-pink/40 p-3.5 space-y-3">
                <label className="sf-label mb-0">Payment Due Status</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPayForm({
                        ...payForm,
                        payment_status: "NO_PENDING_DUE",
                        pending_amount: "0",
                      })
                    }
                    className={`rounded-xl py-2.5 px-3 text-xs font-extrabold border transition ${
                      payForm.payment_status === "NO_PENDING_DUE"
                        ? "bg-sf-success text-white border-sf-success shadow-sm"
                        : "bg-white text-sf-text border-sf-border hover:bg-emerald-50"
                    }`}
                  >
                    No Pending Due (Paid)
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPayForm({
                        ...payForm,
                        payment_status: "PENDING_DUE",
                      })
                    }
                    className={`rounded-xl py-2.5 px-3 text-xs font-extrabold border transition ${
                      payForm.payment_status === "PENDING_DUE"
                        ? "bg-brand-magenta text-white border-brand-magenta shadow-sm"
                        : "bg-white text-sf-text border-sf-border hover:bg-brand-pink"
                    }`}
                  >
                    Pending Due
                  </button>
                </div>

                {/* New Input Box Appears When Pending Due Is Selected */}
                {payForm.payment_status === "PENDING_DUE" && (
                  <div className="rounded-xl border border-brand-magenta/40 bg-white p-3 space-y-1.5">
                    <label className="sf-label mb-0 text-brand-magenta">
                      How Much Amount Is Still Pending? (₹)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      placeholder="Enter remaining pending due (e.g. 3875)"
                      className="sf-input border-brand-magenta/50"
                      value={payForm.pending_amount}
                      onChange={(e) => setPayForm({ ...payForm, pending_amount: e.target.value })}
                    />
                  </div>
                )}
              </div>

              {/* Optional Invoice Link when matching customer has unpaid invoice */}
              {customerInvs.length > 0 && (
                <div>
                  <label className="sf-label">Link to Invoice (Optional)</label>
                  <select
                    className="sf-input"
                    value={payForm.invoice}
                    onChange={(e) => setPayForm({ ...payForm, invoice: e.target.value })}
                  >
                    <option value="">Auto-allocate oldest unpaid invoice</option>
                    {customerInvs.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.invoice_number} — Balance Due {formatINR(i.outstanding_amount)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="sf-label">Payment Date</label>
                  <input
                    type="date"
                    required
                    className="sf-input"
                    value={payForm.payment_date}
                    onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="sf-label">Reference / UTR / Cheque No</label>
                  <input
                    className="sf-input"
                    placeholder="e.g. UPI-REF-99120"
                    value={payForm.reference_number}
                    onChange={(e) => setPayForm({ ...payForm, reference_number: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="sf-label">Remarks (Optional)</label>
                <input
                  className="sf-input"
                  placeholder="Part payment / final settlement note"
                  value={payForm.notes}
                  onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
                />
              </div>

              <button type="submit" className="w-full sf-btn-primary">
                {editingPaymentId ? "Update Payment Entry" : "Save Payment Entry"}
              </button>
            </form>
          );
        })()}
      </Modal>
    </DesktopShell>
  );
}
