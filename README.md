# FactoraX — Complete Full-Stack Order-to-Audit ERP

**Order. Produce. Audit.**

Full-stack Order-to-Audit Manufacturing ERP for a South Indian packaged food manufacturer (*Murukku, Mixture, Chips, Traditional Sweets*), built for the **Centre for Digital Infrastructure, NIT Tiruchirappalli** internship problem statement.

---

## 1. Tech Stack & Justification
- **Backend:** Python 3.12, Django 5.1, Django REST Framework, SimpleJWT, Django Channels (Daphne ASGI), WhiteNoise, ReportLab, openpyxl. Chosen for rapid relational modeling, built-in `transaction.atomic()` + `select_for_update()` row-level concurrency control, native fixed-point `Decimal` arithmetic, and crisp backend PDF/Excel generation.
- **Database:** PostgreSQL 16 (Neon Serverless PostgreSQL in cloud / PostgreSQL 16 locally) — `NUMERIC` precision, relational foreign keys, row-level locking, and an append-only `StockLedger` as the single source of truth.
- **Frontend:** React 18, Vite 6, TypeScript, Tailwind CSS, Recharts, React Hook Form + Zod. Provides a fast mobile-first storefront for field salesmen alongside role-tailored desktop ERP workspaces for Admin, Production, Accountant, and Owner.

---

## 2. Feature Coverage Against PDF Section 6 Tiers

### Must Have (All Implemented & Verified)
- [x] Single login with **5 roles** (`SALESMAN`, `ADMIN`, `PRODUCTION`, `ACCOUNTANT`, `OWNER`) + automatic role routing & strict server-side RBAC
- [x] Product, Customer (with salesman assignment), Supplier, Raw Material, Packaging Material, Unit (hierarchical conversions: `kg↔g`, `L↔ml`, `ctn↔pkt`), and BOM masters
- [x] Mobile-friendly Salesman ordering, order status tracking, customer-wise sales, and Admin order verification (qty/price edit + live stock check + approve/reject)
- [x] GST-compliant Tax Invoices (`CGST+SGST` intra-state vs `IGST` inter-state, FY numbering), backend **ReportLab PDF** download, and **WhatsApp / Email** customer share links
- [x] Atomic Production Runs automatically deducting raw/packaging stock (incl. damaged packaging) and adding good finished output
- [x] Planned vs Actual consumption & yield variance with automatic `>3%` flagging
- [x] Ledger-derived Stock Summary (`Opening + Receipts − Issues ± Adjustments = Closing`) and immutable append-only Stock Ledger
- [x] 13 Auditor Reports (Sales Register, Customer/Product Sales, GST Outward Supply Summary, Purchase Register, Stock Summary/Ledger, Production, Variance, Costing, Payments, Ageing) exportable to **CSV, Excel (`.xlsx`), and PDF**
- [x] Role-grouped immutable **Audit Trail** + strict non-destructive reversals (**Credit Note** for posted invoices, `CANCELLED` + ledger reversal for production runs, `REVERSED` status for payments)

