import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, extractErrorMessage } from "../api/client";
import type { Customer, Product } from "../types/erp";

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface OfflineQueuedOrder {
  idempotency_key: string;
  customer_id: number;
  customer_name: string;
  delivery_notes: string;
  items: Array<{ product: number; product_name: string; quantity: number; unit_price: string }>;
  estimated_total: number;
  queued_at: string;
  last_error?: string;
}

interface CartContextValue {
  selectedCustomer: Customer | null;
  setSelectedCustomer: (customer: Customer | null) => void;
  items: CartItem[];
  addItem: (product: Product, qty?: number) => void;
  updateQty: (productId: number, qty: number) => void;
  removeItem: (productId: number) => void;
  clearCart: () => void;
  itemCount: number;
  subtotal: number;
  gstEstimate: number;
  grandTotal: number;
  offlineQueue: OfflineQueuedOrder[];
  enqueueOfflineOrder: (notes: string) => OfflineQueuedOrder;
  syncOfflineOrders: () => Promise<{ synced: number; failed: number }>;
  removeOfflineOrder: (key: string) => void;
  isOnline: boolean;
}

const QUEUE_KEY = "sf_offline_order_queue_v1";
const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueuedOrder[]>(() => {
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(offlineQueue));
  }, [offlineQueue]);

  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  const addItem = useCallback((product: Product, qty = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, product, quantity: i.quantity + qty } : i
        );
      }
      return [...prev, { product, quantity: qty }];
    });
  }, []);

  const updateQty = useCallback((productId: number, qty: number) => {
    if (qty <= 0) {
      setItems((prev) => prev.filter((i) => i.product.id !== productId));
      return;
    }
    setItems((prev) =>
      prev.map((i) => (i.product.id === productId ? { ...i, quantity: qty } : i))
    );
  }, []);

  const removeItem = useCallback((productId: number) => {
    setItems((prev) => prev.filter((i) => i.product.id !== productId));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  // Client-side estimates in integer paise; backend Decimal is authoritative on submission
  const subtotalPaise = items.reduce(
    (acc, i) => acc + Math.round(Number(i.product.selling_price) * 100) * i.quantity,
    0
  );
  const gstPaise = items.reduce((acc, i) => {
    const linePaise = Math.round(Number(i.product.selling_price) * 100) * i.quantity;
    return acc + Math.round((linePaise * Number(i.product.gst_rate)) / 100);
  }, 0);
  const subtotal = subtotalPaise / 100;
  const gstEstimate = gstPaise / 100;
  const grandTotal = (subtotalPaise + gstPaise) / 100;
  const itemCount = items.reduce((acc, i) => acc + i.quantity, 0);

  const enqueueOfflineOrder = useCallback(
    (notes: string): OfflineQueuedOrder => {
      if (!selectedCustomer) throw new Error("Select a customer first.");
      const key =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `sf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const entry: OfflineQueuedOrder = {
        idempotency_key: key,
        customer_id: selectedCustomer.id,
        customer_name: selectedCustomer.name,
        delivery_notes: notes,
        items: items.map((i) => ({
          product: i.product.id,
          product_name: `${i.product.name} (${i.product.pack_size})`,
          quantity: i.quantity,
          unit_price: i.product.selling_price,
        })),
        estimated_total: grandTotal,
        queued_at: new Date().toISOString(),
      };
      setOfflineQueue((prev) => [entry, ...prev]);
      setItems([]);
      return entry;
    },
    [selectedCustomer, items, grandTotal]
  );

  const removeOfflineOrder = useCallback((key: string) => {
    setOfflineQueue((prev) => prev.filter((o) => o.idempotency_key !== key));
  }, []);

  const syncOfflineOrders = useCallback(async () => {
    let synced = 0;
    let failed = 0;
    const remaining: OfflineQueuedOrder[] = [];
    for (const q of offlineQueue) {
      try {
        await api.post("/sales/orders/", {
          customer: q.customer_id,
          delivery_notes: q.delivery_notes,
          idempotency_key: q.idempotency_key,
          items: q.items.map((i) => ({ product: i.product, quantity: i.quantity })),
        });
        synced += 1;
      } catch (err) {
        failed += 1;
        remaining.push({ ...q, last_error: extractErrorMessage(err) });
      }
    }
    setOfflineQueue(remaining);
    return { synced, failed };
  }, [offlineQueue]);

  return (
    <CartContext.Provider
      value={{
        selectedCustomer,
        setSelectedCustomer,
        items,
        addItem,
        updateQty,
        removeItem,
        clearCart,
        itemCount,
        subtotal,
        gstEstimate,
        grandTotal,
        offlineQueue,
        enqueueOfflineOrder,
        syncOfflineOrders,
        removeOfflineOrder,
        isOnline,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
}
