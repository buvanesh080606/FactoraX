import React from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, MapPin, Phone, Users, Wifi, WifiOff } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { useCart } from "../../contexts/CartContext";
import { SalesmanShell } from "./SalesmanShell";

export default function SalesmanMorePage() {
  const { user, company, logout } = useAuth();
  const { isOnline, offlineQueue } = useCart();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <SalesmanShell>
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="sf-card px-5 py-4">
          <h1 className="font-display text-xl font-extrabold text-brand-purple">Salesman Account &amp; Territory</h1>
          <p className="text-xs text-sf-muted">{company?.company_name || "FactoraX ERP"}</p>
        </div>

      <div className="space-y-4">
        <div className="sf-card p-4 space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-purple text-lg font-extrabold text-white">
              {(user?.full_name || "S").slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="font-display text-base font-extrabold text-brand-purple">
                {user?.full_name}
              </p>
              <p className="text-xs text-sf-muted">{user?.email}</p>
            </div>
          </div>
          <div className="pt-2 border-t border-sf-border text-xs text-sf-muted space-y-1">
            <p className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 text-brand-magenta" />
              Territory: {user?.territory || "Field Sales"}
            </p>
            <p className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 text-brand-magenta" />
              {user?.phone || "—"}
            </p>
            <p className="flex items-center gap-2">
              {isOnline ? (
                <Wifi className="h-3.5 w-3.5 text-sf-success" />
              ) : (
                <WifiOff className="h-3.5 w-3.5 text-sf-warning" />
              )}
              Network: {isOnline ? "Online" : "Offline"} ({offlineQueue.length} queued)
            </p>
          </div>
        </div>

        <button
          onClick={() => navigate("/salesman/customers")}
          className="w-full sf-card p-4 flex items-center justify-between text-sm font-bold text-brand-purple hover:border-brand-magenta"
        >
          <span className="flex items-center gap-2.5">
            <Users className="h-5 w-5 text-brand-magenta" />
            Manage Assigned Customers
          </span>
          <span className="text-xs text-sf-muted">Open</span>
        </button>

        <button
          onClick={handleLogout}
          className="w-full sf-btn-purple py-3 text-sm"
        >
          <LogOut className="h-4 w-4" />
          Sign Out of FactoraX
        </button>
      </div>
      </div>
    </SalesmanShell>
  );
}
