from decimal import Decimal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db.models import DecimalField, Q, Sum, Value
from django.db.models.functions import Coalesce, TruncMonth
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import AuditLog, CompanySetting, UserRole
from apps.accounts.permissions import (
    ADMIN_OWNER,
    INTERNAL_ROLES,
    IsAuditViewer,
    IsOwnerOnly,
    IsSalesmanOnly,
    role_permission,
)
from apps.inventory.models import StockItemType, StockLedger
from apps.inventory.services import build_inventory_summary
from apps.masters.models import Customer, Product
from apps.production.models import ProductionConsumption, ProductionRun
from apps.purchases.models import Purchase, PurchaseStatus
from apps.reports.exporters import export_csv, export_pdf, export_xlsx
from apps.sales.models import (
    Invoice,
    InvoiceItem,
    OrderStatus,
    Payment,
    PaymentAllocation,
    SalesOrder,
)
from apps.sales.services import (
    get_bulk_customer_outstanding,
    get_invoice_allocated_total,
    get_invoice_outstanding,
)

ZERO = Decimal("0.00")


def _resolve_client_tz(request):
    tz_name = (
        request.headers.get("X-Client-Timezone")
        or request.query_params.get("tz")
        or ""
    ).strip()
    if tz_name:
        try:
            return ZoneInfo(tz_name)
        except (ZoneInfoNotFoundError, KeyError, ValueError):
            pass
    return timezone.get_current_timezone()


def _format_local_dt(dt, tz=None) -> str:
    if not dt:
        return ""
    local_dt = timezone.localtime(dt, tz or timezone.get_current_timezone())
    return local_dt.strftime("%d %b %Y, %I:%M %p")


def _sum_decimal(qs, field: str) -> Decimal:
    agg = qs.aggregate(
        total=Coalesce(
            Sum(field),
            Value(ZERO, output_field=DecimalField(max_digits=14, decimal_places=2)),
        )
    )
    return Decimal(agg["total"]).quantize(Decimal("0.01"))


class AdminDashboardView(APIView):
    permission_classes = [role_permission(ADMIN_OWNER, ADMIN_OWNER)]

    def get(self, request):
        client_tz = _resolve_client_tz(request)
        today = timezone.localdate(timezone=client_tz)
        orders_today = SalesOrder.objects.filter(order_date=today).count()
        sales_today = _sum_decimal(Invoice.objects.filter(invoice_date=today), "grand_total")
        pending_approval = SalesOrder.objects.filter(
            status__in=[OrderStatus.SUBMITTED, OrderStatus.PENDING_APPROVAL]
        ).count()
        approved_orders = SalesOrder.objects.filter(status=OrderStatus.APPROVED).count()

        inv_summary = build_inventory_summary()
        finished_items = [r for r in inv_summary if r["item_type"] == StockItemType.FINISHED]
        finished_stock_units = sum((Decimal(r["closing_stock"]) for r in finished_items), Decimal("0"))
        low_stock_items = [
            r for r in inv_summary if r["status"] in ("LOW_STOCK", "OUT_OF_STOCK")
        ]

        outstanding_map = get_bulk_customer_outstanding()
        total_outstanding = sum(outstanding_map.values(), ZERO)

        recent_activity = [
            {
                "id": a.id,
                "action": a.action,
                "entity_type": a.entity_type,
                "summary": a.summary,
                "user_name": a.user.full_name if a.user else "System",
                "created_at": timezone.localtime(a.created_at, client_tz).isoformat(),
            }
            for a in AuditLog.objects.select_related("user").all()[:12]
        ]

        pending_list = [
            {
                "id": o.id,
                "order_number": o.order_number,
                "customer_name": o.customer.name,
                "salesman_name": o.salesman.full_name,
                "grand_total": str(o.grand_total),
                "order_date": str(o.order_date),
                "status": o.status,
            }
            for o in SalesOrder.objects.select_related("customer", "salesman")
            .filter(status__in=[OrderStatus.SUBMITTED, OrderStatus.PENDING_APPROVAL])[:8]
        ]

        return Response(
            {
                "kpis": {
                    "orders_today": orders_today,
                    "sales_today": str(sales_today),
                    "pending_approval": pending_approval,
                    "approved_orders": approved_orders,
                    "finished_goods_stock": str(finished_stock_units.quantize(Decimal("0.001"))),
                    "low_stock_count": len(low_stock_items),
                    "outstanding_payments": str(total_outstanding.quantize(Decimal("0.01"))),
                },
                "low_stock_alerts": low_stock_items[:10],
                "pending_orders": pending_list,
                "recent_activity": recent_activity,
            }
        )


