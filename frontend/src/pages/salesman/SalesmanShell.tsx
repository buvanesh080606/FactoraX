import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  Home,
  LogOut,
  MapPin,
  PackageCheck,
  Search,
  ShoppingCart,
  User,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useCart } from "../../contexts/CartContext";
import { BrandLogo, NotificationBell } from "../../components/ui";

interface SalesmanShellProps {
  children: React.ReactNode;
  searchTerm?: string;
  onSearchChange?: (val: string) => void;
  activeCategory?: string;
  onCategoryChange?: (cat: string) => void;
  onOpenCustomerPicker?: () => void;
}

const SUBNAV_CATEGORIES = [
  { key: "FOR_YOU", label: "All Products" },
  { key: "MURUKKU", label: "Murukku" },
  { key: "MIXTURE", label: "Mixture" },
  { key: "CHIPS", label: "Chips" },
  { key: "SWEETS", label: "Traditional Sweets" },
];

export function SalesmanShell({
  children,
  searchTerm = "",
  onSearchChange,
  activeCategory = "FOR_YOU",
  onCategoryChange,
  onOpenCustomerPicker,
}: SalesmanShellProps) {
  const { user, logout } = useAuth();
  const { selectedCustomer, itemCount, isOnline, offlineQueue } = useCart();
  const navigate = useNavigate();
  const [localSearch, setLocalSearch] = useState(searchTerm);

  const handleSearchInput = (val: string) => {
    setLocalSearch(val);
    if (onSearchChange) onSearchChange(val);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSearchChange) {
      navigate(`/salesman/home?q=${encodeURIComponent(localSearch)}`);
    }
  };

  const handleCategorySelect = (key: string) => {
    if (onCategoryChange) {
      onCategoryChange(key);
    } else {
      navigate(`/salesman/home?category=${key}`);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  const mobileNavItems = [
    { to: "/salesman/home", label: "Home", icon: <Home className="h-5 w-5" /> },
    { to: "/salesman/orders", label: "Orders", icon: <PackageCheck className="h-5 w-5" /> },
    { to: "/salesman/customers", label: "Customers", icon: <Users className="h-5 w-5" /> },
    {
      to: "/salesman/cart",
      label: "Cart",
      icon: (
        <div className="relative">
          <ShoppingCart className="h-5 w-5" />
          {itemCount > 0 && (
            <span className="absolute -right-2.5 -top-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-magenta px-1 text-[10px] font-bold text-white">
              {itemCount > 99 ? "99+" : itemCount}
            </span>
          )}
        </div>
      ),
    },
    { to: "/salesman/more", label: "Account", icon: <User className="h-5 w-5" /> },
  ];

  return (
    <div className="min-h-screen bg-sf-bg text-sf-text flex flex-col pb-16 lg:pb-0">
      {/* PRIMARY AMAZON-STYLE TOP BAR (Deep Purple #351044) */}
      <header className="sticky top-0 z-40 bg-brand-purple text-white shadow-md">
        <div className="max-w-[1520px] mx-auto px-3 sm:px-5 py-2.5 flex flex-wrap lg:flex-nowrap items-center gap-2.5 lg:gap-4">
          <button
            type="button"
            onClick={() => handleCategorySelect("FOR_YOU")}
            className="shrink-0 rounded-lg px-1.5 py-1 hover:ring-1 hover:ring-white/40 transition text-left"
          >
            <BrandLogo light />
          </button>

          {/* Delivering to Selected Customer (PDF Sec 4.1) */}
          <button
            type="button"
            onClick={() =>
              onOpenCustomerPicker ? onOpenCustomerPicker() : navigate("/salesman/customers")
            }
            className="hidden sm:flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:ring-1 hover:ring-white/40 transition text-left max-w-[230px] shrink-0"
          >
            <MapPin className="h-4 w-4 text-pink-300 shrink-0 mt-1" />
            <div className="min-w-0 leading-tight">
              <p className="text-[11px] text-white/75 truncate">
                Ordering for ({selectedCustomer?.state || "Select store"})
              </p>
              <p className="text-xs font-bold text-white truncate flex items-center gap-1">
                {selectedCustomer ? selectedCustomer.name : "Choose Customer"}
                <ChevronDown className="h-3 w-3 shrink-0 text-pink-300" />
              </p>
            </div>
          </button>

          {/* Combined Category + Search Bar */}
          <form
            onSubmit={handleSearchSubmit}
            className="order-3 lg:order-none w-full lg:flex-1 flex items-stretch rounded-xl overflow-hidden bg-white shadow-sm ring-2 ring-transparent focus-within:ring-brand-magenta"
          >
            <select
              aria-label="Product category"
              value={activeCategory}
              onChange={(e) => handleCategorySelect(e.target.value)}
              className="hidden sm:block bg-[#F3ECF6] text-brand-purple text-xs font-semibold px-3 border-r border-sf-border focus:outline-none cursor-pointer"
            >
              <option value="FOR_YOU">All</option>
              <option value="MURUKKU">Murukku</option>
              <option value="MIXTURE">Mixture</option>
              <option value="CHIPS">Chips</option>
              <option value="SWEETS">Sweets</option>
            </select>
            <input
              type="search"
              value={onSearchChange ? searchTerm : localSearch}
              onChange={(e) => handleSearchInput(e.target.value)}
              placeholder="Search Murukku, Mixture, Chips, Sweets..."
              className="flex-1 min-w-0 px-3.5 py-2.5 text-sm text-sf-text placeholder:text-sf-muted focus:outline-none"
            />
            <button
              type="submit"
              aria-label="Search catalog"
              className="bg-brand-magenta hover:bg-brand-magentaDark text-white px-4 flex items-center justify-center transition"
            >
              <Search className="h-5 w-5" />
            </button>
          </form>

          {/* Right Action Cluster */}
          <div className="ml-auto lg:ml-0 flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <span
              className={`hidden xl:inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                isOnline
                  ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/30"
                  : "bg-amber-500/20 text-amber-200 border border-amber-400/30"
              }`}
            >
              {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
              {isOnline ? "Online" : `Offline (${offlineQueue.length})`}
            </span>

            <NotificationBell light />

            <button
              type="button"
              onClick={() => navigate("/salesman/more")}
              className="hidden md:flex flex-col rounded-lg px-2.5 py-1 hover:ring-1 hover:ring-white/40 transition text-left leading-tight"
            >
              <span className="text-[11px] text-white/75">Hello, {user?.first_name || "Salesman"}</span>
              <span className="text-xs font-bold text-white">Account &amp; Territory</span>
            </button>

            <button
              type="button"
              onClick={() => navigate("/salesman/orders")}
              className="hidden md:flex flex-col rounded-lg px-2.5 py-1 hover:ring-1 hover:ring-white/40 transition text-left leading-tight"
            >
              <span className="text-[11px] text-white/75">Orders &amp;</span>
              <span className="text-xs font-bold text-white">Customer Sales</span>
            </button>

            <button
              type="button"
              onClick={() => navigate("/salesman/cart")}
              className="flex items-center gap-2 rounded-xl bg-white/10 hover:bg-brand-magenta px-3 py-2 transition"
            >
              <div className="relative">
                <ShoppingCart className="h-5 w-5 text-white" />
                <span className="absolute -right-2 -top-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-magenta border border-white/40 px-1 text-[10px] font-extrabold text-white">
                  {itemCount}
                </span>
              </div>
              <span className="hidden sm:inline text-xs font-extrabold">Cart</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              title="Sign Out"
              className="hidden lg:flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-red-600/80 text-white transition"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* SECONDARY CATEGORY & PDF-ALIGNED NAVIGATION BAR */}
        <div className="bg-brand-purpleSoft border-t border-white/10">
          <div className="max-w-[1520px] mx-auto px-3 sm:px-5 flex items-center gap-1 overflow-x-auto no-scrollbar py-1.5 text-xs font-semibold">
            {SUBNAV_CATEGORIES.map((c) => {
              const active = activeCategory === c.key && Boolean(onCategoryChange);
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => handleCategorySelect(c.key)}
                  className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition ${
                    active
                      ? "bg-brand-magenta text-white shadow-sm"
                      : "text-white/90 hover:bg-white/10"
                  }`}
                >
                  {c.label}
                </button>
              );
            })}
            <span className="mx-1 h-4 w-px bg-white/20 shrink-0" />
            <NavLink
              to="/salesman/orders"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg whitespace-nowrap transition ${
                  isActive ? "bg-brand-magenta text-white" : "text-white/90 hover:bg-white/10"
                }`
              }
            >
              My Orders &amp; Sales
            </NavLink>
            <NavLink
              to="/salesman/customers"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg whitespace-nowrap transition flex items-center gap-1 ${
                  isActive ? "bg-brand-magenta text-white" : "text-white/90 hover:bg-white/10"
                }`
              }
            >
              <Users className="h-3.5 w-3.5" /> Customers
            </NavLink>
            <NavLink
              to="/salesman/cart"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-lg whitespace-nowrap transition ${
                  isActive ? "bg-brand-magenta text-white" : "text-white/90 hover:bg-white/10"
                }`
              }
            >
              New Order ({itemCount})
            </NavLink>
          </div>
        </div>
      </header>

      {/* Mobile Compact Selected Customer Bar */}
      <button
        type="button"
        onClick={() =>
          onOpenCustomerPicker ? onOpenCustomerPicker() : navigate("/salesman/customers")
        }
        className="sm:hidden w-full bg-[#411754] text-white px-4 py-2 flex items-center justify-between text-xs border-t border-white/10"
      >
        <span className="flex items-center gap-1.5 truncate">
          <MapPin className="h-3.5 w-3.5 text-pink-300 shrink-0" />
          <span className="truncate">
            Ordering for:{" "}
            <strong>
              {selectedCustomer
                ? `${selectedCustomer.name} (${selectedCustomer.state})`
                : "Select customer"}
            </strong>
          </span>
        </span>
        <ChevronDown className="h-4 w-4 text-pink-200 shrink-0" />
      </button>

      {/* FULL-WIDTH RESPONSIVE STOREFRONT BODY */}
      <main className="flex-1 w-full max-w-[1520px] mx-auto px-3 sm:px-5 py-4 sm:py-5">
        {children}
      </main>

      {/* FIXED BOTTOM NAVIGATION FOR MOBILE / TABLET ONE-HAND USE */}
      <nav
        aria-label="Salesman mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur border-t border-sf-border shadow-elevated"
      >
        <div className="grid grid-cols-5 h-16">
          {mobileNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition ${
                  isActive
                    ? "text-brand-magenta"
                    : "text-sf-muted hover:text-brand-purple"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div className={`rounded-xl px-3 py-1 ${isActive ? "bg-brand-pink" : ""}`}>
                    {item.icon}
                  </div>
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
