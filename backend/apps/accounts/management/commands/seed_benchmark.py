"""
Repeatable development/test seed command for the exact SmartFactory benchmark scenario
plus realistic South Indian packaged snacks catalog and 5 role demo accounts.

IMPORTANT: Never run automatically in production; invoke explicitly via:
    python manage.py seed_benchmark --reset
"""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.models import AuditLog, CompanySetting, Notification, User, UserRole
from apps.inventory.models import MovementType, StockItemType, StockLedger
from apps.inventory.services import get_stock_balance, record_stock_movement
from apps.masters.models import (
    BOM,
    BOMItem,
    Customer,
    CustomerType,
    MaterialType,
    PackagingMaterial,
    Product,
    ProductCategory,
    ProductPrice,
    RawMaterial,
    Supplier,
    Unit,
)
from apps.production.models import Expense, ProductionConsumption, ProductionRun
from apps.production.services import execute_production_run
from apps.purchases.models import Purchase, PurchaseItem
from apps.purchases.services import confirm_purchase, generate_purchase_number
from apps.sales.models import (
    CreditNote,
    Dispatch,
    DispatchItem,
    Invoice,
    InvoiceItem,
    OrderStatusHistory,
    Payment,
    PaymentAllocation,
    PaymentMode,
    SalesOrder,
    SalesOrderItem,
)
from apps.sales.services import (
    approve_sales_order,
    check_order_stock,
    create_dispatch,
    create_sales_order,
    generate_gst_invoice,
    get_invoice_outstanding,
    record_payment,
)