### Should Have (All Implemented & Verified)
- [x] Purchases & Supplier management with automatic ledger receipt & Moving Weighted Average Cost update
- [x] Payments, invoice allocations, customer outstanding, and receivables ageing buckets (`0–30`, `31–60`, `61–90`, `90+` days)
- [x] Product Costing per good packet with Labour & Gas/Power overheads + gross margin
- [x] GST Outward Supply Summary report (GSTR-1 / GSTR-3B aligned)
- [x] Real-time variance & low-stock alerts (WebSockets + notification bell)
- [x] Owner Executive Dashboard covering all PDF summary metrics (**Today's Orders**, **Stock Levels**, **Variance Alerts (>3%)**, **Cost per Packet**, **Outstanding Dues**) + 5 Recharts visualizations

### Stretch Goals Built
- [x] **Offline order capture with sync** (local queue + UUID `idempotency_key` preventing duplicate submissions)
- [x] **Reorder levels & low-stock alerts** for raw materials, packaging, and finished goods
- [x] **Production planning from pending orders** (compares pending demand vs live finished stock and recommends exact BOM batches, e.g., Distributor B's 32-packet shortage → *"Make 1 batch (200 pkt)"*)

---

## 3. Exact Section 5 Benchmark Verification Results

Seeded repeatably via `python manage.py seed_benchmark --reset` using the exact Section 5 master data and rates:

| Check | Expected (PDF Sec 5) | FactoraX Output | Status |
|---|---|---|---|
| Flour closing balance | `120 kg` (`100 + 60 − 40`) | `120.000 kg` | Exact Match |
| Cooking oil closing balance | `19.5 L` (`30 − 10.5`) | `19.500 L` | Exact Match |
| Pouches closing balance | `306 pcs` (`500 − 188 − 6`) | `306.000 pcs` | Exact Match |
| Finished Murukku after run | `238 pkts` (`50 + 188`) | `238.000 pkts` | Exact Match |
| Finished Murukku after Retailer A dispatch | `88 pkts` (`238 − 150`) | `88.000 pkts` | Exact Match |
| Yield variance | `-6%`, flagged (`188 vs 200`) | `-6.00%`, `has_variance_flag=True` | Exact Match |
| Oil consumption variance | `+5%`, flagged (`10.5 vs 10`) | `+5.00%`, `is_variance_flagged=True` | Exact Match |
| Retailer A GST Invoice (TN → TN) | `₹7,500 + ₹187.50 CGST + ₹187.50 SGST = ₹7,875` | `₹7,500.00 + ₹187.50 + ₹187.50 = ₹7,875.00` | Exact Match |
| Retailer A Outstanding (after ₹4,000 paid) | `₹3,875` | `₹3,875.00` | Exact Match |
| Distributor B Order (KA, Salesman B, 120 pkts) | Shortage `32 pkts` flagged; IGST if invoiced | Shortage `32.000 pkts` (approval blocked; IGST 5% = `₹300` verified in pytest) | Exact Match |
| **Cost per Good Packet** | Valuation method & overhead rule stated | **`₹31.1436 / pkt`** (Moving Weighted Average + Batch Overheads) | Verified |

### Cost per Packet Derivation (`₹31.1436`)
1. **Flour Moving Weighted Average:** `(100 kg × ₹42 + 60 kg × ₹45) / 160 kg = ₹43.1250/kg` → `40 kg = ₹1,725.00`
2. **Cooking Oil:** `10.5 L × ₹140.00 = ₹1,470.00`
3. **Salt & Spice Mix:** `1.2 kg × ₹200.00 = ₹240.00` (Raw Total = `₹3,435.00`)
4. **Packaging (incl. damaged):** `194 pouches × ₹2.50 = ₹485.00` + `9 cartons × ₹15.00 = ₹135.00` (Packaging Total = `₹620.00`)
5. **Batch Overheads:** Labour `₹1,200.00` + Gas/Power `₹600.00` = `₹1,800.00`
6. **Total Production Cost:** `₹5,855.00 / 188 good packets = ₹31.1436/pkt` (Gross Margin vs `₹50.00` = `₹18.86/pkt`, `37.7%`).

---

## 4. Assumptions & Known Gaps
- **Assumptions:** Moving Weighted Average valuation is used for raw/packaging materials; batch overheads are allocated across actual good output packets; damaged pouches (`6`) are included in material cost and deducted from inventory; browser timezone (`X-Client-Timezone`) ensures exact local timestamps across reports and audit trails.
- **Known Gaps (Unselected Stretch Goals):** Batch/expiry FEFO tracking, Tally XML export, mock e-Invoice/e-Way Bill JSON, Tamil UI localization, and GPS salesman check-in are omitted to keep core Order-to-Audit workflows focused and verifiable.

---

## 5. Test Logins & Quick Setup

| Role | Username | Password | Landing Route |
|---|---|---|---|
| Salesman A (Retailer A — TN) | `salesman` | `Smart@123` | `/salesman/home` |
| Salesman B (Distributor B — KA) | `salesman2` | `Smart@123` | `/salesman/home` |
| Factory Admin & Billing | `admin` | `Smart@123` | `/admin/dashboard` |
| Production Supervisor | `production` | `Smart@123` | `/production/dashboard` |
| Accountant / Auditor (Read-Only) | `accountant` | `Smart@123` | `/accountant/dashboard` |
| Business Owner | `owner` | `Smart@123` | `/owner/dashboard` |

### Local Setup (Backend + Frontend)
```bash
# 1. Backend (Python 3.12 + PostgreSQL / Neon DB)
cd backend
python -m venv .venv
# Activate .venv, copy .env.example -> .env and set DATABASE_URL
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_benchmark --reset
pytest -v
daphne -b 127.0.0.1 -p 8000 config.asgi:application

# 2. Frontend (Node 20+ / Vite)
cd ../frontend
npm install
npm run dev
```

### Cloud Deployment (Neon + Render + Vercel + UptimeRobot)
- **Database:** Provision PostgreSQL 16 on **Neon** (`DATABASE_URL` with `sslmode=require`).
- **Backend (Render):** Deploy using root [render.yaml](./render.yaml) (`rootDir: backend`, `buildCommand: bash build.sh`, `startCommand: daphne -b 0.0.0.0 -p $PORT config.asgi:application`, `healthCheckPath: /api/health/`).
- **Frontend (Vercel):** Import `frontend/`, set `VITE_API_BASE_URL=https://<your-render-app>.onrender.com/api`, and deploy ([frontend/vercel.json](./frontend/vercel.json) handles SPA routing).
- **Monitoring:** Point **UptimeRobot** (`HTTP(s)`, 5-min interval) at `https://<your-render-app>.onrender.com/api/health/`.

---

## 6. Documentation
- [DESIGN_NOTE.md](./DESIGN_NOTE.md) — 2-page architecture, ER diagram, stock ledger & costing note
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) — Relational PostgreSQL table & index reference
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) — REST & WebSocket endpoint reference
- [PROJECT_PLAN.md](./PROJECT_PLAN.md) & [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)
