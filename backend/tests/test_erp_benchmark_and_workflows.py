from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest
from django.db import close_old_connections
from rest_framework.test import APIClient

from apps.accounts.models import CompanySetting, User, UserRole
from apps.inventory.models import MovementType, StockItemType, StockLedger
from apps.inventory.services import (
    InsufficientStockError,
    build_inventory_summary,
    get_stock_balance,
    record_stock_movement,
)
from apps.masters.models import (
    BOM,
    BOMItem,
    Customer,
    CustomerType,
    MaterialType,
    PackagingMaterial,
    Product,
    ProductCategory,
    RawMaterial,
    Supplier,
    Unit,
)
from apps.sales.models import Invoice, SalesOrder


@pytest.fixture
def erp_users(db):
    CompanySetting.get_solo()
    users = {}
    for uname, role in [
        ("sales1", UserRole.SALESMAN),
        ("sales2", UserRole.SALESMAN),
        ("admin1", UserRole.ADMIN),
        ("prod1", UserRole.PRODUCTION),
        ("acc1", UserRole.ACCOUNTANT),
        ("owner1", UserRole.OWNER),
    ]:
        u = User.objects.create_user(
            username=uname,
            email=f"{uname}@smartfactory.in",
            password="Password@123",
            role=role,
            first_name=uname.title(),
        )
        users[role if uname != "sales2" else "SALESMAN_2"] = u
    return users


def auth_client(user) -> APIClient:
    client = APIClient()
    resp = client.post(
        "/api/auth/login/",
        {"identifier": user.email, "password": "Password@123"},
        format="json",
    )
    assert resp.status_code == 200, resp.data
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {resp.data['access']}")
    return client


@pytest.mark.django_db
def test_single_login_and_role_redirection_and_rbac(erp_users):
    expected_routes = {
        UserRole.SALESMAN: "/salesman/home",
        UserRole.ADMIN: "/admin/dashboard",
        UserRole.PRODUCTION: "/production/dashboard",
        UserRole.ACCOUNTANT: "/accountant/dashboard",
        UserRole.OWNER: "/owner/dashboard",
    }
    for role, route in expected_routes.items():
        u = erp_users[role]
        c = APIClient()
        resp = c.post(
            "/api/auth/login/",
            {"identifier": u.username, "password": "Password@123"},
            format="json",
        )
        assert resp.status_code == 200
        assert resp.data["redirect_to"] == route
        assert resp.data["user"]["role"] == role

    # Unauthenticated blocked
    anon = APIClient()
    assert anon.get("/api/sales/orders/").status_code == 401

    # Role enforcement
    sales_c = auth_client(erp_users[UserRole.SALESMAN])
    acc_c = auth_client(erp_users[UserRole.ACCOUNTANT])
    owner_c = auth_client(erp_users[UserRole.OWNER])

    # Salesman cannot access Owner or Admin dashboard or Accountant reports
    assert sales_c.get("/api/reports/dashboard/owner/").status_code == 403
    assert sales_c.get("/api/reports/dashboard/admin/").status_code == 403
    assert sales_c.get("/api/reports/sales-register/").status_code == 403
    assert sales_c.get("/api/reports/dashboard/salesman/").status_code == 200

    # Accountant is strictly read-only
    assert acc_c.get("/api/reports/sales-register/").status_code == 200
    assert acc_c.post("/api/masters/units/", {"name": "Gram", "symbol": "g"}, format="json").status_code == 403
    assert acc_c.get("/api/reports/dashboard/owner/").status_code == 403

    # Owner accesses executive dashboard
    assert owner_c.get("/api/reports/dashboard/owner/").status_code == 200


