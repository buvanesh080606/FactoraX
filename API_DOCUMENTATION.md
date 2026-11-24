# SmartFactory – REST API & WebSocket Documentation

Base URL: `/api/`  
Authentication: Bearer JWT (`Authorization: Bearer <access_token>`)  
Content-Type: `application/json`

---

## 1. Authentication & System (`/api/auth/`)
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| POST | `/api/auth/login/` | Public | Authenticate with username/email + password; returns JWT tokens, user role & redirect route |
| POST | `/api/auth/refresh/` | Public | Refresh expired access token |
| POST | `/api/auth/logout/` | Authenticated | Blacklist refresh token |
| GET | `/api/auth/me/` | Authenticated | Current authenticated user profile, role & company info |
| POST | `/api/auth/forgot-password/` | Public | Logs password reset request |
| GET/PATCH | `/api/auth/company-settings/` | Read: All; Write: Admin, Owner | Read/update factory GSTIN, state, invoice prefix, variance tolerance |
| GET/POST | `/api/auth/users/` | Admin, Owner | Manage system users and roles |
| GET | `/api/auth/notifications/` | Authenticated | User/role notifications list + unread count |
| POST | `/api/auth/notifications/{id}/read/` | Authenticated | Mark notification as read |
| POST | `/api/auth/notifications/read-all/` | Authenticated | Mark all notifications as read |
| GET | `/api/auth/audit-logs/` | Admin, Accountant, Owner | Paginated audit trail |

---

## 2. Masters & BOM (`/api/masters/`)
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET/POST/PATCH | `/api/masters/units/` | Read: All; Write: Admin, Production, Owner | Units of measure |
| GET/POST/PATCH | `/api/masters/customers/` | Read: All (Salesman filtered to assigned); Write: Admin, Owner | Customer directory with live outstanding balance |
| GET/POST/PATCH | `/api/masters/suppliers/` | Read: Admin, Production, Accountant, Owner; Write: Admin, Owner | Supplier directory |
| GET/POST/PATCH | `/api/masters/products/` | Read: All; Write: Admin, Production, Owner | Finished products with real-time available stock from `StockLedger` |
| GET/POST/PATCH | `/api/masters/raw-materials/` | Read: Admin, Production, Accountant, Owner; Write: Admin, Production, Owner | Raw materials with stock balance & weighted avg cost |
| GET/POST/PATCH | `/api/masters/packaging-materials/` | Read: Admin, Production, Accountant, Owner; Write: Admin, Production, Owner | Packaging materials with stock balance & weighted avg cost |
| GET/POST/PATCH | `/api/masters/boms/` | Read: Admin, Production, Accountant, Owner; Write: Admin, Production, Owner | BOM headers + nested `items` |
| GET | `/api/masters/boms/{id}/calculate/?batch_multiplier=1` | Admin, Production, Owner | Planned material requirements & current available stock |

---