class ProductionDashboardView(APIView):
    permission_classes = [role_permission(INTERNAL_ROLES, INTERNAL_ROLES)]

    def get(self, request):
        runs = ProductionRun.objects.select_related("product").all()
        total_runs = runs.count()
        total_output = sum((r.actual_good_output_qty for r in runs), Decimal("0.000"))
        flagged_runs = runs.filter(has_variance_flag=True).count()
        avg_yield_var = (
            (sum((r.yield_variance_pct for r in runs), Decimal("0.00")) / total_runs).quantize(Decimal("0.01"))
            if total_runs
            else Decimal("0.00")
        )
        latest_run = runs.first()
        inv_summary = build_inventory_summary()
        material_alerts = [
            r
            for r in inv_summary
            if r["item_type"] in (StockItemType.RAW, StockItemType.PACKAGING)
            and r["status"] in ("LOW_STOCK", "OUT_OF_STOCK")
        ]
        recent_runs = [
            {
                "id": r.id,
                "run_number": r.run_number,
                "run_date": str(r.run_date),
                "product_name": r.product.name,
                "expected_output_qty": str(r.expected_output_qty),
                "actual_good_output_qty": str(r.actual_good_output_qty),
                "yield_variance_pct": str(r.yield_variance_pct),
                "has_variance_flag": r.has_variance_flag,
                "cost_per_good_packet": str(r.cost_per_good_packet),
            }
            for r in runs[:10]
        ]

        return Response(
            {
                "kpis": {
                    "total_runs": total_runs,
                    "total_good_output": str(total_output),
                    "flagged_variance_runs": flagged_runs,
                    "avg_yield_variance_pct": str(avg_yield_var),
                    "latest_cost_per_packet": str(
                        latest_run.cost_per_good_packet if latest_run else Decimal("0.00")
                    ),
                    "low_material_alerts": len(material_alerts),
                },
                "material_alerts": material_alerts,
                "recent_runs": recent_runs,
            }
        )


class SalesmanDashboardView(APIView):
    permission_classes = [IsSalesmanOnly]

    def get(self, request):
        user = request.user
        orders = SalesOrder.objects.select_related("customer").filter(salesman=user)
        customers = Customer.objects.filter(
            Q(assigned_salesman=user) | Q(assigned_salesman__isnull=True),
            is_active=True,
        )
        outstanding_map = get_bulk_customer_outstanding()
        total_outstanding = sum(
            (outstanding_map.get(c.id, ZERO) for c in customers), ZERO
        )
        recent_orders = [
            {
                "id": o.id,
                "order_number": o.order_number,
                "customer_id": o.customer_id,
                "customer_name": o.customer.name,
                "order_date": str(o.order_date),
                "status": o.status,
                "grand_total": str(o.grand_total),
                "item_count": o.items.count(),
            }
            for o in orders[:5]
        ]
        payments_today = _sum_decimal(
            Payment.objects.filter(recorded_by=user, payment_date=timezone.localdate()),
            "amount",
        )
        # Customer-wise sales summary for this salesman (PDF Sec 4.1)
        cust_sales_map = {}
        for o in orders:
            entry = cust_sales_map.setdefault(
                o.customer_id,
                {
                    "customer_id": o.customer_id,
                    "customer_name": o.customer.name,
                    "customer_state": o.customer.state,
                    "order_count": 0,
                    "ordered_total": ZERO,
                    "invoiced_total": ZERO,
                    "outstanding": outstanding_map.get(o.customer_id, ZERO),
                },
            )
            entry["order_count"] += 1
            entry["ordered_total"] += o.grand_total
            if hasattr(o, "invoice"):
                entry["invoiced_total"] += o.invoice.grand_total

        customer_sales = [
            {
                "customer_id": v["customer_id"],
                "customer_name": v["customer_name"],
                "customer_state": v["customer_state"],
                "order_count": v["order_count"],
                "ordered_total": str(v["ordered_total"].quantize(Decimal("0.01"))),
                "invoiced_total": str(v["invoiced_total"].quantize(Decimal("0.01"))),
                "outstanding": str(v["outstanding"].quantize(Decimal("0.01"))),
            }
            for v in sorted(cust_sales_map.values(), key=lambda x: x["ordered_total"], reverse=True)
        ]

        return Response(
            {
                "kpis": {
                    "total_orders": orders.count(),
                    "pending_orders": orders.filter(
                        status__in=[OrderStatus.SUBMITTED, OrderStatus.PENDING_APPROVAL]
                    ).count(),
                    "approved_orders": orders.filter(
                        status__in=[OrderStatus.APPROVED, OrderStatus.INVOICED, OrderStatus.DISPATCHED]
                    ).count(),
                    "assigned_customers": customers.count(),
                    "total_outstanding": str(total_outstanding.quantize(Decimal("0.01"))),
                    "collections_today": str(payments_today),
                },
                "recent_orders": recent_orders,
                "customer_sales": customer_sales,
            }
        )


