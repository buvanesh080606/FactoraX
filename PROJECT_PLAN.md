# SmartFactory – Implementation Plan

**Project:** SmartFactory – Order-to-Audit ERP for South Indian Packaged Food Manufacturing  
**Tagline:** *One System. Every Role. Complete Control.*  
**Institution:** Centre for Digital Infrastructure, NIT Tiruchirappalli (Internship Assignment)

---

## 1. Workspace Inspection Summary

- **Workspace path:** `D:\smartbom`
- **Initial state:** Empty workspace (greenfield build).
- **Detected environment:** Windows OS with `winget` available; Python 3.12, Node.js LTS, Git, and PostgreSQL need to be provisioned locally.

---

## 2. System Architecture

```text
smartbom/
├── backend/                     # Django 5 + DRF + Channels + PostgreSQL
│   ├── config/                  # Settings, URLs, ASGI (Channels), WSGI
│   ├── apps/
│   │   ├── accounts/            # Custom User, Roles, JWT Auth, AuditLog, Notifications
│   │   ├── masters/             # Units, Customers, Suppliers, Products, Materials, BOM
│   │   ├── inventory/           # Append-only StockLedger, Concurrency Locks, Stock Valuation
│   │   ├── purchases/           # Purchases, PurchaseItems, Goods Receipt -> StockLedger
│   │   ├── production/          # ProductionRuns, Consumption, Variance, Overheads, Costing
│   │   ├── sales/               # SalesOrders, Approval, GST Invoices (PDF), Dispatch, Payments
│   │   └── reports/             # Accountant Reports, Owner/Admin Dashboards, CSV/XLSX/PDF exports
│   ├── manage.py
│   └── requirements.txt
├── frontend/                    # React 18 + Vite + TypeScript + Tailwind CSS
│   ├── src/
│   │   ├── api/                 # Axios client with JWT refresh & idempotency support
│   │   ├── components/          # Centralized SmartFactory Design System + Role Shells
│   │   ├── contexts/            # AuthContext, CartContext, NotificationContext, OfflineQueue
│   │   ├── pages/
│   │   │   ├── auth/            # Single Common Login Page
│   │   │   ├── salesman/        # Mobile-First Amazon-Inspired Salesman App
│   │   │   ├── admin/           # Desktop ERP (12 modules)
│   │   │   ├── production/      # BOM Master, Production Run Wizard, Variance, History
│   │   │   ├── accountant/      # Read-only Audit Reports & Exports
│   │   │   └── owner/           # Executive Dashboard & Analytics
│   │   └── types/
│   └── package.json
├── README.md
├── PROJECT_PLAN.md
├── DATABASE_SCHEMA.md
├── API_DOCUMENTATION.md
└── IMPLEMENTATION_STATUS.md
```

---

## 3. Core Architectural Decisions

1. **Single Source of Truth for Inventory (`StockLedger`)**
   - Stock balances are never manually overwritten.
   - Every movement (opening stock, purchase receipt, production material issue, production finished output, sales dispatch, returns, adjustments) writes immutable rows to `StockLedger` with `source_type` and `source_id`.
   - Stock-changing operations execute inside `transaction.atomic()` with row-level `select_for_update()` locking on the item record to guarantee concurrency safety and prevent negative stock.
2. **Financial Precision & Costing**
   - All monetary values and stock quantities use PostgreSQL `NUMERIC` / Python `Decimal` (`ROUND_HALF_UP` to 2 decimal places for INR).
   - **Material Valuation Method:** **Weighted Average Cost (Moving Average)** per raw/packaging material, automatically updated on opening stock and purchase receipts.
   - **Production Costing:** `Total Production Cost = Actual Raw Material Cost + Actual Packaging Cost (good + damaged) + Allocated Overheads (Labour + Gas/Power + Other)` and `Cost per Good Packet = Total Production Cost / Actual Good Packets`.
3. **GST Engine**
   - Seller state configured in company settings (default: `Tamil Nadu`, GSTIN `33AABCS1234F1Z5`).
   - Intra-state (`seller_state == customer_state`): splits GST equally into `CGST` (2.5%) + `SGST` (2.5%).
   - Inter-state (`seller_state != customer_state`): applies full `IGST` (5%).
4. **Authentication & RBAC**
   - Single `/login` page authenticating against `/api/auth/login/` using `djangorestframework-simplejwt` (access + refresh tokens with rotation).
   - Role is stored server-side on `User.role` (`SALESMAN`, `ADMIN`, `PRODUCTION`, `ACCOUNTANT`, `OWNER`).
   - Every DRF ViewSet enforces strict role-based permission classes; `ACCOUNTANT` is strictly read-only (`SAFE_METHODS`).
5. **Real-Time Notifications & Offline Salesman Queue**
   - Django Channels WebSocket endpoint (`/ws/notifications/`) broadcasts live workflow events (new order, approval, invoice, dispatch, payment, low stock), with automatic polling fallback when WS is unavailable.
   - Salesman app supports reliable offline order capture via `localStorage` queue with UUID `idempotency_key`; offline orders are clearly labeled **Queued Offline (Not Yet Submitted)** until synced and confirmed by PostgreSQL.

---

## 4. Phased Execution Roadmap

| Phase | Scope | Verification Gate |
|---|---|---|
| Phase 1 | Environment setup, PostgreSQL, Django & Vite scaffolds, documentation, design tokens | DB connected, migrations run, frontend builds |
| Phase 2 | Custom User, JWT auth, AuditLog, Notifications, single login & role redirection | Auth & RBAC unit tests pass |
| Phase 3 | Units, Customers, Suppliers, Products, Raw/Packaging Materials, BOM master | CRUD API & BOM calculation tests pass |
| Phase 4 | Purchases & atomic StockLedger with weighted-average valuation & concurrency locks | Purchase -> Ledger & concurrency tests pass |
| Phase 5 | Production runs, material consumption, variance (>3% flagging), overheads & costing | Benchmark production & costing tests pass |
| Phase 6 | Salesman mobile-first shopping app, customer picker, cart, checkout, offline queue | Order submission & stock validation tests pass |
| Phase 7 | Admin desktop ERP, order approval/rejection, GST calculation, ReportLab PDF invoices | Intra/Inter-state GST & PDF tests pass |
| Phase 8 | Dispatch (duplicate prevention, ledger deduction), payments, allocations, ageing | Benchmark dispatch, shortage & payment tests pass |
| Phase 9 | Accountant read-only reports (13 views) with CSV/XLSX/PDF exports & Owner dashboard | Report filter, export & read-only RBAC tests pass |
| Phase 10 | WebSockets/notifications, full benchmark seed command, responsive QA (360px–1440px), deploy configs | Full pytest/Django test suite + Vite build + live browser E2E checks |
