from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.inventory.services import (
    get_bulk_stock_balances,
    get_stock_balance,
)
from apps.masters.models import (
    BOM,
    BOMItem,
    Customer,
    MaterialType,
    PackagingMaterial,
    Product,
    ProductPrice,
    RawMaterial,
    Supplier,
    Unit,
)


class UnitSerializer(serializers.ModelSerializer):
    base_unit_symbol = serializers.CharField(source="base_unit.symbol", read_only=True, default=None)

    class Meta:
        model = Unit
        fields = ["id", "name", "symbol", "base_unit", "base_unit_symbol", "factor_to_base"]


class CustomerSerializer(serializers.ModelSerializer):
    assigned_salesman_name = serializers.SerializerMethodField()
    outstanding_balance = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = [
            "id",
            "code",
            "name",
            "customer_type",
            "state",
            "gstin",
            "contact_person",
            "phone",
            "email",
            "address",
            "credit_limit",
            "assigned_salesman",
            "assigned_salesman_name",
            "outstanding_balance",
            "is_active",
            "created_at",
        ]
        read_only_fields = ["id", "created_at", "assigned_salesman_name", "outstanding_balance"]

    def get_assigned_salesman_name(self, obj):
        return obj.assigned_salesman.full_name if obj.assigned_salesman else None

    def get_outstanding_balance(self, obj):
        outstanding_map = self.context.get("customer_outstanding_map")
        if outstanding_map is not None:
            return str(outstanding_map.get(obj.id, Decimal("0.00")))
        from apps.sales.services import get_customer_outstanding

        return str(get_customer_outstanding(obj.id))


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = [
            "id",
            "code",
            "name",
            "gstin",
            "state",
            "contact_person",
            "phone",
            "email",
            "address",
            "is_active",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]


class ProductPriceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductPrice
        fields = ["id", "product", "price", "effective_from", "effective_to", "created_at"]


class ProductSerializer(serializers.ModelSerializer):
    unit_symbol = serializers.CharField(source="unit.symbol", read_only=True)
    available_stock = serializers.SerializerMethodField()
    stock_status = serializers.SerializerMethodField()
    active_bom_id = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id",
            "sku",
            "name",
            "category",
            "pack_size",
            "unit",
            "unit_symbol",
            "hsn_code",
            "gst_rate",
            "selling_price",
            "reorder_level",
            "image_url",
            "description",
            "available_stock",
            "stock_status",
            "active_bom_id",
            "is_active",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "unit_symbol",
            "available_stock",
            "stock_status",
            "active_bom_id",
            "created_at",
        ]

    def _get_stock(self, obj) -> Decimal:
        stock_map = self.context.get("finished_stock_map")
        if stock_map is not None:
            return stock_map.get(obj.id, Decimal("0.000"))
        return get_stock_balance("FINISHED", obj.id)

    def get_available_stock(self, obj):
        return str(self._get_stock(obj))

    def get_stock_status(self, obj):
        bal = self._get_stock(obj)
        if bal <= 0:
            return "OUT_OF_STOCK"
        if bal <= obj.reorder_level:
            return "LOW_STOCK"
        return "IN_STOCK"

    def get_active_bom_id(self, obj):
        active = obj.boms.filter(is_active=True).values_list("id", flat=True).first()
        return active


class RawMaterialSerializer(serializers.ModelSerializer):
    unit_symbol = serializers.CharField(source="unit.symbol", read_only=True)
    available_stock = serializers.SerializerMethodField()
    stock_status = serializers.SerializerMethodField()

    class Meta:
        model = RawMaterial
        fields = [
            "id",
            "code",
            "name",
            "unit",
            "unit_symbol",
            "reorder_level",
            "weighted_avg_cost",
            "available_stock",
            "stock_status",
            "is_active",
            "created_at",
        ]
        read_only_fields = ["id", "weighted_avg_cost", "available_stock", "stock_status", "created_at"]

    def _get_stock(self, obj) -> Decimal:
        stock_map = self.context.get("raw_stock_map")
        if stock_map is not None:
            return stock_map.get(obj.id, Decimal("0.000"))
        return get_stock_balance("RAW", obj.id)

    def get_available_stock(self, obj):
        return str(self._get_stock(obj))

    def get_stock_status(self, obj):
        bal = self._get_stock(obj)
        if bal <= 0:
            return "OUT_OF_STOCK"
        if bal <= obj.reorder_level:
            return "LOW_STOCK"
        return "IN_STOCK"


