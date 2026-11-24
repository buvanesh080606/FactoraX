# SmartFactory – Complete Full-Stack Order-to-Audit ERP

**One System. Every Role. Complete Control.**

Order-to-Audit ERP prototype for a small-scale South Indian packaged food manufacturer (*Murukku, Mixture, Chips, Sweets*), built for the **Centre for Digital Infrastructure, NIT Tiruchirappalli** internship problem statement.

---

## 1. Tech Stack & Justification
- **Backend:** Python 3.12, Django 5.1, Django REST Framework, SimpleJWT, Django Channels (Daphne ASGI), ReportLab, openpyxl. Chosen for rapid relational modeling, built-in `transaction.atomic()` + `select_for_update()` concurrency control, native `Decimal` arithmetic, and crisp PDF/Excel generation.
- **Database:** PostgreSQL 16 (`NUMERIC` precision, foreign keys, row-level locking, append-only `StockLedger`).
- **Frontend:** React 18, Vite 6, TypeScript, Tailwind CSS, Recharts, React Hook Form + Zod. Provides a responsive Amazon-style mobile/desktop storefront for field salesmen alongside dedicated desktop ERP portals for Admin, Production, Accountant, and Owner.

---

## 2. Feature Coverage Against PDF Section 6 Tiers

### Must Have (All Implemented & Tested)
- [x] Single login with **5 roles** (`SALESMAN`, `ADMIN`, `PRODUCTION`, `ACCOUNTANT`, `OWNER`) + strict backend RBAC
- [x] Product, Customer, Supplier, Raw Material, Packaging Material, Unit (with conversions), and BOM masters
- [x] Mobile-friendly Amazon-style Salesman ordering, customer-wise sales, and Admin order verification (qty/price edit + stock check + approve/reject)
- [x] GST-compliant Tax Invoices (`CGST+SGST` intra-state vs `IGST` inter-state, FY numbering), backend **ReportLab PDF** download, and **WhatsApp / Email** customer share links
- [x] Atomic Production Runs automatically deducting raw/packaging stock (incl. damaged packaging) and adding good finished output
- [x] Planned vs Actual consumption & yield variance with automatic `>3%` flagging
- [x] Ledger-derived Stock Summary (`Opening + Receipts - Issues + Adjustments = Closing`) and immutable Stock Ledger
- [x] 13 Auditor Reports (including Sales Register, GST Outward Supply Summary, Stock Summary/Ledger, Production, Variance, Costing, Payments, Ageing) exportable to **CSV, Excel (`.xlsx`), and PDF**
- [x] Audit trail + **Credit Note** cancellation for posted invoices (posted invoices are never deleted)

### Should Have (All Implemented & Tested)
- [x] Purchases & Supplier management with automatic ledger receipt & Moving Weighted Average Cost update
- [x] Payments, invoice allocations, customer outstanding, and ageing buckets (`0-30`, `31-60`, `61-90`, `90+` days)
- [x] Product Costing per good packet with Labour & Gas/Power overheads + gross margin
- [x] GST Outward Supply Summary report
- [x] Real-time variance & low-stock alerts (WebSockets + notification bell)
- [x] Owner Executive Dashboard with live KPIs & 5 Recharts charts

### Stretch Goals Built
- [x] **Offline order capture with sync** (local queue + UUID `idempotency_key` preventing duplicates)
- [x] **Reorder levels & low-stock alerts** for raw materials, packaging, and finished goods
- [x] **Production planning from pending orders** (automatically calculates shortage & recommended batches per active BOM, e.g., Distributor B's 32-packet shortage → *"Make 1 batch (200 pkt)"*)

---

## 3. Exact Section 5 Benchmark Verification Results

Seeded repeatably via `python manage.py seed_benchmark --reset` using the exact Section 5 master data and rates:

| Check | Expected (PDF Sec 5) | SmartFactory Output | Status |
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
- **Assumptions:** Moving Weighted Average valuation is used for raw/packaging materials; batch overheads are allocated directly across actual good output packets; damaged pouches (`6`) are included in material cost and deducted from stock.
- **Known Gaps (Stretch Goals not implemented):** Batch/expiry FEFO tracking, Tally XML export, mock e-Invoice/e-Way Bill JSON, Tamil UI localization, and GPS salesman check-in are not included to keep the core Order-to-Audit loops focused and rock-solid.

---

## 5. Role Logins & Local Startup (`D:\smartbom`)

| Role | Username | Password | Landing Route |
|---|---|---|---|
| Salesman A (Retailer A - TN) | `salesman` | `Smart@123` | `/salesman/home` |
| Salesman B (Distributor B - KA) | `salesman2` | `Smart@123` | `/salesman/home` |
| Factory Admin & Billing | `admin` | `Smart@123` | `/admin/dashboard` |
| Production Supervisor | `production` | `Smart@123` | `/production/dashboard` |
| Accountant / Auditor | `accountant` | `Smart@123` | `/accountant/dashboard` |
| Business Owner | `owner` | `Smart@123` | `/owner/dashboard` |

```powershell
# 1. Start PostgreSQL 16 (port 5433)
D:\smartbom\.tools\pgsql\bin\pg_ctl.exe -D D:\smartbom\.tools\pgdata -l D:\smartbom\.tools\pg.log start

# 2. Seed Benchmark Scenario & Run Automated Tests
powershell -ExecutionPolicy Bypass -File D:\smartbom\.tools\run_backend_verify.ps1

# 3. Start Backend (Daphne ASGI on :8000) & Frontend (Vite on :5173)
cd D:\smartbom\backend && .\.venv\Scripts\daphne.exe -b 127.0.0.1 -p 8000 config.asgi:application
powershell -ExecutionPolicy Bypass -File D:\smartbom\.tools\run_vite.ps1
```

## 6. Documentation
- [DESIGN_NOTE.md](./DESIGN_NOTE.md) (2-page submission architecture & costing note)
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
- [PROJECT_PLAN.md](./PROJECT_PLAN.md)
- [IMPLEMENTATION_STATUS.md](./IMPLEMENTATION_STATUS.md)
