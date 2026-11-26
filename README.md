# FactoraX — Complete Full-Stack Order-to-Audit ERP

**Order. Produce. Audit.**

Full-stack Order-to-Audit Manufacturing ERP for a South Indian packaged food manufacturer (*Murukku, Mixture, Chips, Traditional Sweets*), built for the **Centre for Digital Infrastructure, NIT Tiruchirappalli** internship problem statement.

- **Live Web App (Vercel):** https://factorax.vercel.app
- **Live Backend API (Render + Neon PostgreSQL):** https://factorax-api.onrender.com/api/health/?db=1
- **GitHub Repository:** https://github.com/buvanesh080606/FactoraX

---

## 1. Tech Stack & Justification

We chose **Django 5 + Django REST Framework + Channels (Daphne ASGI)** backed by **PostgreSQL 16 (Neon Serverless)** for the backend, and **React 18 + TypeScript + Vite + Tailwind CSS** for the frontend. Django gives us strong relational modeling, `@transaction.atomic` with `select_for_update()` row-level locking to guarantee concurrent stock integrity, and exact `Decimal` fixed-point arithmetic for money and inventory quantities alongside native ReportLab PDF and openpyxl Excel generation. React + TypeScript lets one unified codebase power both a fast mobile-first storefront for field salesmen (with offline queueing) and dedicated desktop workspaces for Admin, Production, Accountant, and Owner.

---

## 2. Features Built Against Section 6 Tiers

### Must Have (All Implemented & Verified)
- [x] **Single Login & 5-Role RBAC:** One login endpoint automatically routes users by `User.role` (`SALESMAN`, `ADMIN`, `PRODUCTION`, `ACCOUNTANT`, `OWNER`) with strict server-side API permission enforcement.
- [x] **Masters:** Product (categories, pack sizes, HSN, GST rate, thumbnail upload), Customer (state, GSTIN, credit limit, salesman assignment), Supplier, Raw Material, Packaging Material, Unit (`kg↔g`, `L↔ml`, `ctn↔pkt`), and versioned BOMs.
- [x] **Mobile-Friendly Salesman Flow:** Customer selection, price-list & customer-specific pricing, one-tap order submission, live order status tracking (`SUBMITTED → APPROVED → INVOICED → DISPATCHED`), and customer-wise sales.
- [x] **Admin Order Verification & GST Invoicing:** Edit quantities/prices prior to approval, live finished-goods stock sufficiency check, financial-year numbered GST invoices (`CGST+SGST` intra-state vs `IGST` inter-state), ReportLab **PDF download**, and **WhatsApp / Email** share links.
- [x] **Atomic Production Runs & Variance:** Single transaction deducts planned/actual raw materials + damaged packaging and credits good finished packets; computes consumption & yield variance with automatic `>3%` flagging.
- [x] **Ledger-Driven Inventory:** Separate balances for Raw, Packaging, and Finished Goods derived strictly from append-only `StockLedger` movements (`Opening + Receipts − Issues ± Adjustments = Closing`).
- [x] **Auditor Reports & Exports:** 13 monthly read-only reports (Sales Register, Customer/Product Sales, GST Outward Supply Summary, Purchase Register, Stock Summary, Stock Ledger, Production Report, Consumption Variance, Product Costing, Yield & Wastage, Payments Register, Receivables Ageing) exportable to **CSV, Excel (`.xlsx`), and PDF**.
- [x] **Audit Trail & Non-Destructive Reversals:** Posted GST invoices cannot be deleted (cancelled only via `CreditNote`); production runs (`CANCELLED`) and payments (`REVERSED`) reverse atomically in the ledger while preserving records in role-grouped `AuditLog`.

### Should Have (All Implemented & Verified)
- [x] **Purchases & Suppliers:** Purchase entry & confirmation posting `PURCHASE_RECEIPT` ledger entries and recalculating Moving Weighted Average material costs.
- [x] **Payments, Outstanding & Ageing:** Invoice allocations, pending-due tracking, customer outstanding balances, and receivables ageing buckets (`0–30`, `31–60`, `61–90`, `90+` days).
- [x] **Product Costing:** Exact batch cost per good packet (Raw + Packaging + Labour/Gas/Power overheads) and margin vs selling price.
- [x] **GST Outward Supply Summary:** GSTR-1 / GSTR-3B aligned HSN/supply-type tax summary.
- [x] **Real-Time Alerts:** Live WebSocket notifications (`ws/notifications/`) + badge alerts for `>3%` variance and low/out-of-stock items.
- [x] **Owner Executive Dashboard:** Explicit summary of **Today's Orders**, **Stock Levels**, **Variance Alerts (>3%)**, **Avg Cost / Good Packet**, **Outstanding Dues**, plus 5 interactive Recharts visualizations.