@pytest.mark.django_db
def test_full_nit_trichy_benchmark_scenario_end_to_end(erp_users):
    """
    Tests every single number in Section 18 (Benchmark Scenario) through real REST APIs:
    - Opening stock -> Purchase -> BOM -> Production -> Variance -> Costing
    - Retailer A (TN, 150 pkts) -> Approve -> CGST/SGST Invoice -> PDF -> Dispatch -> Payment Rs.4000
    - Duplicate dispatch blocked
    - Distributor B (KA, 120 pkts) -> 32-pkt shortage -> Approval blocked -> Stock added -> IGST Invoice
    - Accountant reports & CSV/XLSX/PDF exports
    """
    admin_c = auth_client(erp_users[UserRole.ADMIN])
    prod_c = auth_client(erp_users[UserRole.PRODUCTION])
    sales_c = auth_client(erp_users[UserRole.SALESMAN])
    sales2_c = auth_client(erp_users["SALESMAN_2"])
    acc_c = auth_client(erp_users[UserRole.ACCOUNTANT])
    owner_c = auth_client(erp_users[UserRole.OWNER])

    # Units
    kg = Unit.objects.create(name="Kilogram", symbol="kg")
    litre = Unit.objects.create(name="Litre", symbol="L")
    pcs = Unit.objects.create(name="Pieces", symbol="pcs")
    pkt = Unit.objects.create(name="Packet", symbol="pkt")

    # Materials & Product
    flour = RawMaterial.objects.create(code="RM-F", name="Flour", unit=kg, reorder_level=Decimal("30"))
    oil = RawMaterial.objects.create(code="RM-O", name="Cooking Oil", unit=litre, reorder_level=Decimal("20"))
    spice = RawMaterial.objects.create(code="RM-S", name="Salt & Spice Mix", unit=kg, reorder_level=Decimal("2"))
    pouches = PackagingMaterial.objects.create(code="PKG-P", name="Pouch", unit=pcs, reorder_level=Decimal("200"))
    cartons = PackagingMaterial.objects.create(code="PKG-C", name="Carton", unit=pcs, reorder_level=Decimal("10"))
    murukku = Product.objects.create(
        sku="MRK-200",
        name="Murukku",
        category=ProductCategory.MURUKKU,
        pack_size="200 g",
        unit=pkt,
        hsn_code="21069099",
        gst_rate=Decimal("5.00"),
        selling_price=Decimal("50.00"),
    )

    supplier = Supplier.objects.create(code="SUP-1", name="Kaveri Mills", state="Tamil Nadu")
    retailer_a = Customer.objects.create(
        code="C-A",
        name="Retailer A",
        customer_type=CustomerType.RETAILER,
        state="Tamil Nadu",
        gstin="33AABCR1111A1Z5",
        assigned_salesman=erp_users[UserRole.SALESMAN],
    )
    distributor_b = Customer.objects.create(
        code="C-B",
        name="Distributor B",
        customer_type=CustomerType.DISTRIBUTOR,
        state="Karnataka",
        gstin="29AABCD2222B1Z8",
        assigned_salesman=erp_users[UserRole.SALESMAN],
    )

    # Create BOM via API
    bom_resp = prod_c.post(
        "/api/masters/boms/",
        {
            "product": murukku.id,
            "expected_output_qty": "200.000",
            "is_active": True,
            "items": [
                {"material_type": "RAW", "raw_material": flour.id, "standard_qty": "40.000", "unit": kg.id},
                {"material_type": "RAW", "raw_material": oil.id, "standard_qty": "10.000", "unit": litre.id},
                {"material_type": "RAW", "raw_material": spice.id, "standard_qty": "1.200", "unit": kg.id},
                {"material_type": "PACKAGING", "packaging_material": pouches.id, "standard_qty": "200.000", "unit": pcs.id},
                {"material_type": "PACKAGING", "packaging_material": cartons.id, "standard_qty": "10.000", "unit": pcs.id},
            ],
        },
        format="json",
    )
    assert bom_resp.status_code == 201, bom_resp.data
    bom_id = bom_resp.data["id"]

    # Opening stocks via API (Exact PDF Sec 5 rates: Flour Rs.42, Oil Rs.140, Spice Rs.200, Pouch Rs.2.50, Carton Rs.15)
    for item_type, item_id, qty, cost in [
        ("RAW", flour.id, "100", "42"),
        ("RAW", oil.id, "30", "140"),
        ("RAW", spice.id, "5", "200"),
        ("PACKAGING", pouches.id, "500", "2.5"),
        ("PACKAGING", cartons.id, "30", "15"),
        ("FINISHED", murukku.id, "50", "31"),
    ]:
        r = admin_c.post(
            "/api/inventory/opening-stock/",
            {"item_type": item_type, "item_id": item_id, "quantity": qty, "unit_cost": cost},
            format="json",
        )
        assert r.status_code == 201, r.data

    # Purchase: Flour 60 kg @ Rs.45/kg
    pur_resp = admin_c.post(
        "/api/purchases/",
        {
            "supplier": supplier.id,
            "invoice_ref": "MILL-001",
            "auto_confirm": True,
            "items": [
                {
                    "material_type": "RAW",
                    "raw_material": flour.id,
                    "quantity": "60.000",
                    "unit_rate": "45.0000",
                }
            ],
        },
        format="json",
    )
    assert pur_resp.status_code == 201, pur_resp.data
    assert get_stock_balance(StockItemType.RAW, flour.id) == Decimal("160.000")

    # BOM calculation endpoint
    calc_resp = prod_c.get(f"/api/masters/boms/{bom_id}/calculate/?batch_multiplier=1")
    assert calc_resp.status_code == 200
    assert calc_resp.data["is_stock_sufficient"] is True

    # Production Run (benchmark exact inputs)
    run_resp = prod_c.post(
        "/api/production/runs/",
        {
            "product": murukku.id,
            "bom": bom_id,
            "batch_multiplier": "1.000",
            "actual_good_output_qty": "188.000",
            "wastage_qty": "12.000",
            "labour_cost": "1200.00",
            "gas_power_cost": "600.00",
            "consumptions": [
                {"material_type": "RAW", "raw_material": flour.id, "actual_qty": "40.000", "damaged_qty": "0"},
                {"material_type": "RAW", "raw_material": oil.id, "actual_qty": "10.500", "damaged_qty": "0"},
                {"material_type": "RAW", "raw_material": spice.id, "actual_qty": "1.200", "damaged_qty": "0"},
                {"material_type": "PACKAGING", "packaging_material": pouches.id, "actual_qty": "188.000", "damaged_qty": "6.000"},
                {"material_type": "PACKAGING", "packaging_material": cartons.id, "actual_qty": "9.000", "damaged_qty": "0"},
            ],
        },
        format="json",
    )
    assert run_resp.status_code == 201, run_resp.data

    # Assert exact benchmark inventory & variance results
    assert get_stock_balance(StockItemType.RAW, flour.id) == Decimal("120.000")
    assert get_stock_balance(StockItemType.RAW, oil.id) == Decimal("19.500")
    assert get_stock_balance(StockItemType.PACKAGING, pouches.id) == Decimal("306.000")
    assert get_stock_balance(StockItemType.FINISHED, murukku.id) == Decimal("238.000")

    assert Decimal(run_resp.data["yield_variance_pct"]) == Decimal("-6.00")
    assert run_resp.data["has_variance_flag"] is True

    oil_line = next(c for c in run_resp.data["consumptions"] if c["raw_material"] == oil.id)
    assert Decimal(oil_line["variance_pct"]) == Decimal("5.00")
    assert oil_line["is_variance_flagged"] is True

    # Verify exact Weighted Average Product Costing using exact PDF Sec 5 opening & purchase rates:
    # Flour Moving Weighted Avg = (100*42 + 60*45) / 160 = 6900 / 160 = 43.1250/kg -> 40 * 43.125 = 1725.00
    # Oil: 10.5 * 140 = 1470.00
    # Spice: 1.2 * 200 = 240.00 -> Raw Total = 3435.00
    # Pouches: 194 * 2.5 = 485.00; Cartons: 9 * 15 = 135.00 -> Pkg Total = 620.00
    # Overheads: 1200 + 600 = 1800.00
    # Total Cost = 3435 + 620 + 1800 = 5855.00; Cost/pkt = 5855 / 188 = 31.1436
    assert Decimal(run_resp.data["raw_material_cost"]) == Decimal("3435.00")
    assert Decimal(run_resp.data["packaging_cost"]) == Decimal("620.00")
    assert Decimal(run_resp.data["total_production_cost"]) == Decimal("5855.00")
    assert Decimal(run_resp.data["cost_per_good_packet"]) == Decimal("31.1436")

    # Salesman 2 cannot place order for Salesman 1's assigned customer
    unauth_ord = sales2_c.post(
        "/api/sales/orders/",
        {"customer": retailer_a.id, "items": [{"product": murukku.id, "quantity": "10"}]},
        format="json",
    )
    assert unauth_ord.status_code == 403

    # Salesman 1 places Retailer A order (150 packets) with idempotency key
    ord_a_resp = sales_c.post(
        "/api/sales/orders/",
        {
            "customer": retailer_a.id,
            "idempotency_key": "bench-ord-a-1",
            "items": [{"product": murukku.id, "quantity": "150"}],
        },
        format="json",
    )
    assert ord_a_resp.status_code == 201
    ord_a_id = ord_a_resp.data["id"]

    # Duplicate idempotency key returns existing order without duplicating
    ord_a_dup = sales_c.post(
        "/api/sales/orders/",
        {
            "customer": retailer_a.id,
            "idempotency_key": "bench-ord-a-1",
            "items": [{"product": murukku.id, "quantity": "150"}],
        },
        format="json",
    )
    assert ord_a_dup.status_code == 200
    assert ord_a_dup.data["id"] == ord_a_id

    # Admin approves Retailer A order
    assert admin_c.post(f"/api/sales/orders/{ord_a_id}/approve/", {}, format="json").status_code == 200

    # Admin generates Intra-State GST Invoice (TN -> TN: CGST 2.5% + SGST 2.5%)
    inv_a_resp = admin_c.post(f"/api/sales/orders/{ord_a_id}/generate-invoice/", {}, format="json")
    assert inv_a_resp.status_code == 201, inv_a_resp.data
    inv_a_id = inv_a_resp.data["id"]
    assert inv_a_resp.data["is_inter_state"] is False
    assert Decimal(inv_a_resp.data["taxable_total"]) == Decimal("7500.00")
    assert Decimal(inv_a_resp.data["cgst_total"]) == Decimal("187.50")
    assert Decimal(inv_a_resp.data["sgst_total"]) == Decimal("187.50")
    assert Decimal(inv_a_resp.data["igst_total"]) == Decimal("0.00")
    assert Decimal(inv_a_resp.data["grand_total"]) == Decimal("7875.00")

    # Download real PDF invoice from backend
    pdf_resp = admin_c.get(f"/api/sales/invoices/{inv_a_id}/pdf/")
    assert pdf_resp.status_code == 200
    assert pdf_resp["Content-Type"] == "application/pdf"
    assert pdf_resp.content.startswith(b"%PDF-")

    # Dispatch Retailer A invoice -> finished stock drops 238 -> 88
    dsp_resp = admin_c.post(
        "/api/sales/dispatches/",
        {"invoice": inv_a_id, "vehicle_no": "TN-45-AB-1234"},
        format="json",
    )
    assert dsp_resp.status_code == 201, dsp_resp.data
    assert get_stock_balance(StockItemType.FINISHED, murukku.id) == Decimal("88.000")

    # Duplicate dispatch MUST be blocked!
    dup_dsp = admin_c.post("/api/sales/dispatches/", {"invoice": inv_a_id}, format="json")
    assert dup_dsp.status_code == 400
    assert get_stock_balance(StockItemType.FINISHED, murukku.id) == Decimal("88.000")

    # Payment: Retailer A pays Rs. 4,000 -> Outstanding = Rs. 3,875
    pay_resp = sales_c.post(
        "/api/sales/payments/",
        {
            "customer": retailer_a.id,
            "invoice": inv_a_id,
            "amount": "4000.00",
            "payment_mode": "UPI",
            "reference_number": "UPI-1001",
            "idempotency_key": "pay-a-4000",
        },
        format="json",
    )
    assert pay_resp.status_code == 201, pay_resp.data
    inv_a_after = admin_c.get(f"/api/sales/invoices/{inv_a_id}/").data
    assert Decimal(inv_a_after["allocated_payments"]) == Decimal("4000.00")
    assert Decimal(inv_a_after["outstanding_amount"]) == Decimal("3875.00")

    # Over-allocation beyond outstanding blocked
    over_pay = admin_c.post(
        "/api/sales/payments/",
        {"customer": retailer_a.id, "invoice": inv_a_id, "amount": "5000.00", "payment_mode": "CASH"},
        format="json",
    )
    assert over_pay.status_code == 400

    # Distributor B (Karnataka) orders 120 packets -> Shortage = 32 packets!
    ord_b_resp = sales_c.post(
        "/api/sales/orders/",
        {"customer": distributor_b.id, "items": [{"product": murukku.id, "quantity": "120"}]},
        format="json",
    )
    assert ord_b_resp.status_code == 201
    ord_b_id = ord_b_resp.data["id"]

    stock_chk = admin_c.get(f"/api/sales/orders/{ord_b_id}/stock-check/").data
    assert stock_chk["is_sufficient"] is False
    assert Decimal(stock_chk["items"][0]["shortage_qty"]) == Decimal("32.000")

    # Approval blocked when stock is insufficient
    approve_fail = admin_c.post(f"/api/sales/orders/{ord_b_id}/approve/", {}, format="json")
    assert approve_fail.status_code == 400

    # Add 50 packets via adjustment to test Inter-State IGST invoice for Distributor B (Karnataka)
    admin_c.post(
        "/api/inventory/adjustments/",
        {"item_type": "FINISHED", "item_id": murukku.id, "quantity": "50", "notes": "Extra stock"},
        format="json",
    )
    assert admin_c.post(f"/api/sales/orders/{ord_b_id}/approve/", {}, format="json").status_code == 200
    inv_b_resp = admin_c.post(f"/api/sales/orders/{ord_b_id}/generate-invoice/", {}, format="json")
    assert inv_b_resp.status_code == 201
    assert inv_b_resp.data["is_inter_state"] is True
    assert Decimal(inv_b_resp.data["taxable_total"]) == Decimal("6000.00")
    assert Decimal(inv_b_resp.data["cgst_total"]) == Decimal("0.00")
    assert Decimal(inv_b_resp.data["sgst_total"]) == Decimal("0.00")
    assert Decimal(inv_b_resp.data["igst_total"]) == Decimal("300.00")
    assert Decimal(inv_b_resp.data["grand_total"]) == Decimal("6300.00")

    # Accountant reports & exports (CSV, XLSX, PDF)
    for rep in ["sales-register", "gst-summary", "stock-summary", "product-costing", "outstanding-ageing"]:
        r = acc_c.get(f"/api/reports/{rep}/")
        assert r.status_code == 200
        assert r.data["count"] >= 1

    csv_exp = acc_c.get("/api/reports/sales-register/export/?format=csv")
    assert csv_exp.status_code == 200
    assert b"Invoice No" in csv_exp.content

    xlsx_exp = acc_c.get("/api/reports/gst-summary/export/?format=xlsx")
    assert xlsx_exp.status_code == 200
    assert xlsx_exp.content[:2] == b"PK"

    pdf_exp = acc_c.get("/api/reports/product-costing/export/?format=pdf")
    assert pdf_exp.status_code == 200
    assert pdf_exp.content.startswith(b"%PDF-")

    # Owner dashboard returns real database metrics
    owner_dash = owner_c.get("/api/reports/dashboard/owner/")
    assert owner_dash.status_code == 200
    assert Decimal(owner_dash.data["kpis"]["revenue"]) == Decimal("14175.00")
    assert Decimal(owner_dash.data["kpis"]["collections"]) == Decimal("4000.00")