class Command(BaseCommand):
    help = "Seeds the SmartFactory ERP database with the exact NIT Trichy benchmark scenario."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Clear existing operational and master records before seeding.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        if options["reset"]:
            self.stdout.write("Resetting operational and master data...")
            CreditNote.objects.all().delete()
            PaymentAllocation.objects.all().delete()
            Payment.objects.all().delete()
            DispatchItem.objects.all().delete()
            Dispatch.objects.all().delete()
            InvoiceItem.objects.all().delete()
            Invoice.objects.all().delete()
            OrderStatusHistory.objects.all().delete()
            SalesOrderItem.objects.all().delete()
            SalesOrder.objects.all().delete()
            Expense.objects.all().delete()
            ProductionConsumption.objects.all().delete()
            ProductionRun.objects.all().delete()
            PurchaseItem.objects.all().delete()
            Purchase.objects.all().delete()
            StockLedger.objects.all().delete()
            BOMItem.objects.all().delete()
            BOM.objects.all().delete()
            ProductPrice.objects.all().delete()
            Product.objects.all().delete()
            RawMaterial.objects.all().delete()
            PackagingMaterial.objects.all().delete()
            Customer.objects.all().delete()
            Supplier.objects.all().delete()
            Notification.objects.all().delete()
            AuditLog.objects.all().delete()

        # 1. Company Settings
        company = CompanySetting.get_solo()
        company.company_name = "SmartFactory Foods Pvt. Ltd."
        company.gstin = "33AABCS1234F1Z5"
        company.state = "Tamil Nadu"
        company.address = "Plot 14, SIDCO Industrial Estate, Tiruchirappalli, Tamil Nadu 620015"
        company.invoice_prefix = "SF"
        company.financial_year = "2025-26"
        company.variance_tolerance_pct = Decimal("3.00")
        company.default_gst_rate = Decimal("5.00")
        company.save()

        # 2. Users (one per role + extra salesman)
        users_spec = [
            ("salesman", "salesman@smartfactory.in", "Arjun", "Kumar", UserRole.SALESMAN, "+91 98401 11001", "Trichy & Thanjavur"),
            ("salesman2", "priya.sales@smartfactory.in", "Priya", "Nair", UserRole.SALESMAN, "+91 98401 11002", "Bengaluru & Hosur"),
            ("admin", "admin@smartfactory.in", "Meenakshi", "Sundaram", UserRole.ADMIN, "+91 98401 22001", "HQ Billing Desk"),
            ("production", "production@smartfactory.in", "Karthik", "Vel", UserRole.PRODUCTION, "+91 98401 33001", "Factory Floor A"),
            ("accountant", "accountant@smartfactory.in", "Subramanian", "Iyer", UserRole.ACCOUNTANT, "+91 98401 44001", "External Audit"),
            ("owner", "owner@smartfactory.in", "Lakshmi", "Narayanan", UserRole.OWNER, "+91 98401 55001", "Executive"),
        ]
        user_map = {}
        for uname, email, fn, ln, role, phone, terr in users_spec:
            u, created = User.objects.get_or_create(
                username=uname,
                defaults={
                    "email": email,
                    "first_name": fn,
                    "last_name": ln,
                    "role": role,
                    "phone": phone,
                    "territory": terr,
                    "is_staff": role in (UserRole.ADMIN, UserRole.OWNER),
                },
            )
            u.email = email
            u.first_name = fn
            u.last_name = ln
            u.role = role
            u.phone = phone
            u.territory = terr
            u.set_password("Smart@123")
            u.save()
            user_map[uname] = u

        salesman = user_map["salesman"]
        salesman_b = user_map["salesman2"]
        admin_user = user_map["admin"]
        prod_user = user_map["production"]

        # 3. Units with exact conversion hierarchy (kg<->g, L<->ml, pkt<->carton)
        kg, _ = Unit.objects.get_or_create(symbol="kg", defaults={"name": "Kilogram", "factor_to_base": Decimal("1.000000")})
        gram, _ = Unit.objects.get_or_create(symbol="g", defaults={"name": "Gram", "base_unit": kg, "factor_to_base": Decimal("0.001000")})
        if gram.base_unit_id != kg.id:
            gram.base_unit = kg
            gram.factor_to_base = Decimal("0.001000")
            gram.save(update_fields=["base_unit", "factor_to_base"])

        litre, _ = Unit.objects.get_or_create(symbol="L", defaults={"name": "Litre", "factor_to_base": Decimal("1.000000")})
        ml, _ = Unit.objects.get_or_create(symbol="ml", defaults={"name": "Millilitre", "base_unit": litre, "factor_to_base": Decimal("0.001000")})
        if ml.base_unit_id != litre.id:
            ml.base_unit = litre
            ml.factor_to_base = Decimal("0.001000")
            ml.save(update_fields=["base_unit", "factor_to_base"])

        pcs, _ = Unit.objects.get_or_create(symbol="pcs", defaults={"name": "Pieces", "factor_to_base": Decimal("1.000000")})
        pkt, _ = Unit.objects.get_or_create(symbol="pkt", defaults={"name": "Packet", "factor_to_base": Decimal("1.000000")})
        carton_u, _ = Unit.objects.get_or_create(symbol="ctn", defaults={"name": "Carton (20 Packets)", "base_unit": pkt, "factor_to_base": Decimal("20.000000")})
        if carton_u.base_unit_id != pkt.id:
            carton_u.base_unit = pkt
            carton_u.factor_to_base = Decimal("20.000000")
            carton_u.save(update_fields=["base_unit", "factor_to_base"])

        # 4. Suppliers
        sup_kaveri, _ = Supplier.objects.get_or_create(
            code="SUP-001",
            defaults={
                "name": "Kaveri Agro Mills",
                "gstin": "33AAACK9012M1Z4",
                "state": "Tamil Nadu",
                "contact_person": "R. Senthil",
                "phone": "+91 94431 20011",
                "address": "Thanjavur Main Road, Tiruchirappalli, TN",
            },
        )
        Supplier.objects.get_or_create(
            code="SUP-002",
            defaults={
                "name": "Madurai Edible Oils & Spices",
                "gstin": "33AABCM4511D1Z9",
                "state": "Tamil Nadu",
                "contact_person": "V. Murugan",
                "phone": "+91 94431 20022",
                "address": "Kappalur Industrial Estate, Madurai, TN",
            },
        )

        # 5. Customers (Benchmark Retailer A + Distributor B + additional South Indian customers)
        retailer_a, _ = Customer.objects.get_or_create(
            code="CUST-001",
            defaults={
                "name": "Retailer A - Sri Saravana Stores",
                "customer_type": CustomerType.RETAILER,
                "state": "Tamil Nadu",
                "gstin": "33AABCR1111A1Z5",
                "contact_person": "S. Ramesh",
                "phone": "+91 98421 50001",
                "email": "orders@srisaravana.in",
                "address": "42 Big Bazaar Street, Tiruchirappalli, Tamil Nadu 620008",
                "credit_limit": Decimal("50000.00"),
                "assigned_salesman": salesman,
            },
        )
        distributor_b, _ = Customer.objects.get_or_create(
            code="CUST-002",
            defaults={
                "name": "Distributor B - Deccan Foods",
                "customer_type": CustomerType.DISTRIBUTOR,
                "state": "Karnataka",
                "gstin": "29AABCD2222B1Z8",
                "contact_person": "K. Prakash",
                "phone": "+91 98450 60002",
                "email": "procurement@deccanfoods.in",
                "address": "88 Peenya Industrial Area, Bengaluru, Karnataka 560058",
                "credit_limit": Decimal("150000.00"),
                "assigned_salesman": salesman_b,
            },
        )
        Customer.objects.get_or_create(
            code="CUST-003",
            defaults={
                "name": "Anbu Supermarket",
                "customer_type": CustomerType.SUPERMARKET,
                "state": "Tamil Nadu",
                "gstin": "33AABCA3333C1Z2",
                "contact_person": "M. Anbu",
                "phone": "+91 98421 50003",
                "address": "15 Thillai Nagar 11th Cross, Tiruchirappalli, TN",
                "credit_limit": Decimal("75000.00"),
                "assigned_salesman": salesman,
            },
        )
        Customer.objects.get_or_create(
            code="CUST-004",
            defaults={
                "name": "Kovai Wholesale Mart",
                "customer_type": CustomerType.WHOLESALER,
                "state": "Tamil Nadu",
                "gstin": "33AABCK4444D1Z6",
                "contact_person": "P. Natarajan",
                "phone": "+91 98422 70004",
                "address": "RS Puram Market Road, Coimbatore, TN",
                "credit_limit": Decimal("100000.00"),
                "assigned_salesman": salesman,
            },
        )

        # 6. Raw & Packaging Materials
        flour, _ = RawMaterial.objects.get_or_create(
            code="RM-FLOUR", defaults={"name": "Rice & Urad Flour", "unit": kg, "reorder_level": Decimal("40.000")}
        )
        oil, _ = RawMaterial.objects.get_or_create(
            code="RM-OIL", defaults={"name": "Refined Cooking Oil", "unit": litre, "reorder_level": Decimal("25.000")}
        )
        spice, _ = RawMaterial.objects.get_or_create(
            code="RM-SPICE", defaults={"name": "Salt & Spice Mix", "unit": kg, "reorder_level": Decimal("3.000")}
        )
        besan, _ = RawMaterial.objects.get_or_create(
            code="RM-BESAN", defaults={"name": "Gram Flour (Besan)", "unit": kg, "reorder_level": Decimal("30.000")}
        )
        banana, _ = RawMaterial.objects.get_or_create(
            code="RM-BANANA", defaults={"name": "Nendran Raw Banana", "unit": kg, "reorder_level": Decimal("25.000")}
        )
        sugar_ghee, _ = RawMaterial.objects.get_or_create(
            code="RM-GHEE", defaults={"name": "Pure Cow Ghee & Sugar Mix", "unit": kg, "reorder_level": Decimal("15.000")}
        )

        pouches, _ = PackagingMaterial.objects.get_or_create(
            code="PKG-POUCH", defaults={"name": "200g Laminated Pouch", "unit": pcs, "reorder_level": Decimal("350.000")}
        )
        cartons, _ = PackagingMaterial.objects.get_or_create(
            code="PKG-CARTON", defaults={"name": "20-Pack Corrugated Carton", "unit": pcs, "reorder_level": Decimal("15.000")}
        )

        # 7. Products (Murukku 200 g benchmark + Mixture, Chips, Sweets)
        murukku, _ = Product.objects.get_or_create(
            sku="SF-MRK-200",
            defaults={
                "name": "Traditional Butter Murukku",
                "category": ProductCategory.MURUKKU,
                "pack_size": "200 g",
                "unit": pkt,
                "hsn_code": "21069099",
                "gst_rate": Decimal("5.00"),
                "selling_price": Decimal("50.00"),
                "reorder_level": Decimal("100.000"),
                "image_url": "/products/murukku.jpg",
                "description": "Crispy hand-twisted South Indian rice & urad murukku.",
            },
        )
        mixture, _ = Product.objects.get_or_create(
            sku="SF-MIX-200",
            defaults={
                "name": "Madras Kara Mixture",
                "category": ProductCategory.MIXTURE,
                "pack_size": "200 g",
                "unit": pkt,
                "hsn_code": "21069099",
                "gst_rate": Decimal("5.00"),
                "selling_price": Decimal("55.00"),
                "reorder_level": Decimal("60.000"),
                "image_url": "/products/mixture.jpg",
                "description": "Spicy South Indian sev, boondi, roasted peanut & curry leaf blend.",
            },
        )
        chips, _ = Product.objects.get_or_create(
            sku="SF-CHP-150",
            defaults={
                "name": "Nendran Banana Chips",
                "category": ProductCategory.CHIPS,
                "pack_size": "150 g",
                "unit": pkt,
                "hsn_code": "20081940",
                "gst_rate": Decimal("5.00"),
                "selling_price": Decimal("65.00"),
                "reorder_level": Decimal("50.000"),
                "image_url": "/products/chips.jpg",
                "description": "Golden crispy Nendran banana chips lightly dusted with rock salt & pepper.",
            },
        )
        sweets, _ = Product.objects.get_or_create(
            sku="SF-SWT-250",
            defaults={
                "name": "Ghee Mysore Pak",
                "category": ProductCategory.SWEETS,
                "pack_size": "250 g",
                "unit": pkt,
                "hsn_code": "21069099",
                "gst_rate": Decimal("5.00"),
                "selling_price": Decimal("120.00"),
                "reorder_level": Decimal("40.000"),
                "image_url": "/products/sweets.jpg",
                "description": "Melt-in-mouth traditional South Indian pure ghee Mysore Pak.",
            },
        )
        kai_murukku, _ = Product.objects.get_or_create(
            sku="SF-MRK-500",
            defaults={
                "name": "Kai Murukku Family Pack",
                "category": ProductCategory.MURUKKU,
                "pack_size": "500 g",
                "unit": pkt,
                "hsn_code": "21069099",
                "gst_rate": Decimal("5.00"),
                "selling_price": Decimal("115.00"),
                "reorder_level": Decimal("40.000"),
                "image_url": "/products/murukku.jpg",
                "description": "Authentic festive hand-spun Kai Murukku family pack.",
            },
        )
        garlic_murukku, _ = Product.objects.get_or_create(
            sku="SF-MRK-250G",
            defaults={
                "name": "Poondu (Garlic) Thenkuzhal Murukku",
                "category": ProductCategory.MURUKKU,
                "pack_size": "250 g",
                "unit": pkt,
                "hsn_code": "21069099",
                "gst_rate": Decimal("5.00"),
                "selling_price": Decimal("62.00"),
                "reorder_level": Decimal("40.000"),
                "image_url": "/products/murukku.jpg",
                "description": "Aromatic roasted garlic & cumin rice flour thenkuzhal murukku.",
            },
        )
        corn_mixture, _ = Product.objects.get_or_create(
            sku="SF-MIX-250C",
            defaults={
                "name": "Madras Cornflakes Mixture",
                "category": ProductCategory.MIXTURE,
                "pack_size": "250 g",
                "unit": pkt,
                "hsn_code": "21069099",
                "gst_rate": Decimal("5.00"),
                "selling_price": Decimal("68.00"),
                "reorder_level": Decimal("40.000"),
                "image_url": "/products/mixture.jpg",
                "description": "Crispy fried cornflakes tossed with peanuts, raisins & curry leaves.",
            },
        )
        pepper_chips, _ = Product.objects.get_or_create(
            sku="SF-CHP-200P",
            defaults={
                "name": "Malabar Black Pepper Banana Chips",
                "category": ProductCategory.CHIPS,
                "pack_size": "200 g",
                "unit": pkt,
                "hsn_code": "20081940",
                "gst_rate": Decimal("5.00"),
                "selling_price": Decimal("82.00"),
                "reorder_level": Decimal("40.000"),
                "image_url": "/products/chips.jpg",
                "description": "Thin-sliced Nendran chips seasoned with freshly crushed Tellicherry pepper.",
            },
        )
        halwa_sweet, _ = Product.objects.get_or_create(
            sku="SF-SWT-250H",
            defaults={
                "name": "Tirunelveli Wheat Ghee Halwa",
                "category": ProductCategory.SWEETS,
                "pack_size": "250 g",
                "unit": pkt,
                "hsn_code": "21069099",
                "gst_rate": Decimal("5.00"),
                "selling_price": Decimal("135.00"),
                "reorder_level": Decimal("30.000"),
                "image_url": "/products/sweets.jpg",
                "description": "Slow-cooked glossy wheat milk halwa with roasted cashews & pure cow ghee.",
            },
        )

        # 8. BOMs (Exact Benchmark BOM for Murukku 200 g)
        bom_murukku, created = BOM.objects.get_or_create(
            product=murukku,
            version=1,
            defaults={
                "expected_output_qty": Decimal("200.000"),
                "is_active": True,
                "notes": "Benchmark standard recipe for 200 packets of Murukku 200 g.",
                "created_by": prod_user,
            },
        )
        if created or not bom_murukku.items.exists():
            bom_murukku.items.all().delete()
            BOMItem.objects.create(bom=bom_murukku, material_type=MaterialType.RAW, raw_material=flour, standard_qty=Decimal("40.000"), unit=kg)
            BOMItem.objects.create(bom=bom_murukku, material_type=MaterialType.RAW, raw_material=oil, standard_qty=Decimal("10.000"), unit=litre)
            BOMItem.objects.create(bom=bom_murukku, material_type=MaterialType.RAW, raw_material=spice, standard_qty=Decimal("1.200"), unit=kg)
            BOMItem.objects.create(bom=bom_murukku, material_type=MaterialType.PACKAGING, packaging_material=pouches, standard_qty=Decimal("200.000"), unit=pcs)
            BOMItem.objects.create(bom=bom_murukku, material_type=MaterialType.PACKAGING, packaging_material=cartons, standard_qty=Decimal("10.000"), unit=pcs)

        # Additional BOMs for Mixture, Chips, Sweets
        bom_mix, c_mix = BOM.objects.get_or_create(
            product=mixture, version=1,
            defaults={"expected_output_qty": Decimal("150.000"), "is_active": True, "created_by": prod_user}
        )
        if c_mix or not bom_mix.items.exists():
            BOMItem.objects.create(bom=bom_mix, material_type=MaterialType.RAW, raw_material=besan, standard_qty=Decimal("30.000"), unit=kg)
            BOMItem.objects.create(bom=bom_mix, material_type=MaterialType.RAW, raw_material=oil, standard_qty=Decimal("8.000"), unit=litre)
            BOMItem.objects.create(bom=bom_mix, material_type=MaterialType.RAW, raw_material=spice, standard_qty=Decimal("1.500"), unit=kg)
            BOMItem.objects.create(bom=bom_mix, material_type=MaterialType.PACKAGING, packaging_material=pouches, standard_qty=Decimal("150.000"), unit=pcs)
            BOMItem.objects.create(bom=bom_mix, material_type=MaterialType.PACKAGING, packaging_material=cartons, standard_qty=Decimal("8.000"), unit=pcs)

        bom_chips, c_chp = BOM.objects.get_or_create(
            product=chips, version=1,
            defaults={"expected_output_qty": Decimal("120.000"), "is_active": True, "created_by": prod_user}
        )
        if c_chp or not bom_chips.items.exists():
            BOMItem.objects.create(bom=bom_chips, material_type=MaterialType.RAW, raw_material=banana, standard_qty=Decimal("36.000"), unit=kg)
            BOMItem.objects.create(bom=bom_chips, material_type=MaterialType.RAW, raw_material=oil, standard_qty=Decimal("7.500"), unit=litre)
            BOMItem.objects.create(bom=bom_chips, material_type=MaterialType.PACKAGING, packaging_material=pouches, standard_qty=Decimal("120.000"), unit=pcs)

        bom_sweets, c_swt = BOM.objects.get_or_create(
            product=sweets, version=1,
            defaults={"expected_output_qty": Decimal("100.000"), "is_active": True, "created_by": prod_user}
        )
        if c_swt or not bom_sweets.items.exists():
            BOMItem.objects.create(bom=bom_sweets, material_type=MaterialType.RAW, raw_material=besan, standard_qty=Decimal("12.000"), unit=kg)
            BOMItem.objects.create(bom=bom_sweets, material_type=MaterialType.RAW, raw_material=sugar_ghee, standard_qty=Decimal("18.000"), unit=kg)
            BOMItem.objects.create(bom=bom_sweets, material_type=MaterialType.PACKAGING, packaging_material=pouches, standard_qty=Decimal("100.000"), unit=pcs)

        # Skip transactional benchmark seeding if ledger already populated and --reset not given
        if StockLedger.objects.exists():
            self.stdout.write(self.style.WARNING("Transactional data already exists. Use --reset to re-seed."))
            return

        # 9. Opening Stock (EXACT PDF Section 5 Benchmark quantities & opening rates)
        record_stock_movement(item_type=StockItemType.RAW, item_id=flour.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("100.000"), unit_cost=Decimal("42.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.RAW, item_id=oil.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("30.000"), unit_cost=Decimal("140.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.RAW, item_id=spice.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("5.000"), unit_cost=Decimal("200.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.RAW, item_id=besan.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("80.000"), unit_cost=Decimal("78.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.RAW, item_id=banana.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("60.000"), unit_cost=Decimal("55.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.RAW, item_id=sugar_ghee.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("40.000"), unit_cost=Decimal("320.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)

        record_stock_movement(item_type=StockItemType.PACKAGING, item_id=pouches.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("500.000"), unit_cost=Decimal("2.5000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.PACKAGING, item_id=cartons.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("30.000"), unit_cost=Decimal("15.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)

        record_stock_movement(item_type=StockItemType.FINISHED, item_id=murukku.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("50.000"), unit_cost=Decimal("31.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.FINISHED, item_id=kai_murukku.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("65.000"), unit_cost=Decimal("72.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.FINISHED, item_id=garlic_murukku.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("90.000"), unit_cost=Decimal("38.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.FINISHED, item_id=mixture.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("140.000"), unit_cost=Decimal("34.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.FINISHED, item_id=corn_mixture.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("85.000"), unit_cost=Decimal("42.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.FINISHED, item_id=chips.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("110.000"), unit_cost=Decimal("41.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.FINISHED, item_id=pepper_chips.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("95.000"), unit_cost=Decimal("50.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.FINISHED, item_id=sweets.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("75.000"), unit_cost=Decimal("76.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)
        record_stock_movement(item_type=StockItemType.FINISHED, item_id=halwa_sweet.id, movement_type=MovementType.OPENING, quantity_delta=Decimal("60.000"), unit_cost=Decimal("88.0000"), source_type="OPENING", reference_no="OPEN-2025", user=admin_user)

        # 10. Benchmark Purchase: Flour 60 kg @ ₹45/kg
        p = Purchase.objects.create(
            purchase_number=generate_purchase_number(),
            supplier=sup_kaveri,
            invoice_ref="KAM/25-26/0198",
            notes="Benchmark raw material purchase - Rice & Urad Flour",
            created_by=admin_user,
        )
        PurchaseItem.objects.create(
            purchase=p,
            material_type=MaterialType.RAW,
            raw_material=flour,
            quantity=Decimal("60.000"),
            unit_rate=Decimal("45.0000"),
            line_total=Decimal("2700.00"),
        )
        confirm_purchase(p.id, user=admin_user)

        # 11. Benchmark Production Run (Murukku 200 g)
        run = execute_production_run(
            product=murukku,
            bom=bom_murukku,
            batch_multiplier=Decimal("1.000"),
            actual_good_output_qty=Decimal("188.000"),
            wastage_qty=Decimal("12.000"),
            consumptions_input=[
                {"material_type": MaterialType.RAW, "raw_material": flour.id, "actual_qty": Decimal("40.000"), "damaged_qty": Decimal("0")},
                {"material_type": MaterialType.RAW, "raw_material": oil.id, "actual_qty": Decimal("10.500"), "damaged_qty": Decimal("0")},
                {"material_type": MaterialType.RAW, "raw_material": spice.id, "actual_qty": Decimal("1.200"), "damaged_qty": Decimal("0")},
                {"material_type": MaterialType.PACKAGING, "packaging_material": pouches.id, "actual_qty": Decimal("188.000"), "damaged_qty": Decimal("6.000")},
                {"material_type": MaterialType.PACKAGING, "packaging_material": cartons.id, "actual_qty": Decimal("9.000"), "damaged_qty": Decimal("0")},
            ],
            labour_cost=Decimal("1200.00"),
            gas_power_cost=Decimal("600.00"),
            notes="NIT Trichy benchmark production batch for Murukku 200 g.",
            user=prod_user,
        )

        # 12. Benchmark Order 1: Retailer A (Tamil Nadu) - 150 packets -> Approve -> Invoice -> Dispatch -> Payment Rs.4000
        ord_a, _ = create_sales_order(
            customer=retailer_a,
            salesman=salesman,
            items_data=[{"product": murukku, "quantity": Decimal("150.000")}],
            delivery_notes="Deliver before 5 PM at Big Bazaar Street shop.",
        )
        approve_sales_order(ord_a.id, user=admin_user, remarks="Stock available (238 pkts). Approved.")
        inv_a = generate_gst_invoice(ord_a.id, user=admin_user)
        create_dispatch(
            invoice_id=inv_a.id,
            user=admin_user,
            vehicle_no="TN-45-BZ-4412",
            transporter="Kaveri Express Cargo",
            notes="Full dispatch of 150 packets to Retailer A.",
        )
        record_payment(
            customer=retailer_a,
            amount=Decimal("4000.00"),
            payment_mode=PaymentMode.UPI,
            reference_number="UPI-REF-88451209",
            invoice_id=inv_a.id,
            notes="Part payment collected against Retailer A invoice.",
            user=salesman,
        )

        # 13. Benchmark Order 2: Salesman B places Distributor B (Karnataka) - 120 packets (Shortage 32 pkts)
        ord_b, _ = create_sales_order(
            customer=distributor_b,
            salesman=salesman_b,
            items_data=[{"product": murukku, "quantity": Decimal("120.000")}],
            delivery_notes="Inter-state consignment to Bengaluru (IGST 5%). Placed by Salesman B.",
        )
        shortage_check = check_order_stock(ord_b)

        # Print exact verification summary
        self.stdout.write(self.style.SUCCESS("=== SmartFactory Benchmark Seeded Successfully ==="))
        self.stdout.write(f"Flour closing: {get_stock_balance(StockItemType.RAW, flour.id)} kg (Expected: 120.000)")
        self.stdout.write(f"Oil closing: {get_stock_balance(StockItemType.RAW, oil.id)} L (Expected: 19.500)")
        self.stdout.write(f"Pouches closing: {get_stock_balance(StockItemType.PACKAGING, pouches.id)} pcs (Expected: 306.000)")
        self.stdout.write(f"Finished Murukku closing: {get_stock_balance(StockItemType.FINISHED, murukku.id)} pkts (Expected: 88.000)")
        self.stdout.write(f"Yield variance: {run.yield_variance_pct}% (Expected: -6.00%)")
        self.stdout.write(f"Cost per good packet: Rs.{run.cost_per_good_packet}")
        self.stdout.write(f"Retailer A Invoice {inv_a.invoice_number}: Taxable={inv_a.taxable_total}, CGST={inv_a.cgst_total}, SGST={inv_a.sgst_total}, Total={inv_a.grand_total}")
        self.stdout.write(f"Retailer A Outstanding: Rs.{get_invoice_outstanding(inv_a)} (Expected: 3875.00)")
        self.stdout.write(f"Distributor B Shortage: {shortage_check['items'][0]['shortage_qty']} pkts (Expected: 32.000)")
