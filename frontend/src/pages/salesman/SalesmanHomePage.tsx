import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Minus,
  Package,
  Plus,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { api, extractErrorMessage } from "../../api/client";
import { useCart } from "../../contexts/CartContext";
import { ErrorBanner, LoadingState, Modal, StatusBadge } from "../../components/ui";
import type { Customer, Product, SalesOrder } from "../../types/erp";
import { formatDate, formatINR, formatQty, unwrapList } from "../../utils/format";
import { SalesmanShell } from "./SalesmanShell";

const CATEGORY_LABELS: Record<string, string> = {
  FOR_YOU: "All FactoraX Snacks",
  MURUKKU: "Murukku",
  MIXTURE: "Mixture",
  CHIPS: "Chips",
  SWEETS: "Traditional Sweets",
};

const HERO_CARD_THEMES = [
  {
    bg: "bg-[#2C1046]",
    accent: "text-pink-200",
    badge: "bg-brand-magenta text-white",
    tag: "Factory Bestseller",
  },
  {
    bg: "bg-[#1A1625]",
    accent: "text-amber-300",
    badge: "bg-amber-500 text-slate-950",
    tag: "Spicy Crunch",
  },
  {
    bg: "bg-[#4A3219]",
    accent: "text-yellow-200",
    badge: "bg-yellow-400 text-slate-950",
    tag: "Golden Fresh",
  },
  {
    bg: "bg-[#7D1247]",
    accent: "text-pink-100",
    badge: "bg-white text-brand-purple",
    tag: "Pure Ghee Sweet",
  },
];