@pytest.mark.django_db
def test_production_atomic_rollback_on_insufficient_material(erp_users):
    prod_c = auth_client(erp_users[UserRole.PRODUCTION])
    kg = Unit.objects.create(name="Kilogram", symbol="kg")
    pkt = Unit.objects.create(name="Packet", symbol="pkt")
    flour = RawMaterial.objects.create(code="RM-RB", name="Flour", unit=kg)
    oil = RawMaterial.objects.create(code="RM-RBO", name="Oil", unit=kg)
    product = Product.objects.create(
        sku="RB-1", name="Test Murukku", category=ProductCategory.MURUKKU, unit=pkt, selling_price=Decimal("50")
    )
    bom = BOM.objects.create(product=product, expected_output_qty=Decimal("100"))
    BOMItem.objects.create(bom=bom, material_type=MaterialType.RAW, raw_material=flour, standard_qty=Decimal("20"), unit=kg)
    BOMItem.objects.create(bom=bom, material_type=MaterialType.RAW, raw_material=oil, standard_qty=Decimal("10"), unit=kg)

    # Flour has plenty (50), Oil has only 2 (insufficient for 10)
    record_stock_movement(item_type=StockItemType.RAW, item_id=flour.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("50"), unit_cost=Decimal("40"), source_type="OPENING")
    record_stock_movement(item_type=StockItemType.RAW, item_id=oil.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("2"), unit_cost=Decimal("100"), source_type="OPENING")

    resp = prod_c.post(
        "/api/production/runs/",
        {"product": product.id, "bom": bom.id, "batch_multiplier": "1", "actual_good_output_qty": "100"},
        format="json",
    )
    assert resp.status_code == 400
    # Flour MUST NOT have been deducted because the entire transaction rolled back!
    assert get_stock_balance(StockItemType.RAW, flour.id) == Decimal("50.000")
    assert get_stock_balance(StockItemType.FINISHED, product.id) == Decimal("0.000")


