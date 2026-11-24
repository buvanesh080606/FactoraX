from decimal import Decimal, InvalidOperation
from pathlib import Path
import uuid

from django.conf import settings
from django.db.models import ProtectedError, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.accounts.models import UserRole
from apps.accounts.permissions import (
    ADMIN_OWNER,
    ALL_ROLES,
    INTERNAL_ROLES,
    PRODUCTION_WRITE,
    role_permission,
)
from apps.accounts.services import log_audit
from apps.inventory.services import get_bulk_stock_balances, get_stock_balance
from apps.masters.models import (
    BOM,
    Customer,
    MaterialType,
    PackagingMaterial,
    Product,
    ProductPrice,
    RawMaterial,
    Supplier,
    Unit,
)
from apps.masters.serializers import (
    BOMSerializer,
    CustomerSerializer,
    PackagingMaterialSerializer,
    ProductSerializer,
    RawMaterialSerializer,
    SupplierSerializer,
    UnitSerializer,
)


class UnitViewSet(viewsets.ModelViewSet):
    queryset = Unit.objects.select_related("base_unit").all()
    serializer_class = UnitSerializer
    permission_classes = [role_permission(ALL_ROLES, PRODUCTION_WRITE)]
    pagination_class = None

    @action(detail=False, methods=["post"])
    def convert(self, request):
        from apps.masters.services import convert_quantity

        try:
            qty = Decimal(str(request.data.get("quantity", "0")))
            from_u = Unit.objects.select_related("base_unit").get(pk=request.data["from_unit"])
            to_u = Unit.objects.select_related("base_unit").get(pk=request.data["to_unit"])
            converted = convert_quantity(qty, from_u, to_u)
        except (KeyError, ValueError, InvalidOperation, Unit.DoesNotExist) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "input_quantity": str(qty),
                "from_unit": from_u.symbol,
                "to_unit": to_u.symbol,
                "converted_quantity": str(converted),
            }
        )


