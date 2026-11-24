from decimal import Decimal

from rest_framework import serializers

from apps.inventory.models import StockItemType, StockLedger


class StockLedgerSerializer(serializers.ModelSerializer):
    item_name = serializers.ReadOnlyField()
    unit_symbol = serializers.ReadOnlyField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = StockLedger
        fields = [
            "id",
            "item_type",
            "raw_material",
            "packaging_material",
            "product",
            "item_name",
            "unit_symbol",
            "movement_type",
            "quantity_delta",
            "unit_cost",
            "total_value",
            "running_balance",
            "source_type",
            "source_id",
            "reference_no",
            "notes",
            "created_by",
            "created_by_name",
            "created_at",
        ]

    def get_created_by_name(self, obj):
        return obj.created_by.full_name if obj.created_by else "System"


class StockMovementCreateSerializer(serializers.Serializer):
    item_type = serializers.ChoiceField(choices=StockItemType.choices)
    item_id = serializers.IntegerField()
    quantity = serializers.DecimalField(max_digits=14, decimal_places=3)
    unit_cost = serializers.DecimalField(
        max_digits=12, decimal_places=4, required=False, allow_null=True
    )
    reference_no = serializers.CharField(max_length=64, required=False, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_quantity(self, value):
        if value == Decimal("0"):
            raise serializers.ValidationError("Quantity cannot be zero.")
        return value
