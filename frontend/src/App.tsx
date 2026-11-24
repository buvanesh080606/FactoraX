import React from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { CartProvider } from "./contexts/CartContext";
import { NotificationProvider } from "./contexts/NotificationContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import LoginPage from "./pages/auth/LoginPage";
import SalesmanHomePage from "./pages/salesman/SalesmanHomePage";
import SalesmanOrdersPage from "./pages/salesman/SalesmanOrdersPage";
import SalesmanCustomersPage from "./pages/salesman/SalesmanCustomersPage";
import SalesmanCartPage from "./pages/salesman/SalesmanCartPage";
import SalesmanMorePage from "./pages/salesman/SalesmanMorePage";
import AdminErpPage from "./pages/admin/AdminErpPage";
import ProductionPortalPage from "./pages/production/ProductionPortalPage";
import AccountantPortalPage from "./pages/accountant/AccountantPortalPage";
import OwnerPortalPage from "./pages/owner/OwnerPortalPage";

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.home_route} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <CartProvider>
            <Routes>
              <Route path="/" element={<RootRedirect />} />
              <Route path="/login" element={<LoginPage />} />

              {/* SALESMAN MOBILE APP */}
              <Route
                path="/salesman/home"
                element={
                  <ProtectedRoute allowedRoles={["SALESMAN"]}>
                    <SalesmanHomePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/salesman/orders"
                element={
                  <ProtectedRoute allowedRoles={["SALESMAN"]}>
                    <SalesmanOrdersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/salesman/customers"
                element={
                  <ProtectedRoute allowedRoles={["SALESMAN"]}>
                    <SalesmanCustomersPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/salesman/cart"
                element={
                  <ProtectedRoute allowedRoles={["SALESMAN"]}>
                    <SalesmanCartPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/salesman/more"
                element={
                  <ProtectedRoute allowedRoles={["SALESMAN"]}>
                    <SalesmanMorePage />
                  </ProtectedRoute>
                }
              />

              {/* ADMIN DESKTOP ERP (12 MODULES) */}
              <Route
                path="/admin/*"
                element={
                  <ProtectedRoute allowedRoles={["ADMIN"]}>
                    <AdminErpPage />
                  </ProtectedRoute>
                }
              />

              {/* PRODUCTION & BOM MODULE */}
              <Route
                path="/production/*"
                element={
                  <ProtectedRoute allowedRoles={["PRODUCTION"]}>
                    <ProductionPortalPage />
                  </ProtectedRoute>
                }
              />

              {/* ACCOUNTANT / AUDITOR READ-ONLY PORTAL */}
              <Route
                path="/accountant/*"
                element={
                  <ProtectedRoute allowedRoles={["ACCOUNTANT"]}>
                    <AccountantPortalPage />
                  </ProtectedRoute>
                }
              />

              {/* OWNER EXECUTIVE DASHBOARD */}
              <Route
                path="/owner/*"
                element={
                  <ProtectedRoute allowedRoles={["OWNER"]}>
                    <OwnerPortalPage />
                  </ProtectedRoute>
                }
              />

              <Route path="*" element={<RootRedirect />} />
            </Routes>
          </CartProvider>
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