class OwnerDashboardView(APIView):
    permission_classes = [IsOwnerOnly]

    def get(self, request):
        client_tz = _resolve_client_tz(request)
        today = timezone.localdate(timezone=client_tz)
        total_revenue = _sum_decimal(Invoice.objects.all(), "grand_total")
        total_taxable_sales = _sum_decimal(Invoice.objects.all(), "taxable_total")
        orders_today = SalesOrder.objects.filter(order_date=today).count()
        sales_today = _sum_decimal(Invoice.objects.filter(invoice_date=today), "grand_total")
        total_orders = SalesOrder.objects.count()
        pending_orders = SalesOrder.objects.filter(
            status__in=[OrderStatus.SUBMITTED, OrderStatus.PENDING_APPROVAL]
        ).count()
        total_collections = _sum_decimal(Payment.objects.all(), "amount")
        outstanding_map = get_bulk_customer_outstanding()
        total_outstanding = sum(outstanding_map.values(), ZERO)

        inv_summary = build_inventory_summary()
        finished_value = sum(
            (Decimal(r["stock_value"]) for r in inv_summary if r["item_type"] == StockItemType.FINISHED),
            ZERO,
        )
        raw_value = sum(
            (Decimal(r["stock_value"]) for r in inv_summary if r["item_type"] == StockItemType.RAW),
            ZERO,
        )
        pkg_value = sum(
            (Decimal(r["stock_value"]) for r in inv_summary if r["item_type"] == StockItemType.PACKAGING),
            ZERO,
        )
        low_stock_alerts = [
            r for r in inv_summary if r["status"] in ("LOW_STOCK", "OUT_OF_STOCK")
        ]

        runs = list(ProductionRun.objects.select_related("product").all())
        total_prod_output = sum((r.actual_good_output_qty for r in runs), Decimal("0.000"))
        avg_yield_var = (
            (sum((r.yield_variance_pct for r in runs), ZERO) / len(runs)).quantize(Decimal("0.01"))
            if runs
            else ZERO
        )
        avg_cost_per_pkt = (
            (sum((r.cost_per_good_packet for r in runs), ZERO) / len(runs)).quantize(Decimal("0.01"))
            if runs
            else ZERO
        )

        # Variance Alerts (>tolerance % yield or material consumption)
        tolerance_pct = CompanySetting.get_solo().variance_tolerance_pct
        variance_alerts = []
        for r in runs:
            if abs(r.yield_variance_pct) > tolerance_pct:
                variance_alerts.append(
                    {
                        "id": f"yield-{r.id}",
                        "alert_type": "YIELD",
                        "run_number": r.run_number,
                        "run_date": str(r.run_date),
                        "product_name": r.product.name,
                        "item_label": "Batch Good Output",
                        "planned_qty": str(r.expected_output_qty),
                        "actual_qty": str(r.actual_good_output_qty),
                        "unit_symbol": "pkts",
                        "variance_pct": str(r.yield_variance_pct),
                    }
                )
        flagged_cons = (
            ProductionConsumption.objects.select_related(
                "production_run",
                "production_run__product",
                "raw_material",
                "packaging_material",
                "unit",
            )
            .filter(is_variance_flagged=True)
            .order_by("-production_run__run_date", "-id")[:25]
        )
        for c in flagged_cons:
            variance_alerts.append(
                {
                    "id": f"cons-{c.id}",
                    "alert_type": "MATERIAL",
                    "run_number": c.production_run.run_number,
                    "run_date": str(c.production_run.run_date),
                    "product_name": c.production_run.product.name,
                    "item_label": c.material_name,
                    "planned_qty": str(c.planned_qty),
                    "actual_qty": str(c.total_issued_qty),
                    "unit_symbol": c.unit.symbol,
                    "variance_pct": str(c.variance_pct),
                }
            )
        variance_alerts.sort(key=lambda x: (x["run_date"], x["run_number"]), reverse=True)

        # Chart 1: Monthly Sales
        monthly_sales_qs = (
            Invoice.objects.annotate(month=TruncMonth("invoice_date"))
            .values("month")
            .annotate(
                revenue=Coalesce(Sum("grand_total"), Value(ZERO, output_field=DecimalField())),
                taxable=Coalesce(Sum("taxable_total"), Value(ZERO, output_field=DecimalField())),
            )
            .order_by("month")
        )
        monthly_sales = [
            {
                "month": r["month"].strftime("%b %Y") if r["month"] else "",
                "revenue": float(r["revenue"]),
                "taxable": float(r["taxable"]),
            }
            for r in monthly_sales_qs
        ]

        # Chart 2: Product-wise Sales
        prod_sales_qs = (
            InvoiceItem.objects.values("product_name")
            .annotate(
                revenue=Coalesce(Sum("line_total"), Value(ZERO, output_field=DecimalField())),
                quantity=Coalesce(Sum("quantity"), Value(Decimal("0"), output_field=DecimalField())),
            )
            .order_by("-revenue")
        )
        product_sales = [
            {
                "product": r["product_name"],
                "revenue": float(r["revenue"]),
                "quantity": float(r["quantity"]),
            }
            for r in prod_sales_qs
        ]

        # Chart 3: Production Trend
        production_trend = [
            {
                "label": f"{r.run_number[-4:]} ({r.run_date.strftime('%d %b')})",
                "expected": float(r.expected_output_qty),
                "actual": float(r.actual_good_output_qty),
                "cost_per_packet": float(r.cost_per_good_packet),
            }
            for r in reversed(runs[:12])
        ]

        # Chart 4: Inventory Distribution
        inventory_distribution = [
            {"name": "Finished Goods", "value": float(finished_value)},
            {"name": "Raw Materials", "value": float(raw_value)},
            {"name": "Packaging", "value": float(pkg_value)},
        ]

        # Chart 5: Collections vs Outstanding
        collections_vs_outstanding = [
            {"name": "Collections Received", "amount": float(total_collections)},
            {"name": "Customer Outstanding", "amount": float(total_outstanding)},
        ]

        return Response(
            {
                "kpis": {
                    "revenue": str(total_revenue),
                    "total_sales": str(total_taxable_sales),
                    "orders_today": orders_today,
                    "sales_today": str(sales_today),
                    "number_of_orders": total_orders,
                    "pending_orders": pending_orders,
                    "finished_goods_value": str(finished_value.quantize(Decimal("0.01"))),
                    "raw_material_value": str(raw_value.quantize(Decimal("0.01"))),
                    "production_output": str(total_prod_output),
                    "yield_variance_pct": str(avg_yield_var),
                    "cost_per_packet": str(avg_cost_per_pkt),
                    "customer_outstanding": str(total_outstanding.quantize(Decimal("0.01"))),
                    "collections": str(total_collections),
                    "low_stock_count": len(low_stock_alerts),
                    "variance_alerts_count": len(variance_alerts),
                },
                "charts": {
                    "monthly_sales": monthly_sales,
                    "product_sales": product_sales,
                    "production_trend": production_trend,
                    "inventory_distribution": inventory_distribution,
                    "collections_vs_outstanding": collections_vs_outstanding,
                },
                "variance_alerts": variance_alerts[:20],
                "low_stock_alerts": low_stock_alerts[:10],
            }
        )


