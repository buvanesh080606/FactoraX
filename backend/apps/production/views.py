from decimal import Decimal

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import INTERNAL_ROLES, PRODUCTION_WRITE, role_permission
from apps.inventory.services import InsufficientStockError
from apps.production.models import Expense, ProductionConsumption, ProductionRun
from apps.production.serializers import (
    ExpenseSerializer,
    ProductionRunCreateSerializer,
    ProductionRunSerializer,
)
from apps.production.services import (
    calculate_production_plan,
    delete_production_run,
    execute_production_run,
    update_production_run,
)


def _stringify_decimals(obj):
    if isinstance(obj, Decimal):
        return str(obj)
    if isinstance(obj, list):
        return [_stringify_decimals(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _stringify_decimals(v) for k, v in obj.items()}
    return obj


class ProductionRunViewSet(viewsets.ModelViewSet):
    queryset = (
        ProductionRun.objects.select_related("product", "bom", "supervised_by")
        .prefetch_related(
            "consumptions",
            "consumptions__raw_material",
            "consumptions__packaging_material",
            "consumptions__unit",
        )
        .all()
    )
    serializer_class = ProductionRunSerializer
    permission_classes = [role_permission(INTERNAL_ROLES, PRODUCTION_WRITE)]
    filterset_fields = ["product", "status", "has_variance_flag", "run_date"]
    search_fields = ["run_number", "product__name", "notes"]
    http_method_names = ["get", "post", "patch", "put", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(run_date__gte=date_from)
        if date_to:
            qs = qs.filter(run_date__lte=date_to)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = ProductionRunCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        try:
            run = execute_production_run(
                product=d["product"],
                bom=d["bom"],
                run_date=d.get("run_date"),
                batch_multiplier=d["batch_multiplier"],
                actual_good_output_qty=d["actual_good_output_qty"],
                wastage_qty=d["wastage_qty"],
                consumptions_input=d["consumptions"],
                labour_cost=d["labour_cost"],
                gas_power_cost=d["gas_power_cost"],
                other_overhead_cost=d["other_overhead_cost"],
                notes=d["notes"],
                user=request.user,
                request=request,
            )
        except (InsufficientStockError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            ProductionRunSerializer(run).data, status=status.HTTP_201_CREATED
        )

    def partial_update(self, request, *args, **kwargs):
        run = self.get_object()
        try:
            updated = update_production_run(
                run=run,
                data=request.data,
                user=request.user,
                request=request,
            )
        except (InsufficientStockError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(ProductionRunSerializer(updated).data)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        run = self.get_object()
        try:
            run_number = delete_production_run(
                run=run,
                user=request.user,
                request=request,
            )
        except (InsufficientStockError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "deleted": True,
                "detail": f"Removed {run_number} and reversed its stock entries in the ledger.",
            }
        )

    @action(detail=False, methods=["post"])
    def preview(self, request):
        serializer = ProductionRunCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        try:
            calc = calculate_production_plan(
                product=d["product"],
                bom=d["bom"],
                batch_multiplier=d["batch_multiplier"],
                actual_good_output_qty=d["actual_good_output_qty"],
                wastage_qty=d["wastage_qty"],
                consumptions_input=d["consumptions"],
                labour_cost=d["labour_cost"],
                gas_power_cost=d["gas_power_cost"],
                other_overhead_cost=d["other_overhead_cost"],
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_stringify_decimals(calc))


class VarianceReportView(APIView):
    permission_classes = [role_permission(INTERNAL_ROLES, PRODUCTION_WRITE)]

    def get(self, request):
        flagged_only = request.query_params.get("flagged_only", "false").lower() == "true"
        qs = ProductionConsumption.objects.select_related(
            "production_run",
            "production_run__product",
            "raw_material",
            "packaging_material",
            "unit",
        ).order_by("-production_run__run_date", "-id")
        if flagged_only:
            qs = qs.filter(is_variance_flagged=True)
        rows = [
            {
                "id": c.id,
                "run_id": c.production_run_id,
                "run_number": c.production_run.run_number,
                "run_date": str(c.production_run.run_date),
                "product_name": c.production_run.product.name,
                "material_type": c.material_type,
                "material_name": c.material_name,
                "unit_symbol": c.unit.symbol,
                "planned_qty": str(c.planned_qty),
                "actual_qty": str(c.actual_qty),
                "damaged_qty": str(c.damaged_qty),
                "total_issued_qty": str(c.total_issued_qty),
                "variance_qty": str(c.variance_qty),
                "variance_pct": str(c.variance_pct),
                "is_variance_flagged": c.is_variance_flagged,
                "yield_variance_pct": str(c.production_run.yield_variance_pct),
            }
            for c in qs[:200]
        ]
        return Response({"count": len(rows), "results": rows})


class ExpenseViewSet(viewsets.ModelViewSet):
    queryset = Expense.objects.select_related("production_run", "recorded_by").all()
    serializer_class = ExpenseSerializer
    permission_classes = [role_permission(INTERNAL_ROLES, PRODUCTION_WRITE)]
    filterset_fields = ["category", "production_run", "expense_date"]
    search_fields = ["description"]

    def perform_create(self, serializer):
        serializer.save(recorded_by=self.request.user)


class ProductionPlanningView(APIView):
    """
    Stretch Goal (PDF Sec 6): Production planning from pending sales orders.
    Compares pending order demand against live finished stock and recommends batches using active BOM.
    """
    permission_classes = [role_permission(INTERNAL_ROLES, PRODUCTION_WRITE)]

    def get(self, request):
        import math
        from django.db.models import Sum
        from apps.inventory.models import StockItemType
        from apps.inventory.services import get_bulk_stock_balances
        from apps.masters.models import Product
        from apps.sales.models import OrderStatus, SalesOrderItem

        pending_rows = (
            SalesOrderItem.objects.filter(
                order__status__in=[OrderStatus.SUBMITTED, OrderStatus.PENDING_APPROVAL]
            )
            .values("product_id")
            .annotate(pending_qty=Sum("quantity"))
        )
        demand_map = {r["product_id"]: Decimal(r["pending_qty"]) for r in pending_rows}
        stock_map = get_bulk_stock_balances(StockItemType.FINISHED)

        plan = []
        for product in Product.objects.select_related("unit").prefetch_related("boms").filter(
            id__in=demand_map.keys()
        ):
            demand = demand_map[product.id]
            avail = stock_map.get(product.id, Decimal("0.000"))
            shortage = max(Decimal("0.000"), demand - avail)
            active_bom = product.boms.filter(is_active=True).first()
            batch_output = active_bom.expected_output_qty if active_bom else Decimal("0.000")
            rec_batches = (
                math.ceil(shortage / batch_output)
                if shortage > 0 and batch_output > 0
                else 0
            )
            plan.append(
                {
                    "product_id": product.id,
                    "product_name": f"{product.name} ({product.pack_size})",
                    "unit_symbol": product.unit.symbol,
                    "pending_order_qty": str(demand),
                    "available_stock": str(avail),
                    "shortage_qty": str(shortage),
                    "bom_id": active_bom.id if active_bom else None,
                    "expected_output_per_batch": str(batch_output),
                    "recommended_batches": rec_batches,
                    "recommendation": (
                        f"Make {rec_batches} batch(es) ({int(rec_batches * batch_output)} {product.unit.symbol}) to fulfill pending orders"
                        if rec_batches > 0
                        else "Current stock covers pending orders"
                    ),
                }
            )
        return Response({"count": len(plan), "results": plan})