class CustomerViewSet(viewsets.ModelViewSet):
    queryset = Customer.objects.select_related("assigned_salesman").all()
    serializer_class = CustomerSerializer
    permission_classes = [role_permission(ALL_ROLES, ADMIN_OWNER)]
    filterset_fields = ["customer_type", "state", "assigned_salesman", "is_active"]
    search_fields = ["code", "name", "gstin", "phone", "address", "state"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role == UserRole.SALESMAN:
            qs = qs.filter(
                Q(assigned_salesman=user) | Q(assigned_salesman__isnull=True),
                is_active=True,
            )
        return qs

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        from apps.sales.services import get_bulk_customer_outstanding

        ctx["customer_outstanding_map"] = get_bulk_customer_outstanding()
        return ctx

    def perform_create(self, serializer):
        obj = serializer.save()
        log_audit(
            user=self.request.user,
            action="CREATE_CUSTOMER",
            entity_type="Customer",
            entity_id=obj.id,
            summary=f"Created customer {obj.name} ({obj.state}).",
            request=self.request,
        )


class SupplierViewSet(viewsets.ModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    permission_classes = [role_permission(INTERNAL_ROLES, ADMIN_OWNER)]
    filterset_fields = ["state", "is_active"]
    search_fields = ["code", "name", "gstin", "phone"]

    def perform_create(self, serializer):
        obj = serializer.save()
        log_audit(
            user=self.request.user,
            action="CREATE_SUPPLIER",
            entity_type="Supplier",
            entity_id=obj.id,
            summary=f"Created supplier {obj.name}.",
            request=self.request,
        )


class ProductViewSet(viewsets.ModelViewSet):
    queryset = Product.objects.select_related("unit").prefetch_related("boms").all()
    serializer_class = ProductSerializer
    permission_classes = [role_permission(ALL_ROLES, PRODUCTION_WRITE)]
    filterset_fields = ["category", "is_active"]
    search_fields = ["sku", "name", "pack_size", "hsn_code", "description"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("include_inactive", "").lower() != "true" and self.action == "list":
            if "is_active" not in self.request.query_params:
                qs = qs.filter(is_active=True)
        return qs

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["finished_stock_map"] = get_bulk_stock_balances("FINISHED")
        return ctx

    def perform_create(self, serializer):
        product = serializer.save()
        ProductPrice.objects.create(
            product=product,
            price=product.selling_price,
            created_by=self.request.user,
        )
        log_audit(
            user=self.request.user,
            action="CREATE_PRODUCT",
            entity_type="Product",
            entity_id=product.id,
            summary=f"Created product {product.name} ({product.pack_size}) @ Rs.{product.selling_price}.",
            request=self.request,
        )

    def perform_update(self, serializer):
        old_price = serializer.instance.selling_price
        product = serializer.save()
        if product.selling_price != old_price:
            ProductPrice.objects.create(
                product=product,
                price=product.selling_price,
                created_by=self.request.user,
            )
        log_audit(
            user=self.request.user,
            action="UPDATE_PRODUCT",
            entity_type="Product",
            entity_id=product.id,
            summary=f"Updated product {product.name} ({product.pack_size}) @ Rs.{product.selling_price}.",
            request=self.request,
        )

    def destroy(self, request, *args, **kwargs):
        product = self.get_object()
        name = f"{product.name} ({product.pack_size})"
        pid = product.id
        try:
            product.delete()
            log_audit(
                user=request.user,
                action="DELETE_PRODUCT",
                entity_type="Product",
                entity_id=pid,
                summary=f"Deleted product {name}.",
                request=request,
            )
            return Response({"deleted": True, "archived": False, "detail": f"Removed {name}."})
        except ProtectedError:
            product.is_active = False
            product.save(update_fields=["is_active", "updated_at"])
            log_audit(
                user=request.user,
                action="ARCHIVE_PRODUCT",
                entity_type="Product",
                entity_id=pid,
                summary=f"Archived product {name} (has existing stock/order history).",
                request=request,
            )
            return Response(
                {
                    "deleted": False,
                    "archived": True,
                    "detail": f"{name} has existing stock/order history, so it was archived and hidden from the active catalog.",
                }
            )

    @action(
        detail=False,
        methods=["post"],
        url_path="upload-image",
        parser_classes=[MultiPartParser, FormParser],
    )
    def upload_image(self, request):
        img = request.FILES.get("image")
        if not img:
            return Response({"detail": "No image file provided."}, status=status.HTTP_400_BAD_REQUEST)
        ext = Path(img.name).suffix.lower()
        if ext not in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
            return Response(
                {"detail": "Unsupported image format. Upload JPG, PNG, or WEBP."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        dest_dir = Path(settings.MEDIA_ROOT) / "products"
        dest_dir.mkdir(parents=True, exist_ok=True)
        filename = f"prod_{uuid.uuid4().hex[:10]}{ext}"
        dest_path = dest_dir / filename
        with dest_path.open("wb+") as fh:
            for chunk in img.chunks():
                fh.write(chunk)
        return Response({"image_url": f"{settings.MEDIA_URL}products/{filename}"}, status=status.HTTP_201_CREATED)


class RawMaterialViewSet(viewsets.ModelViewSet):
    queryset = RawMaterial.objects.select_related("unit").all()
    serializer_class = RawMaterialSerializer
    permission_classes = [role_permission(INTERNAL_ROLES, PRODUCTION_WRITE)]
    filterset_fields = ["is_active"]
    search_fields = ["code", "name"]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["raw_stock_map"] = get_bulk_stock_balances("RAW")
        return ctx


class PackagingMaterialViewSet(viewsets.ModelViewSet):
    queryset = PackagingMaterial.objects.select_related("unit").all()
    serializer_class = PackagingMaterialSerializer
    permission_classes = [role_permission(INTERNAL_ROLES, PRODUCTION_WRITE)]
    filterset_fields = ["is_active"]
    search_fields = ["code", "name"]

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["pkg_stock_map"] = get_bulk_stock_balances("PACKAGING")
        return ctx


class BOMViewSet(viewsets.ModelViewSet):
    queryset = (
        BOM.objects.select_related("product", "product__unit")
        .prefetch_related(
            "items",
            "items__unit",
            "items__raw_material",
            "items__packaging_material",
        )
        .all()
    )
    serializer_class = BOMSerializer
    permission_classes = [role_permission(INTERNAL_ROLES, PRODUCTION_WRITE)]
    filterset_fields = ["product", "is_active"]
    search_fields = ["product__name", "product__sku", "notes"]

    def perform_create(self, serializer):
        bom = serializer.save()
        log_audit(
            user=self.request.user,
            action="CREATE_BOM",
            entity_type="BOM",
            entity_id=bom.id,
            summary=f"Created BOM v{bom.version} for {bom.product.name}.",
            request=self.request,
        )

    def perform_update(self, serializer):
        bom = serializer.save()
        log_audit(
            user=self.request.user,
            action="UPDATE_BOM",
            entity_type="BOM",
            entity_id=bom.id,
            summary=f"Updated BOM v{bom.version} for {bom.product.name}.",
            request=self.request,
        )

    def destroy(self, request, *args, **kwargs):
        bom = self.get_object()
        label = f"BOM v{bom.version} ({bom.product.name})"
        bid = bom.id
        try:
            bom.delete()
            log_audit(
                user=request.user,
                action="DELETE_BOM",
                entity_type="BOM",
                entity_id=bid,
                summary=f"Deleted {label}.",
                request=request,
            )
            return Response({"deleted": True, "archived": False, "detail": f"Removed {label}."})
        except ProtectedError:
            bom.is_active = False
            bom.save(update_fields=["is_active", "updated_at"])
            log_audit(
                user=request.user,
                action="ARCHIVE_BOM",
                entity_type="BOM",
                entity_id=bid,
                summary=f"Archived {label} (referenced by past production runs).",
                request=request,
            )
            return Response(
                {
                    "deleted": False,
                    "archived": True,
                    "detail": f"{label} is linked to past production runs, so it was deactivated (archived) instead of hard-deleted.",
                }
            )

    @action(detail=True, methods=["get"])
    def calculate(self, request, pk=None):
        bom = self.get_object()
        try:
            multiplier = Decimal(request.query_params.get("batch_multiplier", "1"))
            if multiplier <= 0:
                raise ValueError()
        except (InvalidOperation, ValueError):
            return Response(
                {"detail": "batch_multiplier must be a positive number."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        expected_output = (bom.expected_output_qty * multiplier).quantize(Decimal("0.001"))
        requirements = []
        unit_warnings = []
        sufficient = True
        for item in bom.items.all():
            from apps.masters.services import convert_quantity

            planned_raw = (item.standard_qty * multiplier).quantize(Decimal("0.001"))
            if item.material_type == MaterialType.RAW:
                avail = get_stock_balance("RAW", item.raw_material_id)
                unit_cost = item.raw_material.weighted_avg_cost
                stock_unit = item.raw_material.unit
            else:
                avail = get_stock_balance("PACKAGING", item.packaging_material_id)
                unit_cost = item.packaging_material.weighted_avg_cost
                stock_unit = item.packaging_material.unit
            unit_mismatch_message = ""
            try:
                planned = convert_quantity(planned_raw, item.unit, stock_unit)
            except ValueError:
                planned = planned_raw
                unit_mismatch_message = (
                    f"{item.material_name} is saved with unit '{item.unit.symbol}' in BOM v{bom.version}, "
                    f"while Inventory tracks it in '{stock_unit.symbol}'. "
                    f"Please update its unit to '{stock_unit.symbol}' in BOM Master & Editor."
                )
                unit_warnings.append(unit_mismatch_message)
            shortage = max(Decimal("0.000"), planned - avail)
            if shortage > 0:
                sufficient = False
            requirements.append(
                {
                    "bom_item_id": item.id,
                    "material_type": item.material_type,
                    "raw_material": item.raw_material_id,
                    "packaging_material": item.packaging_material_id,
                    "material_name": item.material_name,
                    "unit_symbol": stock_unit.symbol,
                    "bom_unit_symbol": item.unit.symbol,
                    "unit_mismatch_message": unit_mismatch_message,
                    "standard_qty_per_batch": str(item.standard_qty),
                    "planned_qty": str(planned),
                    "available_stock": str(avail),
                    "shortage_qty": str(shortage),
                    "weighted_avg_cost": str(unit_cost),
                    "estimated_cost": str((planned * unit_cost).quantize(Decimal("0.01"))),
                }
            )

        return Response(
            {
                "bom_id": bom.id,
                "product_id": bom.product_id,
                "product_name": bom.product.name,
                "pack_size": bom.product.pack_size,
                "batch_multiplier": str(multiplier),
                "expected_output_qty": str(expected_output),
                "is_stock_sufficient": sufficient,
                "unit_warnings": unit_warnings,
                "materials": requirements,
            }
        )