export default function SalesmanHomePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    selectedCustomer,
    setSelectedCustomer,
    items,
    addItem,
    updateQty,
    offlineQueue,
  } = useCart();

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [recentOrders, setRecentOrders] = useState<SalesOrder[]>([]);
  const [customerSales, setCustomerSales] = useState<
    Array<{
      customer_id: number;
      customer_name: string;
      customer_state: string;
      order_count: number;
      ordered_total: string;
      invoiced_total: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeCategory, setActiveCategory] = useState<string>(
    searchParams.get("category") || "FOR_YOU"
  );
  const [searchTerm, setSearchTerm] = useState<string>(searchParams.get("q") || "");
  const [customerModalOpen, setCustomerModalOpen] = useState(false);

  const heroScrollRef = useRef<HTMLDivElement | null>(null);

  const handleCategoryChange = (cat: string) => {
    setActiveCategory(cat);
    if (cat === "FOR_YOU") {
      searchParams.delete("category");
    } else {
      searchParams.set("category", cat);
    }
    setSearchParams(searchParams, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prodRes, custRes, ordRes, dashRes] = await Promise.all([
        api.get("/masters/products/", { params: { is_active: true, page_size: 100 } }),
        api.get("/masters/customers/", { params: { page_size: 100 } }),
        api.get("/sales/orders/", { params: { page_size: 10 } }),
        api.get("/reports/dashboard/salesman/"),
      ]);
      const prodList = unwrapList<Product>(prodRes.data);
      const custList = unwrapList<Customer>(custRes.data);
      const ordList = unwrapList<SalesOrder>(ordRes.data);
      setProducts(prodList);
      setCustomers(custList);
      setRecentOrders(ordList);
      setCustomerSales(dashRes.data?.customer_sales || []);
      if (!selectedCustomer && custList.length > 0) {
        setSelectedCustomer(custList[0]);
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [selectedCustomer, setSelectedCustomer]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const cartQtyMap = useMemo(() => {
    const map: Record<number, number> = {};
    items.forEach((i) => {
      map[i.product.id] = i.quantity;
    });
    return map;
  }, [items]);

  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return products.filter((p) => {
      const catOk = activeCategory === "FOR_YOU" || p.category === activeCategory;
      const qOk =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.pack_size.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q);
      return catOk && qOk;
    });
  }, [products, activeCategory, searchTerm]);

  const heroProducts = useMemo(() => {
    const preferredOrder = ["SF-MRK-200", "SF-MIX-200", "SF-CHP-150", "SF-SWT-250"];
    const picked: Product[] = [];
    for (const sku of preferredOrder) {
      const found = products.find((p) => p.sku === sku);
      if (found) picked.push(found);
    }
    for (const p of products) {
      if (picked.length >= 4) break;
      if (!picked.some((x) => x.id === p.id)) picked.push(p);
    }
    return picked;
  }, [products]);

  const isFilteredView = activeCategory !== "FOR_YOU" || searchTerm.trim().length > 0;

  const scrollHero = (dir: -1 | 1) => {
    heroScrollRef.current?.scrollBy({ left: dir * 320, behavior: "smooth" });
  };

  return (
    <SalesmanShell
      searchTerm={searchTerm}
      onSearchChange={setSearchTerm}
      activeCategory={activeCategory}
      onCategoryChange={handleCategoryChange}
      onOpenCustomerPicker={() => setCustomerModalOpen(true)}
    >
      <div className="space-y-6">
        {offlineQueue.length > 0 && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-xs sm:text-sm font-medium text-amber-900">
              <strong>{offlineQueue.length} offline order(s)</strong> saved locally — will sync when network returns.
            </p>
            <button
              onClick={() => navigate("/salesman/orders")}
              className="shrink-0 rounded-xl bg-amber-600 px-3.5 py-1.5 text-xs font-bold text-white"
            >
              Review &amp; Sync
            </button>
          </div>
        )}

        {error && <ErrorBanner message={error} onRetry={loadData} />}

        {loading ? (
          <LoadingState message="Loading live FactoraX catalog..." />
        ) : isFilteredView ? (
          /* =================================================================
             CATEGORY / SEARCH RESULTS VIEW (Shown Immediately at Top!)
             ================================================================= */
          <section className="sf-card p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-sf-border mb-5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    handleCategoryChange("FOR_YOU");
                    setSearchTerm("");
                  }}
                  className="sf-btn-secondary py-1.5 px-3 text-xs"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> All Products
                </button>
                <div>
                  <h1 className="font-display text-lg sm:text-xl font-extrabold text-brand-purple">
                    {CATEGORY_LABELS[activeCategory] || activeCategory}
                    {searchTerm.trim() ? ` matching "${searchTerm.trim()}"` : ""}
                  </h1>
                  <p className="text-xs text-sf-muted">
                    Showing {filteredProducts.length} snack item(s) · Ordering for{" "}
                    <strong className="text-brand-purple">
                      {selectedCustomer?.name || "Select customer"}
                    </strong>
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(["MURUKKU", "MIXTURE", "CHIPS", "SWEETS"] as const).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => handleCategoryChange(cat)}
                    className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                      activeCategory === cat
                        ? "bg-brand-magenta text-white"
                        : "bg-brand-pink text-brand-purple hover:bg-brand-purple hover:text-white"
                    }`}
                  >
                    {CATEGORY_LABELS[cat]}
                  </button>
                ))}
              </div>
            </div>

            {filteredProducts.length === 0 ? (
              <div className="py-12 text-center">
                <p className="text-sm font-semibold text-sf-muted">
                  No items found in {CATEGORY_LABELS[activeCategory] || activeCategory}.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    handleCategoryChange("FOR_YOU");
                    setSearchTerm("");
                  }}
                  className="mt-3 sf-btn-primary text-xs"
                >
                  Show All Snacks
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredProducts.map((p) => (
                  <CatalogProductCard
                    key={p.id}
                    product={p}
                    qtyInCart={cartQtyMap[p.id] || 0}
                    onAdd={() => addItem(p, 1)}
                    onUpdateQty={(q) => updateQty(p.id, q)}
                  />
                ))}
              </div>
            )}
          </section>
        ) : (
          /* =================================================================
             DEFAULT ALL-PRODUCTS STOREFRONT VIEW
             ================================================================= */
          <>
            {/* ROW 1: 5-CARD HERO SHOWCASE (Click card header/photo to filter category) */}
            <section className="relative">
              <button
                type="button"
                onClick={() => scrollHero(-1)}
                aria-label="Scroll left"
                className="hidden xl:flex absolute -left-3 top-1/2 -translate-y-1/2 z-20 h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow-elevated border border-sf-border text-brand-purple hover:bg-brand-pink"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => scrollHero(1)}
                aria-label="Scroll right"
                className="hidden xl:flex absolute -right-3 top-1/2 -translate-y-1/2 z-20 h-11 w-11 items-center justify-center rounded-full bg-white/95 shadow-elevated border border-sf-border text-brand-purple hover:bg-brand-pink"
              >
                <ChevronRight className="h-5 w-5" />
              </button>

              <div
                ref={heroScrollRef}
                className="flex gap-3.5 overflow-x-auto no-scrollbar snap-x snap-mandatory pb-1 lg:grid lg:grid-cols-5"
              >
                {heroProducts.map((p, idx) => {
                  const theme = HERO_CARD_THEMES[idx % HERO_CARD_THEMES.length];
                  const qtyInCart = cartQtyMap[p.id] || 0;
                  const stockNum = Number(p.available_stock);

                  return (
                    <div
                      key={p.id}
                      className={`snap-start w-[265px] sm:w-[275px] lg:w-auto shrink-0 rounded-2xl ${theme.bg} text-white p-4 flex flex-col justify-between shadow-card hover:shadow-elevated transition overflow-hidden`}
                    >
                      <button
                        type="button"
                        onClick={() => handleCategoryChange(p.category)}
                        className="text-left group"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-display text-xl sm:text-2xl font-extrabold tracking-tight">
                            {formatINR(p.selling_price).replace(".00", "")}
                            <span className="text-xs font-semibold text-white/75">/{p.unit_symbol}</span>
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${theme.badge}`}>
                            {theme.tag}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-bold text-white leading-snug line-clamp-1 group-hover:underline">
                          {p.name}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-white/80">
                          <span>{p.pack_size}</span>
                          <span>|</span>
                          <span className={theme.accent}>+{Number(p.gst_rate)}% GST</span>
                          <span>|</span>
                          <span className="font-semibold">
                            {stockNum > 0 ? `${formatQty(stockNum)} in stock` : "Out of stock"}
                          </span>
                        </div>

                        <div className="my-3.5 relative rounded-xl overflow-hidden bg-white aspect-[4/3] shadow-inner">
                          <img
                            src={p.image_url || "/products/murukku.jpg"}
                            alt={p.name}
                            className="h-full w-full object-cover group-hover:scale-105 transition duration-300"
                          />
                          <span className="absolute bottom-2 right-2 rounded-full bg-brand-purple/85 px-2.5 py-0.5 text-[10px] font-bold text-white">
                            View all {CATEGORY_LABELS[p.category]} →
                          </span>
                        </div>
                      </button>

                      <div className="rounded-xl bg-white text-sf-text p-2 shadow-sm">
                        {qtyInCart > 0 ? (
                          <div className="flex items-center justify-between px-1">
                            <button
                              type="button"
                              onClick={() => updateQty(p.id, qtyInCart - 1)}
                              className="h-7 w-7 flex items-center justify-center rounded-lg bg-brand-pink text-brand-magenta font-bold"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <span className="text-xs font-extrabold text-brand-purple">
                              {qtyInCart} in Cart
                            </span>
                            <button
                              type="button"
                              onClick={() => updateQty(p.id, qtyInCart + 1)}
                              className="h-7 w-7 flex items-center justify-center rounded-lg bg-brand-magenta text-white"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => addItem(p, 1)}
                            className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-brand-magenta hover:bg-brand-magentaDark text-white py-1.5 text-xs font-bold transition"
                          >
                            <ShoppingBag className="h-3.5 w-3.5" />
                            Add to Order
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Card 5: Shop by Category 2x2 Tile */}
                <div className="snap-start w-[265px] sm:w-[275px] lg:w-auto shrink-0 rounded-2xl bg-brand-magenta text-white p-4 flex flex-col justify-between shadow-card">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="h-4 w-4 text-pink-200" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-pink-100">
                        Browse by Snack
                      </span>
                    </div>
                    <h2 className="mt-0.5 font-display text-xl font-extrabold leading-tight">
                      Shop by category
                    </h2>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[
                      { cat: "MURUKKU", label: "Murukku", img: "/products/murukku.jpg" },
                      { cat: "MIXTURE", label: "Mixture", img: "/products/mixture.jpg" },
                      { cat: "CHIPS", label: "Chips", img: "/products/chips.jpg" },
                      { cat: "SWEETS", label: "Sweets", img: "/products/sweets.jpg" },
                    ].map((tile) => (
                      <button
                        key={tile.cat}
                        type="button"
                        onClick={() => handleCategoryChange(tile.cat)}
                        className="group rounded-xl bg-white p-1.5 text-left hover:ring-2 hover:ring-yellow-300 transition flex flex-col"
                      >
                        <div className="rounded-lg overflow-hidden aspect-square bg-brand-pink">
                          <img
                            src={tile.img}
                            alt={tile.label}
                            className="h-full w-full object-cover group-hover:scale-105 transition"
                          />
                        </div>
                        <span className="mt-1.5 inline-block self-start rounded bg-brand-purple px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                          {tile.label}
                        </span>
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => navigate("/salesman/cart")}
                    className="mt-3 w-full rounded-xl bg-white/15 hover:bg-white/25 py-2 text-xs font-bold text-white transition"
                  >
                    Go to Order Cart →
                  </button>
                </div>
              </div>
            </section>

            {/* ROW 2: STRICTLY PDF-REQUIRED SALESMAN OPERATIONAL CARDS (3 COLUMNS — NO EXTRA COLLECTIONS CARD) */}
            <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* 1. Selected Customer (PDF Sec 4.1: pick customer before ordering) */}
              <div className="sf-card p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display text-base font-extrabold text-brand-purple">
                      Selected Customer
                    </h3>
                    <button
                      type="button"
                      onClick={() => setCustomerModalOpen(true)}
                      className="text-xs font-bold text-brand-magenta hover:underline"
                    >
                      Change
                    </button>
                  </div>
                  {selectedCustomer ? (
                    <div className="space-y-2.5">
                      <div className="rounded-xl bg-brand-pink/70 border border-brand-pinkBorder p-3">
                        <p className="font-display text-sm font-extrabold text-brand-purple">
                          {selectedCustomer.name}
                        </p>
                        <p className="text-xs text-sf-muted mt-0.5">
                          {selectedCustomer.customer_type} · {selectedCustomer.state}
                        </p>
                        <p className="text-[11px] font-mono text-sf-muted mt-1">
                          GSTIN: {selectedCustomer.gstin || "Unregistered"}
                        </p>
                      </div>
                      <p className="text-xs text-sf-muted flex items-start gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-brand-magenta shrink-0 mt-0.5" />
                        <span className="line-clamp-2">{selectedCustomer.address || "Address on file"}</span>
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-sf-muted">Select a customer to begin ordering.</p>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => navigate("/salesman/customers")}
                    className="sf-btn-secondary py-2 text-xs"
                  >
                    <Users className="h-3.5 w-3.5" /> My Stores
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate("/salesman/cart")}
                    className="sf-btn-primary py-2 text-xs"
                  >
                    Checkout
                  </button>
                </div>
              </div>

              {/* 2. Recent Orders & Live Status (PDF Sec 4.1) */}
              <div className="sf-card p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display text-base font-extrabold text-brand-purple">
                      My Order Status
                    </h3>
                    <button
                      type="button"
                      onClick={() => navigate("/salesman/orders")}
                      className="text-xs font-bold text-brand-magenta hover:underline"
                    >
                      View all
                    </button>
                  </div>
                  <div className="space-y-2">
                    {recentOrders.length === 0 ? (
                      <p className="text-xs text-sf-muted py-4">No orders placed yet.</p>
                    ) : (
                      recentOrders.slice(0, 3).map((ord) => (
                        <button
                          key={ord.id}
                          type="button"
                          onClick={() => navigate("/salesman/orders")}
                          className="w-full rounded-xl border border-sf-border bg-sf-bg/60 hover:bg-brand-pink/50 p-2.5 text-left transition"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-extrabold text-brand-purple">
                              {ord.order_number}
                            </span>
                            <StatusBadge status={ord.status} />
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[11px] text-sf-muted">
                            <span className="truncate pr-2">{ord.customer_name}</span>
                            <span className="font-bold text-sf-text shrink-0">
                              {formatINR(ord.grand_total)}
                            </span>
                          </div>
                          <p className="text-[10px] text-sf-muted mt-0.5">{formatDate(ord.order_date)}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/salesman/orders")}
                  className="mt-4 w-full sf-btn-secondary py-2 text-xs"
                >
                  <Package className="h-3.5 w-3.5" /> Track Approvals &amp; Dispatches
                </button>
              </div>

              {/* 3. Customer-wise Sales (PDF Sec 4.1) */}
              <div className="sf-card p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-display text-base font-extrabold text-brand-purple">
                      My Customer-wise Sales
                    </h3>
                    <TrendingUp className="h-4 w-4 text-brand-magenta" />
                  </div>
                  <div className="space-y-2">
                    {customerSales.length === 0 ? (
                      <p className="text-xs text-sf-muted py-4">
                        Customer-wise totals appear once you place orders.
                      </p>
                    ) : (
                      customerSales.slice(0, 3).map((cs) => (
                        <div
                          key={cs.customer_id}
                          className="rounded-xl border border-sf-border bg-brand-pink/40 p-2.5 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-brand-purple truncate">
                              {cs.customer_name}
                            </span>
                            <span className="font-extrabold text-sf-success shrink-0">
                              {formatINR(cs.invoiced_total)}
                            </span>
                          </div>
                          <p className="text-[11px] text-sf-muted mt-0.5">
                            {cs.order_count} order(s) · Ordered {formatINR(cs.ordered_total)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate("/salesman/orders")}
                  className="mt-4 w-full sf-btn-purple py-2 text-xs"
                >
                  Open Full Sales Summary
                </button>
              </div>
            </section>

            {/* ROW 3: FULL PRODUCT CATALOG */}
            <section className="sf-card p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="font-display text-lg sm:text-xl font-extrabold text-brand-purple">
                    All FactoraX Packaged Foods
                  </h2>
                  <p className="text-xs text-sf-muted">
                    Click any category above (`Murukku`, `Mixture`, `Chips`, `Traditional Sweets`) to filter
                  </p>
                </div>
                <span className="rounded-full bg-brand-pink border border-brand-pinkBorder px-3 py-1 text-xs font-bold text-brand-purple">
                  {filteredProducts.length} product(s)
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5 sm:gap-4">
                {filteredProducts.map((p) => (
                  <CatalogProductCard
                    key={p.id}
                    product={p}
                    qtyInCart={cartQtyMap[p.id] || 0}
                    onAdd={() => addItem(p, 1)}
                    onUpdateQty={(q) => updateQty(p.id, q)}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {/* Customer Picker Modal */}
      <Modal
        open={customerModalOpen}
        onClose={() => setCustomerModalOpen(false)}
        title="Select Customer"
      >
        <div className="space-y-2.5">
          {customers.map((c) => {
            const active = selectedCustomer?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setSelectedCustomer(c);
                  setCustomerModalOpen(false);
                }}
                className={`w-full rounded-2xl border p-3.5 text-left transition ${
                  active
                    ? "border-brand-magenta bg-brand-pink"
                    : "border-sf-border bg-white hover:bg-sf-bg"
                }`}
              >
                <p className="text-sm font-bold text-brand-purple flex items-center gap-1.5">
                  {c.name}
                  {active && <CheckCircle2 className="h-4 w-4 text-brand-magenta" />}
                </p>
                <p className="text-xs text-sf-muted mt-0.5">
                  {c.customer_type} · {c.state} · GSTIN: {c.gstin || "Unregistered"}
                </p>
                {c.address && (
                  <p className="mt-1 text-[11px] text-sf-muted line-clamp-2">{c.address}</p>
                )}
              </button>
            );
          })}
        </div>
      </Modal>
    </SalesmanShell>
  );
}

function CatalogProductCard({
  product: p,
  qtyInCart,
  onAdd,
  onUpdateQty,
}: {
  product: Product;
  qtyInCart: number;
  onAdd: () => void;
  onUpdateQty: (qty: number) => void;
}) {
  const stockNum = Number(p.available_stock);
  const outOfStock = stockNum <= 0;

  return (
    <div className="rounded-2xl border border-sf-border bg-white overflow-hidden flex flex-col hover:shadow-elevated hover:border-brand-magenta/40 transition">
      <div className="relative aspect-square bg-brand-pink/40 overflow-hidden">
        <img
          src={p.image_url || "/products/murukku.jpg"}
          alt={p.name}
          className="h-full w-full object-cover hover:scale-105 transition duration-300"
        />
        <span
          className={`absolute top-2.5 left-2.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold shadow-sm ${
            outOfStock
              ? "bg-red-600 text-white"
              : p.stock_status === "LOW_STOCK"
              ? "bg-amber-500 text-white"
              : "bg-emerald-600 text-white"
          }`}
        >
          {outOfStock ? "Out of stock" : `${formatQty(stockNum)} ${p.unit_symbol} ready`}
        </span>
      </div>

      <div className="p-3.5 flex-1 flex flex-col justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-brand-magenta">
            {p.category} · {p.pack_size}
          </p>
          <h3 className="mt-0.5 text-sm font-bold text-sf-text line-clamp-2 leading-snug">
            {p.name}
          </h3>
          <p className="mt-1 text-[11px] text-sf-muted line-clamp-2">
            {p.description || "Authentic South Indian factory-fresh snack."}
          </p>
        </div>

        <div className="mt-3 pt-2.5 border-t border-sf-border/70">
          <div className="flex items-baseline justify-between mb-2.5">
            <span className="font-display text-lg font-extrabold text-brand-purple">
              {formatINR(p.selling_price)}
            </span>
            <span className="text-[11px] font-semibold text-sf-muted">
              +{Number(p.gst_rate)}% GST
            </span>
          </div>

          {qtyInCart > 0 ? (
            <div className="flex items-center justify-between rounded-xl border border-brand-magenta bg-brand-pink px-1.5 py-1">
              <button
                type="button"
                onClick={() => onUpdateQty(qtyInCart - 1)}
                className="h-8 w-8 flex items-center justify-center rounded-lg bg-white text-brand-magenta shadow-sm"
                aria-label="Decrease quantity"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="text-xs font-extrabold text-brand-purple">
                {qtyInCart} {p.unit_symbol}
              </span>
              <button
                type="button"
                onClick={() => onUpdateQty(qtyInCart + 1)}
                className="h-8 w-8 flex items-center justify-center rounded-lg bg-brand-magenta text-white shadow-sm"
                aria-label="Increase quantity"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button type="button" onClick={onAdd} className="w-full sf-btn-primary py-2 text-xs">
              <ShoppingBag className="h-3.5 w-3.5" />
              Add to Order
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