@pytest.mark.django_db(transaction=True)
def test_concurrent_stock_issue_prevents_negative_balance():
    pkt = Unit.objects.create(name="Packet", symbol="pkt")
    product = Product.objects.create(
        sku="CONC-1", name="Concurrent Snack", category=ProductCategory.CHIPS, unit=pkt, selling_price=Decimal("50")
    )
    record_stock_movement(
        item_type=StockItemType.FINISHED,
        item_id=product.id,
        movement_type=MovementType.OPENING,
        quantity_delta=Decimal("100.000"),
        unit_cost=Decimal("30.00"),
        source_type="OPENING",
    )

    def attempt_issue(_idx):
        close_old_connections()
        try:
            record_stock_movement(
                item_type=StockItemType.FINISHED,
                item_id=product.id,
                movement_type=MovementType.SALES_DISPATCH,
                quantity_delta=Decimal("-60.000"),
                source_type="DISPATCH",
                source_id=f"T-{_idx}",
            )
            return "SUCCESS"
        except InsufficientStockError:
            return "BLOCKED"
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt_issue, [1, 2]))

    from django.db import connections
    connections.close_all()

    assert sorted(results) == ["BLOCKED", "SUCCESS"]
    assert get_stock_balance(StockItemType.FINISHED, product.id) == Decimal("40.000")


