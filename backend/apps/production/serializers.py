from decimal import Decimal

from rest_framework import serializers

from apps.masters.models import BOM, MaterialType, Product
from apps.production.models import Expense, ProductionConsumption, ProductionRun


class ProductionConsumptionSerializer(serializers.ModelSerializer):
    material_name = serializers.ReadOnlyField()
    unit_symbol = serializers.CharField(source="unit.symbol", read_only=True)

    class Meta:
        model = ProductionConsumption
        fields = [
            "id",
            "material_type",
            "raw_material",
            "packaging_material",
            "material_name",
            "unit",
            "unit_symbol",
            "planned_qty",
            "actual_qty",
            "damaged_qty",
            "total_issued_qty",
            "variance_qty",
            "variance_pct",
            "is_variance_flagged",
            "unit_cost",
            "total_cost",
        ]


class ProductionRunSerializer(serializers.ModelSerializer):
    consumptions = ProductionConsumptionSerializer(many=True, read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_pack_size = serializers.CharField(source="product.pack_size", read_only=True)
    product_selling_price = serializers.DecimalField(
        source="product.selling_price", max_digits=12, decimal_places=2, read_only=True
    )
    bom_version = serializers.IntegerField(source="bom.version", read_only=True)
    supervised_by_name = serializers.SerializerMethodField()
    estimated_margin_per_packet = serializers.SerializerMethodField()

    class Meta:
        model = ProductionRun
        fields = [
            "id",
            "run_number",
            "product",
            "product_name",
            "product_pack_size",
            "product_selling_price",
            "bom",
            "bom_version",
            "run_date",
            "batch_multiplier",
            "expected_output_qty",
            "actual_good_output_qty",
            "wastage_qty",
            "damaged_packaging_qty",
            "yield_variance_pct",
            "has_variance_flag",
            "raw_material_cost",
            "packaging_cost",
            "labour_cost",
            "gas_power_cost",
            "other_overhead_cost",
            "total_production_cost",
            "cost_per_good_packet",
            "estimated_margin_per_packet",
            "status",
            "notes",
            "supervised_by",
            "supervised_by_name",
            "confirmed_at",
            "consumptions",
            "created_at",
        ]

    def get_supervised_by_name(self, obj):
        return obj.supervised_by.full_name if obj.supervised_by else None

    def get_estimated_margin_per_packet(self, obj):
        margin = (obj.product.selling_price - obj.cost_per_good_packet).quantize(Decimal("0.01"))
        return str(margin)


class ConsumptionInputSerializer(serializers.Serializer):
    material_type = serializers.ChoiceField(choices=MaterialType.choices)
    raw_material = serializers.IntegerField(required=False, allow_null=True)
    packaging_material = serializers.IntegerField(required=False, allow_null=True)
    unit = serializers.IntegerField(required=False, allow_null=True)
    actual_qty = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0"))
    damaged_qty = serializers.DecimalField(
        max_digits=12, decimal_places=3, min_value=Decimal("0"), required=False, default=Decimal("0.000")
    )


class ProductionRunCreateSerializer(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    bom = serializers.PrimaryKeyRelatedField(queryset=BOM.objects.all(), required=False, allow_null=True)
    run_date = serializers.DateField(required=False)
    batch_multiplier = serializers.DecimalField(
        max_digits=10, decimal_places=3, min_value=Decimal("0.001"), default=Decimal("1.000")
    )
    actual_good_output_qty = serializers.DecimalField(
        max_digits=12, decimal_places=3, min_value=Decimal("0.001")
    )
    wastage_qty = serializers.DecimalField(
        max_digits=12, decimal_places=3, min_value=Decimal("0"), required=False, default=Decimal("0.000")
    )
    labour_cost = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0"), required=False, default=Decimal("0.00")
    )
    gas_power_cost = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0"), required=False, default=Decimal("0.00")
    )
    other_overhead_cost = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0"), required=False, default=Decimal("0.00")
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    consumptions = ConsumptionInputSerializer(many=True, required=False, default=list)

    def validate(self, attrs):
        product = attrs["product"]
        bom = attrs.get("bom")
        if bom is None:
            bom = product.boms.filter(is_active=True).first()
            if bom is None:
                raise serializers.ValidationError("No active BOM found for the selected product.")
            attrs["bom"] = bom
        elif bom.product_id != product.id:
            raise serializers.ValidationError("Selected BOM does not belong to the selected product.")
        return attrs


class ExpenseSerializer(serializers.ModelSerializer):
    recorded_by_name = serializers.SerializerMethodField()
    run_number = serializers.CharField(source="production_run.run_number", read_only=True, default=None)

    class Meta:
        model = Expense
        fields = [
            "id",
            "production_run",
            "run_number",
            "category",
            "description",
            "amount",
            "expense_date",
            "recorded_by",
            "recorded_by_name",
            "created_at",
        ]
        read_only_fields = ["id", "recorded_by", "created_at"]

    def get_recorded_by_name(self, obj):
        return obj.recorded_by.full_name if obj.recorded_by else None