def _build_report_data(
    report_key: str, params, client_tz=None
) -> tuple[str, list[tuple[str, str]], list[dict], dict]:
    date_from = params.get("date_from")
    date_to = params.get("date_to")
    search = (params.get("search") or "").strip().lower()

    if report_key == "sales-register":
        qs = Invoice.objects.select_related("order", "customer").all()
        if date_from:
            qs = qs.filter(invoice_date__gte=date_from)
        if date_to:
            qs = qs.filter(invoice_date__lte=date_to)
        rows = []
        for inv in qs:
            paid = get_invoice_allocated_total(inv.id)
            out = get_invoice_outstanding(inv)
            rows.append(
                {
                    "invoice_number": inv.invoice_number,
                    "invoice_date": str(inv.invoice_date),
                    "order_number": inv.order.order_number,
                    "customer_name": inv.customer_name,
                    "customer_state": inv.customer_state,
                    "customer_gstin": inv.customer_gstin or "-",
                    "supply_type": "IGST" if inv.is_inter_state else "CGST+SGST",
                    "taxable_total": str(inv.taxable_total),
                    "cgst_total": str(inv.cgst_total),
                    "sgst_total": str(inv.sgst_total),
                    "igst_total": str(inv.igst_total),
                    "grand_total": str(inv.grand_total),
                    "paid_amount": str(paid),
                    "outstanding": str(out),
                }
            )
        cols = [
            ("invoice_number", "Invoice No"),
            ("invoice_date", "Date"),
            ("customer_name", "Customer"),
            ("customer_state", "State"),
            ("supply_type", "Tax Type"),
            ("taxable_total", "Taxable (Rs)"),
            ("cgst_total", "CGST"),
            ("sgst_total", "SGST"),
            ("igst_total", "IGST"),
            ("grand_total", "Total (Rs)"),
            ("outstanding", "Outstanding"),
        ]
        summary = {
            "total_invoices": len(rows),
            "taxable_total": str(sum((Decimal(r["taxable_total"]) for r in rows), ZERO)),
            "grand_total": str(sum((Decimal(r["grand_total"]) for r in rows), ZERO)),
        }
        return _filter_and_return("Sales Register", cols, rows, summary, search)

    if report_key == "customer-sales":
        qs = Invoice.objects.select_related("customer").all()
        if date_from:
            qs = qs.filter(invoice_date__gte=date_from)
        if date_to:
            qs = qs.filter(invoice_date__lte=date_to)
        grouped = {}
        for inv in qs:
            g = grouped.setdefault(
                inv.customer_id,
                {
                    "customer_name": inv.customer_name,
                    "state": inv.customer_state,
                    "gstin": inv.customer_gstin or "-",
                    "invoice_count": 0,
                    "taxable": ZERO,
                    "gst": ZERO,
                    "grand_total": ZERO,
                    "paid": ZERO,
                    "outstanding": ZERO,
                },
            )
            g["invoice_count"] += 1
            g["taxable"] += inv.taxable_total
            g["gst"] += inv.cgst_total + inv.sgst_total + inv.igst_total
            g["grand_total"] += inv.grand_total
            g["paid"] += get_invoice_allocated_total(inv.id)
            g["outstanding"] += get_invoice_outstanding(inv)
        rows = [
            {
                "customer_name": v["customer_name"],
                "state": v["state"],
                "gstin": v["gstin"],
                "invoice_count": v["invoice_count"],
                "taxable": str(v["taxable"]),
                "gst": str(v["gst"]),
                "grand_total": str(v["grand_total"]),
                "paid": str(v["paid"]),
                "outstanding": str(v["outstanding"]),
            }
            for v in grouped.values()
        ]
        cols = [
            ("customer_name", "Customer"),
            ("state", "State"),
            ("gstin", "GSTIN"),
            ("invoice_count", "Invoices"),
            ("taxable", "Taxable (Rs)"),
            ("gst", "GST (Rs)"),
            ("grand_total", "Billed Total (Rs)"),
            ("paid", "Paid (Rs)"),
            ("outstanding", "Outstanding (Rs)"),
        ]
        return _filter_and_return("Customer-wise Sales", cols, rows, {"customers": len(rows)}, search)

    if report_key == "product-sales":
        qs = InvoiceItem.objects.select_related("invoice", "product").all()
        if date_from:
            qs = qs.filter(invoice__invoice_date__gte=date_from)
        if date_to:
            qs = qs.filter(invoice__invoice_date__lte=date_to)
        grouped = {}
        for ii in qs:
            g = grouped.setdefault(
                ii.product_id,
                {
                    "sku": ii.product.sku,
                    "product_name": ii.product_name,
                    "hsn_code": ii.hsn_code,
                    "quantity": Decimal("0.000"),
                    "taxable": ZERO,
                    "gst": ZERO,
                    "total": ZERO,
                },
            )
            g["quantity"] += ii.quantity
            g["taxable"] += ii.taxable_amount
            g["gst"] += ii.cgst_amount + ii.sgst_amount + ii.igst_amount
            g["total"] += ii.line_total
        rows = [
            {
                "sku": v["sku"],
                "product_name": v["product_name"],
                "hsn_code": v["hsn_code"],
                "quantity": str(v["quantity"]),
                "taxable": str(v["taxable"]),
                "gst": str(v["gst"]),
                "total": str(v["total"]),
            }
            for v in grouped.values()
        ]
        cols = [
            ("sku", "SKU"),
            ("product_name", "Product"),
            ("hsn_code", "HSN"),
            ("quantity", "Qty Sold"),
            ("taxable", "Taxable (Rs)"),
            ("gst", "GST (Rs)"),
            ("total", "Total Sales (Rs)"),
        ]
        return _filter_and_return("Product-wise Sales", cols, rows, {"products": len(rows)}, search)

    if report_key == "purchase-register":
        qs = Purchase.objects.select_related("supplier").prefetch_related("items").filter(
            status=PurchaseStatus.CONFIRMED
        )
        if date_from:
            qs = qs.filter(purchase_date__gte=date_from)
        if date_to:
            qs = qs.filter(purchase_date__lte=date_to)
        rows = []
        for p in qs:
            for item in p.items.all():
                rows.append(
                    {
                        "purchase_number": p.purchase_number,
                        "purchase_date": str(p.purchase_date),
                        "supplier_name": p.supplier.name,
                        "invoice_ref": p.invoice_ref or "-",
                        "material_type": item.material_type,
                        "material_name": item.material_name,
                        "quantity": str(item.quantity),
                        "unit_rate": str(item.unit_rate),
                        "line_total": str(item.line_total),
                    }
                )
        cols = [
            ("purchase_number", "Purchase No"),
            ("purchase_date", "Date"),
            ("supplier_name", "Supplier"),
            ("invoice_ref", "Supplier Ref"),
            ("material_name", "Material"),
            ("quantity", "Qty"),
            ("unit_rate", "Rate (Rs)"),
            ("line_total", "Total (Rs)"),
        ]
        summary = {"total_purchase_value": str(sum((Decimal(r["line_total"]) for r in rows), ZERO))}
        return _filter_and_return("Purchase Register", cols, rows, summary, search)

    if report_key == "gst-summary":
        qs = Invoice.objects.all()
        if date_from:
            qs = qs.filter(invoice_date__gte=date_from)
        if date_to:
            qs = qs.filter(invoice_date__lte=date_to)
        rows = [
            {
                "invoice_number": inv.invoice_number,
                "invoice_date": str(inv.invoice_date),
                "customer_name": inv.customer_name,
                "customer_gstin": inv.customer_gstin or "Unregistered",
                "place_of_supply": inv.customer_state,
                "supply_type": "Inter-State (IGST)" if inv.is_inter_state else "Intra-State (CGST+SGST)",
                "taxable_total": str(inv.taxable_total),
                "cgst_total": str(inv.cgst_total),
                "sgst_total": str(inv.sgst_total),
                "igst_total": str(inv.igst_total),
                "grand_total": str(inv.grand_total),
            }
            for inv in qs
        ]
        cols = [
            ("invoice_number", "Invoice No"),
            ("invoice_date", "Date"),
            ("customer_name", "Customer"),
            ("customer_gstin", "GSTIN"),
            ("place_of_supply", "Place of Supply"),
            ("supply_type", "Supply Type"),
            ("taxable_total", "Taxable"),
            ("cgst_total", "CGST"),
            ("sgst_total", "SGST"),
            ("igst_total", "IGST"),
            ("grand_total", "Invoice Total"),
        ]
        summary = {
            "total_taxable": str(sum((Decimal(r["taxable_total"]) for r in rows), ZERO)),
            "total_cgst": str(sum((Decimal(r["cgst_total"]) for r in rows), ZERO)),
            "total_sgst": str(sum((Decimal(r["sgst_total"]) for r in rows), ZERO)),
            "total_igst": str(sum((Decimal(r["igst_total"]) for r in rows), ZERO)),
        }
        return _filter_and_return("GST Outward Supply Summary", cols, rows, summary, search)

    if report_key == "stock-summary":
        rows = build_inventory_summary()
        cols = [
            ("item_type", "Category"),
            ("code", "Code/SKU"),
            ("name", "Item Name"),
            ("unit_symbol", "Unit"),
            ("opening_stock", "Opening"),
            ("receipts", "Receipts"),
            ("issues", "Issues"),
            ("adjustments", "Adj."),
            ("closing_stock", "Closing"),
            ("unit_cost", "Unit Cost"),
            ("stock_value", "Value (Rs)"),
            ("status", "Status"),
        ]
        summary = {"total_stock_value": str(sum((Decimal(r["stock_value"]) for r in rows), ZERO))}
        return _filter_and_return("Stock Summary", cols, rows, summary, search)

    if report_key == "stock-ledger":
        qs = StockLedger.objects.select_related(
            "raw_material",
            "raw_material__unit",
            "packaging_material",
            "packaging_material__unit",
            "product",
            "product__unit",
            "created_by",
        ).all()
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        rows = [
            {
                "date": _format_local_dt(e.created_at, client_tz),
                "item_type": e.item_type,
                "item_name": e.item_name,
                "movement_type": e.movement_type,
                "quantity_delta": str(e.quantity_delta),
                "unit_symbol": e.unit_symbol,
                "running_balance": str(e.running_balance),
                "unit_cost": str(e.unit_cost),
                "reference_no": e.reference_no or f"{e.source_type}#{e.source_id}",
                "created_by": e.created_by.full_name if e.created_by else "System",
            }
            for e in qs[:500]
        ]
        cols = [
            ("date", "Timestamp"),
            ("item_type", "Type"),
            ("item_name", "Item"),
            ("movement_type", "Movement"),
            ("quantity_delta", "Delta"),
            ("running_balance", "Balance"),
            ("unit_cost", "Unit Cost"),
            ("reference_no", "Reference"),
            ("created_by", "User"),
        ]
        return _filter_and_return("Stock Ledger", cols, rows, {"entries": len(rows)}, search)

    if report_key == "production-report":
        qs = ProductionRun.objects.select_related("product", "supervised_by").all()
        if date_from:
            qs = qs.filter(run_date__gte=date_from)
        if date_to:
            qs = qs.filter(run_date__lte=date_to)
        rows = [
            {
                "run_number": r.run_number,
                "run_date": str(r.run_date),
                "product_name": f"{r.product.name} ({r.product.pack_size})",
                "batch_multiplier": str(r.batch_multiplier),
                "expected_output_qty": str(r.expected_output_qty),
                "actual_good_output_qty": str(r.actual_good_output_qty),
                "yield_variance_pct": f"{r.yield_variance_pct}%",
                "total_production_cost": str(r.total_production_cost),
                "cost_per_good_packet": str(r.cost_per_good_packet),
                "flagged": "YES" if r.has_variance_flag else "NO",
            }
            for r in qs
        ]
        cols = [
            ("run_number", "Run No"),
            ("run_date", "Date"),
            ("product_name", "Product"),
            ("expected_output_qty", "Expected"),
            ("actual_good_output_qty", "Good Output"),
            ("yield_variance_pct", "Yield Var %"),
            ("total_production_cost", "Total Cost (Rs)"),
            ("cost_per_good_packet", "Cost/Pkt (Rs)"),
            ("flagged", "Variance Flag"),
        ]
        return _filter_and_return("Production Report", cols, rows, {"runs": len(rows)}, search)

    if report_key == "consumption-variance":
        qs = ProductionConsumption.objects.select_related(
            "production_run", "production_run__product", "raw_material", "packaging_material", "unit"
        ).all()
        if date_from:
            qs = qs.filter(production_run__run_date__gte=date_from)
        if date_to:
            qs = qs.filter(production_run__run_date__lte=date_to)
        rows = [
            {
                "run_number": c.production_run.run_number,
                "run_date": str(c.production_run.run_date),
                "product_name": c.production_run.product.name,
                "material_name": c.material_name,
                "unit": c.unit.symbol,
                "planned_qty": str(c.planned_qty),
                "actual_qty": str(c.actual_qty),
                "damaged_qty": str(c.damaged_qty),
                "total_issued_qty": str(c.total_issued_qty),
                "variance_pct": f"{c.variance_pct}%",
                "flagged": "FLAGGED" if c.is_variance_flagged else "OK",
            }
            for c in qs
        ]
        cols = [
            ("run_number", "Run No"),
            ("run_date", "Date"),
            ("product_name", "Product"),
            ("material_name", "Material"),
            ("planned_qty", "Planned"),
            ("actual_qty", "Actual"),
            ("damaged_qty", "Damaged"),
            ("total_issued_qty", "Total Issued"),
            ("variance_pct", "Variance %"),
            ("flagged", "Status"),
        ]
        return _filter_and_return("Planned vs Actual Consumption", cols, rows, {"records": len(rows)}, search)

    if report_key == "yield-wastage":
        qs = ProductionRun.objects.select_related("product").all()
        if date_from:
            qs = qs.filter(run_date__gte=date_from)
        if date_to:
            qs = qs.filter(run_date__lte=date_to)
        rows = [
            {
                "run_number": r.run_number,
                "run_date": str(r.run_date),
                "product_name": r.product.name,
                "expected_output_qty": str(r.expected_output_qty),
                "actual_good_output_qty": str(r.actual_good_output_qty),
                "wastage_qty": str(r.wastage_qty),
                "damaged_packaging_qty": str(r.damaged_packaging_qty),
                "yield_variance_pct": f"{r.yield_variance_pct}%",
                "status": "FLAGGED (>3%)" if abs(r.yield_variance_pct) > Decimal("3.00") else "WITHIN TOLERANCE",
            }
            for r in qs
        ]
        cols = [
            ("run_number", "Run No"),
            ("run_date", "Date"),
            ("product_name", "Product"),
            ("expected_output_qty", "Expected"),
            ("actual_good_output_qty", "Actual Good"),
            ("wastage_qty", "Wastage"),
            ("damaged_packaging_qty", "Damaged Pkg"),
            ("yield_variance_pct", "Yield Var %"),
            ("status", "Tolerance Status"),
        ]
        return _filter_and_return("Yield & Wastage Report", cols, rows, {"runs": len(rows)}, search)

    if report_key == "payments":
        qs = Payment.objects.select_related("customer", "recorded_by").prefetch_related(
            "allocations", "allocations__invoice"
        ).all()
        if date_from:
            qs = qs.filter(payment_date__gte=date_from)
        if date_to:
            qs = qs.filter(payment_date__lte=date_to)
        rows = [
            {
                "payment_number": p.payment_number,
                "payment_date": str(p.payment_date),
                "customer_name": p.customer.name,
                "payment_mode": p.payment_mode,
                "reference_number": p.reference_number or "-",
                "amount": str(p.amount),
                "allocated_invoices": ", ".join(
                    f"{a.invoice.invoice_number} (Rs.{a.allocated_amount})"
                    for a in p.allocations.all()
                ) or "Unallocated",
                "recorded_by": p.recorded_by.full_name if p.recorded_by else "System",
            }
            for p in qs
        ]
        cols = [
            ("payment_number", "Payment No"),
            ("payment_date", "Date"),
            ("customer_name", "Customer"),
            ("payment_mode", "Mode"),
            ("reference_number", "Ref No"),
            ("amount", "Amount (Rs)"),
            ("allocated_invoices", "Invoice Allocations"),
            ("recorded_by", "Recorded By"),
        ]
        summary = {"total_collected": str(sum((Decimal(r["amount"]) for r in rows), ZERO))}
        return _filter_and_return("Payments Register", cols, rows, summary, search)

    if report_key == "outstanding-ageing":
        today = timezone.localdate(timezone=client_tz)
        qs = Invoice.objects.select_related("customer").all()
        rows = []
        for inv in qs:
            paid = get_invoice_allocated_total(inv.id)
            out = get_invoice_outstanding(inv)
            if out <= 0:
                continue
            age = max(0, (today - inv.invoice_date).days)
            bucket = (
                "0-30 Days" if age <= 30 else
                "31-60 Days" if age <= 60 else
                "61-90 Days" if age <= 90 else
                "90+ Days"
            )
            rows.append(
                {
                    "invoice_number": inv.invoice_number,
                    "invoice_date": str(inv.invoice_date),
                    "customer_name": inv.customer_name,
                    "customer_state": inv.customer_state,
                    "grand_total": str(inv.grand_total),
                    "paid_amount": str(paid),
                    "outstanding": str(out),
                    "age_days": age,
                    "bucket": bucket,
                }
            )
        cols = [
            ("invoice_number", "Invoice No"),
            ("invoice_date", "Invoice Date"),
            ("customer_name", "Customer"),
            ("grand_total", "Invoice Total"),
            ("paid_amount", "Paid"),
            ("outstanding", "Outstanding"),
            ("age_days", "Age (Days)"),
            ("bucket", "Ageing Bucket"),
        ]
        summary = {"total_outstanding": str(sum((Decimal(r["outstanding"]) for r in rows), ZERO))}
        return _filter_and_return("Outstanding Ageing Report", cols, rows, summary, search)

    if report_key == "product-costing":
        qs = ProductionRun.objects.select_related("product").all()
        if date_from:
            qs = qs.filter(run_date__gte=date_from)
        if date_to:
            qs = qs.filter(run_date__lte=date_to)
        rows = []
        for r in qs:
            margin = (r.product.selling_price - r.cost_per_good_packet).quantize(Decimal("0.01"))
            margin_pct = (
                ((margin / r.product.selling_price) * Decimal("100")).quantize(Decimal("0.01"))
                if r.product.selling_price > 0
                else ZERO
            )
            rows.append(
                {
                    "run_number": r.run_number,
                    "run_date": str(r.run_date),
                    "product_name": f"{r.product.name} ({r.product.pack_size})",
                    "actual_good_output_qty": str(r.actual_good_output_qty),
                    "raw_material_cost": str(r.raw_material_cost),
                    "packaging_cost": str(r.packaging_cost),
                    "overhead_cost": str(r.labour_cost + r.gas_power_cost + r.other_overhead_cost),
                    "total_production_cost": str(r.total_production_cost),
                    "cost_per_good_packet": str(r.cost_per_good_packet),
                    "selling_price": str(r.product.selling_price),
                    "estimated_margin": str(margin),
                    "margin_pct": f"{margin_pct}%",
                }
            )
        cols = [
            ("run_number", "Run No"),
            ("product_name", "Product"),
            ("actual_good_output_qty", "Good Pkts"),
            ("raw_material_cost", "Raw Cost"),
            ("packaging_cost", "Pkg Cost"),
            ("overhead_cost", "Overheads"),
            ("total_production_cost", "Total Cost"),
            ("cost_per_good_packet", "Cost/Pkt"),
            ("selling_price", "Sell Price"),
            ("estimated_margin", "Margin/Pkt"),
            ("margin_pct", "Margin %"),
        ]
        return _filter_and_return(
            "Product Costing (Weighted Average)", cols, rows, {"valuation_method": "Weighted Average"}, search
        )

    raise KeyError(f"Unknown report key: {report_key}")


