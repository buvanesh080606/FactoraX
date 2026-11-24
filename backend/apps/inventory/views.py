from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import UserRole
from apps.accounts.permissions import (
    ADMIN_OWNER,
    ALL_ROLES,
    INTERNAL_ROLES,
    PRODUCTION_WRITE,
    role_permission,
)
from apps.accounts.services import log_audit
from apps.inventory.models import MovementType, StockItemType, StockLedger
from apps.inventory.serializers import (
    StockLedgerSerializer,
    StockMovementCreateSerializer,
)
from apps.inventory.services import (
    InsufficientStockError,
    build_inventory_summary,
    record_stock_movement,
)


class InventorySummaryView(APIView):
    permission_classes = [role_permission(ALL_ROLES, ADMIN_OWNER)]

    def get(self, request):
        item_type = request.query_params.get("item_type")
        if request.user.role == UserRole.SALESMAN:
            item_type = StockItemType.FINISHED
        if item_type and item_type not in StockItemType.values:
            return Response(
                {"detail": "Invalid item_type. Use RAW, PACKAGING, or FINISHED."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        rows = build_inventory_summary(item_type=item_type)
        search = (request.query_params.get("search") or "").strip().lower()
        status_filter = (request.query_params.get("status") or "").strip().upper()
        if search:
            rows = [
                r
                for r in rows
                if search in r["name"].lower() or search in r["code"].lower()
            ]
        if status_filter:
            rows = [r for r in rows if r["status"] == status_filter]
        return Response({"count": len(rows), "results": rows})


class StockLedgerListView(generics.ListAPIView):
    serializer_class = StockLedgerSerializer
    permission_classes = [role_permission(INTERNAL_ROLES, ADMIN_OWNER)]
    filterset_fields = [
        "item_type",
        "movement_type",
        "raw_material",
        "packaging_material",
        "product",
        "source_type",
    ]
    search_fields = ["reference_no", "notes", "source_type", "source_id"]

    def get_queryset(self):
        qs = StockLedger.objects.select_related(
            "raw_material",
            "raw_material__unit",
            "packaging_material",
            "packaging_material__unit",
            "product",
            "product__unit",
            "created_by",
        ).all()
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        return qs


class OpeningStockCreateView(APIView):
    permission_classes = [role_permission(PRODUCTION_WRITE, PRODUCTION_WRITE)]

    def post(self, request):
        serializer = StockMovementCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        if d["quantity"] <= 0:
            return Response(
                {"detail": "Opening stock quantity must be positive."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            entry = record_stock_movement(
                item_type=d["item_type"],
                item_id=d["item_id"],
                movement_type=MovementType.OPENING,
                quantity_delta=d["quantity"],
                unit_cost=d.get("unit_cost"),
                source_type="OPENING",
                source_id=f"OPEN-{d['item_type']}-{d['item_id']}",
                reference_no=d.get("reference_no") or "OPENING-STOCK",
                notes=d.get("notes") or "Opening stock entry",
                user=request.user,
            )
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        log_audit(
            user=request.user,
            action="RECORD_OPENING_STOCK",
            entity_type="StockLedger",
            entity_id=entry.id,
            summary=f"Opening stock {entry.item_name}: +{entry.quantity_delta} {entry.unit_symbol}",
            request=request,
        )
        return Response(StockLedgerSerializer(entry).data, status=status.HTTP_201_CREATED)


class StockAdjustmentCreateView(APIView):
    permission_classes = [role_permission(ADMIN_OWNER, ADMIN_OWNER)]

    def post(self, request):
        serializer = StockMovementCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        try:
            entry = record_stock_movement(
                item_type=d["item_type"],
                item_id=d["item_id"],
                movement_type=MovementType.ADJUSTMENT,
                quantity_delta=d["quantity"],
                unit_cost=d.get("unit_cost"),
                source_type="ADJUSTMENT",
                source_id=f"ADJ-{d['item_type']}-{d['item_id']}",
                reference_no=d.get("reference_no") or "MANUAL-ADJ",
                notes=d.get("notes") or "Controlled stock adjustment",
                user=request.user,
            )
        except InsufficientStockError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        log_audit(
            user=request.user,
            action="STOCK_ADJUSTMENT",
            entity_type="StockLedger",
            entity_id=entry.id,
            summary=f"Stock adjustment {entry.item_name}: {entry.quantity_delta} ({entry.notes})",
            request=request,
        )
        return Response(StockLedgerSerializer(entry).data, status=status.HTTP_201_CREATED)