### Stretch Goals Implemented
- [x] **Offline Order Capture with Sync:** Local browser queue (`localStorage`) when offline + automatic/manual sync with UUID `idempotency_key` preventing duplicate orders.
- [x] **Reorder Levels & Low-Stock Alerts:** Configurable `reorder_level` thresholds surfaced on Admin, Inventory, and Owner dashboards.
- [x] **Production Planning from Pending Orders:** Compares pending order demand against live finished stock and recommends exact BOM batch counts (e.g., Distributor B's 32-pkt shortage → *"Make 1 batch (200 pkt)"*).

---

## 3. Exact Section 5 Benchmark Numbers & Explanations

All benchmark figures are reproducibly seeded via `python manage.py seed_benchmark --reset` and verified by automated `pytest` assertions:

| Benchmark Check | Expected (PDF Sec 5) | FactoraX Result | Explanation / Notes |
|---|---|---|---|
| **Flour closing balance** | `120 kg` (`100 + 60 − 40`) | `120.000 kg` | Exact match (`OPENING 100` + `PURCHASE_RECEIPT 60` − `PRODUCTION_ISSUE 40`). |
| **Cooking oil closing balance** | `19.5 L` (`30 − 10.5`) | `19.500 L` | Exact match (`30.000 − 10.500`). |
| **Pouches closing balance** | `306 pcs` (`500 − 188 − 6`) | `306.000 pcs` | Exact match (`actual 188 + damaged 6 = 194` deducted from `500`). |
| **Finished Murukku after run** | `238 pkts` (`50 + 188`) | `238.000 pkts` | Exact match. |
| **Finished Murukku after Retailer A dispatch** | `88 pkts` (`238 − 150`) | `88.000 pkts` | Exact match (`SALES_DISPATCH -150`). |
| **Yield variance** | `-6%`, flagged (`188 vs 200`) | `-6.00%` (`has_variance_flag=True`) | Exact match (`(188 − 200) / 200 × 100 = -6.00%`, exceeds `3%` tolerance). |
| **Oil consumption variance** | `+5%`, flagged (`10.5 vs 10`) | `+5.00%` (`is_variance_flagged=True`) | Exact match (`(10.5 − 10) / 10 × 100 = +5.00%`). |
| **Carton consumption variance** | Not explicitly listed in Sec 5 check table | `-10.00%` (`9` vs `10 pcs` planned) | **Difference explained:** Because only `188` packets were produced (instead of `200`), `9` cartons were issued vs `10` planned in the BOM (`(9 − 10)/10 = -10.00%`), which our `|variance| > 3%` rule also flags for audit review. Also `pouches` show `-3.00%` (`194 vs 200`, at boundary `<= 3%`, not flagged). |
| **Retailer A GST Invoice (TN → TN)** | `₹7,500 + ₹187.50 CGST + ₹187.50 SGST = ₹7,875` | `₹7,500.00 + ₹187.50 + ₹187.50 = ₹7,875.00` | Exact match (intra-state 5% GST split 2.5% CGST + 2.5% SGST). |
| **Retailer A Outstanding** | `₹3,875` (after `₹4,000` payment) | `₹3,875.00` | Exact match (`₹7,875.00 − ₹4,000.00`). |
| **Distributor B Order (KA, 120 pkts)** | `32 pkts` shortage flagged; IGST if invoiced | `32.000 pkts` shortage (`120 − 88`), approval blocked | **Behavior note:** Approval stays cleanly blocked in pending state until finished stock reaches `120` pkts so inventory can never go negative; automated tests additionally verify that once stock is replenished, approving and invoicing Distributor B produces exact inter-state `5% IGST = ₹300.00` (`₹6,000 + ₹300 = ₹6,300.00`). |
| **Cost per Good Packet** | Your figure + method stated | **`₹31.1436 / pkt`** | **Breakdown:** Flour `40 × ₹43.1250 = ₹1,725.00` + Oil `10.5 × ₹140 = ₹1,470.00` + Spice `1.2 × ₹200 = ₹240.00` + Pouches `194 × ₹2.50 = ₹485.00` + Cartons `9 × ₹15 = ₹135.00` + Overheads (`₹1,200 + ₹600 = ₹1,800.00`) = **`₹5,855.00 / 188 good pkts = ₹31.1436/pkt`** (Gross margin vs `₹50.00`: `₹18.86/pkt`, `37.7%`). |

---

## 4. Assumptions & Known Gaps

### Assumptions
1. **Material Valuation Method:** Moving Weighted Average cost is updated atomically on every `OPENING` and `PURCHASE_RECEIPT` movement.
2. **Overhead Allocation & Wastage:** Direct batch overheads (Labour, Gas/Electricity, Other) and all issued + damaged materials (`188 + 6 = 194` pouches) are absorbed by the **actual good packets produced** (`188`), so yield drops transparently raise unit cost.
3. **Stock & Financial Immutability:** Stock cannot drop below `0.000`; posted GST invoices can only be cancelled via `CreditNote`, and production runs/payments can only be reversed (`CANCELLED` / `REVERSED`) rather than hard-deleted.
4. **Local Timezone Display:** Client browser timezone (`X-Client-Timezone`) converts stored UTC timestamps into exact local wall-clock time in reports, notifications, and audit trails.

### Known Gaps (Unselected Stretch Goals & Scope Boundaries)
- **Omitted Stretch Goals:** Batch/expiry FEFO tracking, Tally-compatible XML export, mock e-Invoice / e-Way Bill JSON generation, Tamil UI translation, and salesman GPS check-in are outside the current scope.
- **Work-in-Progress (WIP):** Modeled as atomic single-step completion per batch (`PRODUCTION_ISSUE` → `PRODUCTION_OUTPUT`) rather than multi-day intermediate WIP states.
- **Media Storage on Ephemeral Hosts:** Uploaded custom product images use Django `FileSystemStorage` (`media/products/`) locally; on Render's ephemeral filesystem, default catalog snack assets in `frontend/public/products/` remain permanent while custom uploads would persist best with S3/Cloudinary in long-term production.

---

## 5. Setup Steps & Test Logins

### Test Accounts (`Password: Smart@123` for all roles)
| Role | Username | Landing Route |
|---|---|---|
| Salesman A (Retailer A — TN) | `salesman` | `/salesman/home` |
| Salesman B (Distributor B — KA) | `salesman2` | `/salesman/home` |
| Factory Admin & Billing Desk | `admin` | `/admin/dashboard` |
| Production & BOM Supervisor | `production` | `/production/dashboard` |
| Accountant / Auditor (Read-Only) | `accountant` | `/accountant/dashboard` |
| Business Owner Executive | `owner` | `/owner/dashboard` |

### Local Development Setup
```bash
# 1. Clone repository
git clone https://github.com/buvanesh080606/FactoraX.git
cd FactoraX

# 2. Backend (Python 3.12 + PostgreSQL 16 / Neon)
cd backend
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env   # Set DATABASE_URL to your local PostgreSQL or Neon URL
python manage.py migrate
python manage.py seed_benchmark --reset
pytest -v              # Runs all 5 end-to-end & concurrency tests
daphne -b 127.0.0.1 -p 8000 config.asgi:application

# 3. Frontend (Node.js 20+ / Vite)
cd ../frontend
npm install
npm run dev            # Opens http://localhost:5173
```

### Cloud Deployment Architecture
- **Database:** PostgreSQL 16 on **Neon** (Singapore) via `DATABASE_URL` (`sslmode=require`).
- **Backend:** **Render** Web Service ([render.yaml](./render.yaml), `rootDir: backend`, `buildCommand: bash build.sh`, `startCommand: daphne -b 0.0.0.0 -p $PORT config.asgi:application`, health check `/api/health/`).
- **Frontend:** **Vercel** (`Root Directory: frontend`, `VITE_API_BASE_URL=https://factorax-api.onrender.com/api`, SPA rewrites via [frontend/vercel.json](./frontend/vercel.json)).
- **Keep-Alive:** **UptimeRobot** HTTP(s) monitor pinging `/api/health/` every 5 minutes.

---

## 6. Project Documentation
- [DESIGN_NOTE.md](./DESIGN_NOTE.md) — Concise 2-page architecture, ER diagram, stock/BOM math & costing note
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) — Relational schema & ledger indexing details
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) — REST API & WebSocket endpoint reference