def _filter_and_return(title, cols, rows, summary, search):
    if search:
        rows = [
            r for r in rows if any(search in str(v).lower() for v in r.values())
        ]
    return title, cols, rows, summary


class AuditReportView(APIView):
    permission_classes = [IsAuditViewer]

    def get(self, request, report_key: str):
        client_tz = _resolve_client_tz(request)
        try:
            title, cols, rows, summary = _build_report_data(
                report_key, request.query_params, client_tz=client_tz
            )
        except KeyError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)

        page = max(1, int(request.query_params.get("page", 1)))
        page_size = min(200, max(1, int(request.query_params.get("page_size", 50))))
        start = (page - 1) * page_size
        end = start + page_size

        return Response(
            {
                "report_key": report_key,
                "title": title,
                "columns": [{"key": k, "label": l} for k, l in cols],
                "summary": summary,
                "count": len(rows),
                "page": page,
                "page_size": page_size,
                "results": rows[start:end],
            }
        )


class AuditReportExportView(APIView):
    permission_classes = [IsAuditViewer]

    def get(self, request, report_key: str):
        fmt = (request.query_params.get("export_format") or request.query_params.get("format") or "csv").lower()
        client_tz = _resolve_client_tz(request)
        try:
            title, cols, rows, _ = _build_report_data(
                report_key, request.query_params, client_tz=client_tz
            )
        except KeyError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)

        if fmt == "csv":
            data = export_csv(title, cols, rows)
            resp = HttpResponse(data, content_type="text/csv; charset=utf-8")
            resp["Content-Disposition"] = f'attachment; filename="{report_key}.csv"'
            return resp
        if fmt in ("xlsx", "excel"):
            data = export_xlsx(title, cols, rows)
            resp = HttpResponse(
                data,
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            resp["Content-Disposition"] = f'attachment; filename="{report_key}.xlsx"'
            return resp
        if fmt == "pdf":
            data = export_pdf(title, cols, rows)
            resp = HttpResponse(data, content_type="application/pdf")
            resp["Content-Disposition"] = f'attachment; filename="{report_key}.pdf"'
            return resp

        return Response(
            {"detail": "Unsupported export format. Use csv, xlsx, or pdf."},
            status=status.HTTP_400_BAD_REQUEST,
        )