@pytest.mark.django_db
def test_pdf_unit_conversion_order_edit_credit_note_and_planning(erp_users):
    """Verifies PDF Sec 4.2 (Admin edit order + Credit Note), Sec 4.3 (Unit conversion), and Sec 6 (Production planning)."""
    admin_c = auth_client(erp_users[UserRole.ADMIN])
    prod_c = auth_client(erp_users[UserRole.PRODUCTION])
    sales_c = auth_client(erp_users[UserRole.SALESMAN])

    kg = Unit.objects.create(name="Kilogram", symbol="kg", factor_to_base=Decimal("1"))
    gram = Unit.objects.create(name="Gram", symbol="g", base_unit=kg, factor_to_base=Decimal("0.001"))
    pkt = Unit.objects.create(name="Packet", symbol="pkt", factor_to_base=Decimal("1"))
    ctn = Unit.objects.create(name="Carton", symbol="ctn", base_unit=pkt, factor_to_base=Decimal("20"))

    # Unit conversion endpoint: 1200 g -> 1.200 kg, 2 cartons -> 40.000 pkt
    conv1 = prod_c.post("/api/masters/units/convert/", {"quantity": "1200", "from_unit": gram.id, "to_unit": kg.id}, format="json")
    assert conv1.status_code == 200
    assert Decimal(conv1.data["converted_quantity"]) == Decimal("1.200")

    conv2 = prod_c.post("/api/masters/units/convert/", {"quantity": "2", "from_unit": ctn.id, "to_unit": pkt.id}, format="json")
    assert conv2.status_code == 200
    assert Decimal(conv2.data["converted_quantity"]) == Decimal("40.000")

    # BOM using grams for spice tracked in kg
    spice = RawMaterial.objects.create(code="RM-SP-U", name="Spice", unit=kg)
    product = Product.objects.create(sku="U-MRK", name="Murukku", category=ProductCategory.MURUKKU, unit=pkt, selling_price=Decimal("50"))
    bom = BOM.objects.create(product=product, expected_output_qty=Decimal("200"))
    BOMItem.objects.create(bom=bom, material_type=MaterialType.RAW, raw_material=spice, standard_qty=Decimal("1200"), unit=gram)
    record_stock_movement(item_type=StockItemType.RAW, item_id=spice.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("5"), unit_cost=Decimal("200"), source_type="OPENING")

    run_r = prod_c.post(
        "/api/production/runs/",
        {
            "product": product.id,
            "bom": bom.id,
            "batch_multiplier": "1",
            "actual_good_output_qty": "200",
            "consumptions": [{"material_type": "RAW", "raw_material": spice.id, "unit": gram.id, "actual_qty": "1200"}],
        },
        format="json",
    )
    assert run_r.status_code == 201, run_r.data
    assert get_stock_balance(StockItemType.RAW, spice.id) == Decimal("3.800")

    # Admin edits pending order quantity & price before approval
    cust = Customer.objects.create(code="C-ED", name="Edit Store", state="Tamil Nadu", assigned_salesman=erp_users[UserRole.SALESMAN])
    ord_r = sales_c.post("/api/sales/orders/", {"customer": cust.id, "items": [{"product": product.id, "quantity": "250"}]}, format="json")
    assert ord_r.status_code == 201
    oid = ord_r.data["id"]

    # Production planning recommends 1 batch because demand 250 > stock 200 (shortage 50)
    plan_r = prod_c.get("/api/production/planning/")
    assert plan_r.status_code == 200
    assert plan_r.data["results"][0]["recommended_batches"] == 1
    assert Decimal(plan_r.data["results"][0]["shortage_qty"]) == Decimal("50.000")

    # Admin edits order down to 100 pkts @ Rs.48 before approving
    edit_r = admin_c.patch(
        f"/api/sales/orders/{oid}/",
        {"items": [{"product": product.id, "quantity": "100", "unit_price": "48.00"}]},
        format="json",
    )
    assert edit_r.status_code == 200
    assert Decimal(edit_r.data["subtotal"]) == Decimal("4800.00")
    assert Decimal(edit_r.data["grand_total"]) == Decimal("5040.00")

    # Approve, invoice, and issue a Credit Note (posted invoice is NEVER deleted)
    assert admin_c.post(f"/api/sales/orders/{oid}/approve/", {}, format="json").status_code == 200
    inv_r = admin_c.post(f"/api/sales/orders/{oid}/generate-invoice/", {}, format="json")
    assert inv_r.status_code == 201
    inv_id = inv_r.data["id"]

    cn_r = admin_c.post(
        f"/api/sales/invoices/{inv_id}/credit-note/",
        {"amount": "5040.00", "reason": "Full cancellation via credit note"},
        format="json",
    )
    assert cn_r.status_code == 201, cn_r.data
    inv_after = admin_c.get(f"/api/sales/invoices/{inv_id}/").data
    assert Decimal(inv_after["credit_notes_total"]) == Decimal("5040.00")
    assert Decimal(inv_after["outstanding_amount"]) == Decimal("0.00")
    assert len(inv_after["credit_notes"]) == 1

    # Salesman dashboard returns customer-wise sales
    sdash = sales_c.get("/api/reports/dashboard/salesman/").data
    assert len(sdash["customer_sales"]) == 1
    assert Decimal(sdash["customer_sales"][0]["invoiced_total"]) == Decimal("5040.00")