class PackagingMaterialSerializer(serializers.ModelSerializer):
    unit_symbol = serializers.CharField(source="unit.symbol", read_only=True)
    available_stock = serializers.SerializerMethodField()
    stock_status = serializers.SerializerMethodField()

    class Meta:
        model = PackagingMaterial
        fields = [
            "id",
            "code",
            "name",
            "unit",
            "unit_symbol",
            "reorder_level",
            "weighted_avg_cost",
            "available_stock",
            "stock_status",
            "is_active",
            "created_at",
        ]
        read_only_fields = ["id", "weighted_avg_cost", "available_stock", "stock_status", "created_at"]

    def _get_stock(self, obj) -> Decimal:
        stock_map = self.context.get("pkg_stock_map")
        if stock_map is not None:
            return stock_map.get(obj.id, Decimal("0.000"))
        return get_stock_balance("PACKAGING", obj.id)

    def get_available_stock(self, obj):
        return str(self._get_stock(obj))

    def get_stock_status(self, obj):
        bal = self._get_stock(obj)
        if bal <= 0:
            return "OUT_OF_STOCK"
        if bal <= obj.reorder_level:
            return "LOW_STOCK"
        return "IN_STOCK"


class BOMItemSerializer(serializers.ModelSerializer):
    material_name = serializers.SerializerMethodField()
    unit_symbol = serializers.CharField(source="unit.symbol", read_only=True)
    available_stock = serializers.SerializerMethodField()
    weighted_avg_cost = serializers.SerializerMethodField()

    class Meta:
        model = BOMItem
        fields = [
            "id",
            "material_type",
            "raw_material",
            "packaging_material",
            "material_name",
            "standard_qty",
            "unit",
            "unit_symbol",
            "available_stock",
            "weighted_avg_cost",
        ]

    def get_material_name(self, obj):
        return obj.material_name

    def get_available_stock(self, obj):
        if obj.material_type == MaterialType.RAW and obj.raw_material_id:
            return str(get_stock_balance("RAW", obj.raw_material_id))
        if obj.material_type == MaterialType.PACKAGING and obj.packaging_material_id:
            return str(get_stock_balance("PACKAGING", obj.packaging_material_id))
        return "0.000"

    def get_weighted_avg_cost(self, obj):
        if obj.material_type == MaterialType.RAW and obj.raw_material:
            return str(obj.raw_material.weighted_avg_cost)
        if obj.material_type == MaterialType.PACKAGING and obj.packaging_material:
            return str(obj.packaging_material.weighted_avg_cost)
        return "0.0000"

    def validate(self, attrs):
        mtype = attrs.get("material_type")
        raw = attrs.get("raw_material")
        pkg = attrs.get("packaging_material")
        if mtype == MaterialType.RAW and (not raw or pkg):
            raise serializers.ValidationError(
                "RAW item must set raw_material and leave packaging_material empty."
            )
        if mtype == MaterialType.PACKAGING and (not pkg or raw):
            raise serializers.ValidationError(
                "PACKAGING item must set packaging_material and leave raw_material empty."
            )
        if attrs.get("standard_qty", Decimal("0")) <= 0:
            raise serializers.ValidationError("standard_qty must be greater than 0.")
        target_mat = raw if mtype == MaterialType.RAW else pkg
        item_unit = attrs.get("unit")
        if target_mat and item_unit and target_mat.unit:
            from apps.masters.services import convert_quantity

            try:
                convert_quantity(Decimal("1"), item_unit, target_mat.unit)
            except ValueError:
                raise serializers.ValidationError(
                    f"Unit '{item_unit.symbol}' is incompatible with '{target_mat.name}' "
                    f"(tracked in '{target_mat.unit.symbol}'). Please use '{target_mat.unit.symbol}' or a compatible unit."
                )
        return attrs


class BOMSerializer(serializers.ModelSerializer):
    items = BOMItemSerializer(many=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_pack_size = serializers.CharField(source="product.pack_size", read_only=True)
    product_unit_symbol = serializers.CharField(source="product.unit.symbol", read_only=True)

    class Meta:
        model = BOM
        fields = [
            "id",
            "product",
            "product_name",
            "product_pack_size",
            "product_unit_symbol",
            "version",
            "expected_output_qty",
            "is_active",
            "notes",
            "items",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("BOM must contain at least one material item.")
        return value

    @transaction.atomic
    def create(self, validated_data):
        items_data = validated_data.pop("items")
        request = self.context.get("request")
        if "version" not in validated_data:
            last = (
                BOM.objects.filter(product=validated_data["product"])
                .order_by("-version")
                .first()
            )
            validated_data["version"] = (last.version + 1) if last else 1
        bom = BOM.objects.create(
            created_by=request.user if request and request.user.is_authenticated else None,
            **validated_data,
        )
        for item in items_data:
            BOMItem.objects.create(bom=bom, **item)
        return bom

    @transaction.atomic
    def update(self, instance, validated_data):
        items_data = validated_data.pop("items", None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if items_data is not None:
            instance.items.all().delete()
            for item in items_data:
                BOMItem.objects.create(bom=instance, **item)
        return instance