## 3. Inventory & Stock Ledger (`/api/inventory/`)
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/api/inventory/summary/` | All (Salesman: finished only) | Opening, receipts, issues, adjustments, closing balance, reorder status & valuation |
| GET | `/api/inventory/ledger/` | Admin, Production, Accountant, Owner | Filterable immutable `StockLedger` movements |
| POST | `/api/inventory/opening-stock/` | Admin, Production, Owner | Record opening stock ledger entry with unit cost |
| POST | `/api/inventory/adjustments/` | Admin, Owner | Controlled inventory adjustment with audit log |

---

## 4. Purchases (`/api/purchases/`)
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET/POST | `/api/purchases/` | Read: Admin, Production, Accountant, Owner; Write: Admin, Owner | Create draft or immediately confirm purchase |
| POST | `/api/purchases/{id}/confirm/` | Admin, Owner | Atomically confirm purchase, update weighted avg cost & write `PURCHASE_RECEIPT` ledger rows |

---

## 5. Production & Costing (`/api/production/`)
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET/POST | `/api/production/runs/` | Read: Admin, Production, Accountant, Owner; Write: Production, Admin, Owner | List or create/confirm production runs |
| GET | `/api/production/runs/{id}/` | Admin, Production, Accountant, Owner | Detailed run with consumption, variance & cost breakdown |
| POST | `/api/production/runs/preview/` | Production, Admin, Owner | Preview planned vs actual variance and costing before commit |
| GET | `/api/production/variance-report/` | Admin, Production, Accountant, Owner | Flagged consumption & yield variance records |
| GET/POST | `/api/production/expenses/` | Read: Admin, Production, Accountant, Owner; Write: Production, Admin, Owner | Production overhead expenses |

---

## 6. Sales Orders, GST Invoices, Dispatch & Payments (`/api/sales/`)
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET/POST | `/api/sales/orders/` | Salesman (own), Admin, Owner, Accountant (read) | List orders or submit new order (supports `idempotency_key`) |
| GET/PATCH | `/api/sales/orders/{id}/` | Salesman (own read), Admin, Owner | Order details, status history, edit pending order |
| GET | `/api/sales/orders/{id}/stock-check/` | Admin, Owner | Live finished stock availability & shortage per line item |
| POST | `/api/sales/orders/{id}/approve/` | Admin, Owner | Validate stock sufficiency & approve order |
| POST | `/api/sales/orders/{id}/reject/` | Admin, Owner | Reject order with mandatory reason |
| POST | `/api/sales/orders/{id}/generate-invoice/` | Admin, Owner | Generate GST invoice (CGST+SGST or IGST) from approved order |
| GET | `/api/sales/invoices/` | Admin, Owner, Accountant, Salesman (own customers) | List GST invoices with allocated payments & outstanding balance |
| GET | `/api/sales/invoices/{id}/pdf/` | Admin, Owner, Accountant, Salesman (own customers) | Download backend-generated ReportLab GST Invoice PDF |
| GET/POST | `/api/sales/dispatches/` | Admin, Owner, Accountant (read) | Record dispatch against invoice, validate stock, prevent duplicate dispatch, deduct ledger once |
| GET/POST | `/api/sales/payments/` | Admin, Owner, Salesman (collect), Accountant (read) | Record payment & allocate against invoices (supports `idempotency_key`) |
| GET | `/api/sales/receivables/` | Admin, Owner, Accountant, Salesman (own customers) | Customer-wise outstanding & invoice ageing buckets (0–30, 31–60, 61–90, 90+ days) |

---

## 7. Dashboards, Reports & Exports (`/api/reports/`)
| Method | Endpoint | Roles | Description |
|---|---|---|---|
| GET | `/api/reports/dashboard/admin/` | Admin, Owner | Live KPIs, low stock, pending orders, recent activity |
| GET | `/api/reports/dashboard/owner/` | Owner | Executive KPIs, charts (monthly sales, product sales, production trend, inventory value, collections vs outstanding) |
| GET | `/api/reports/dashboard/production/` | Production, Admin, Owner | Production KPIs, recent runs, variance alerts, raw material stock alerts |
| GET | `/api/reports/dashboard/salesman/` | Salesman | Salesman summary, recent orders, collections & customer list |
| GET | `/api/reports/{report_key}/` | Accountant, Admin, Owner | 13 database-backed reports (`sales-register`, `customer-sales`, `product-sales`, `purchase-register`, `gst-summary`, `stock-summary`, `stock-ledger`, `production-report`, `consumption-variance`, `yield-wastage`, `payments`, `outstanding-ageing`, `product-costing`) |
| GET | `/api/reports/{report_key}/export/?format=csv\|xlsx\|pdf` | Accountant, Admin, Owner | Download report in CSV, Excel (`.xlsx`), or PDF |

---

## 8. WebSocket Endpoint
- `ws://<host>/ws/notifications/?token=<jwt_access_token>`
- Emits JSON events: `{ type: "notification", event_type, title, message, entity_type, entity_id, created_at }`
