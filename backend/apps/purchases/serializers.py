from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from rest_framework import serializers

from apps.masters.models import MaterialType
from apps.purchases.models import Purchase, PurchaseItem
from apps.purchases.services import confirm_purchase, generate_purchase_number


class PurchaseItemSerializer(serializers.ModelSerializer):
    material_name = serializers.ReadOnlyField()
    unit_symbol = serializers.ReadOnlyField()

    class Meta:
        model = PurchaseItem
        fields = [
            "id",
            "material_type",
            "raw_material",
            "packaging_material",
            "material_name",
            "unit_symbol",
            "quantity",
            "unit_rate",
            "line_total",
        ]
        read_only_fields = ["id", "line_total", "material_name", "unit_symbol"]

    def validate(self, attrs):
        mtype = attrs.get("material_type")
        raw = attrs.get("raw_material")
        pkg = attrs.get("packaging_material")
        if mtype == MaterialType.RAW and (not raw or pkg):
            raise serializers.ValidationError("RAW purchase item must specify raw_material only.")
        if mtype == MaterialType.PACKAGING and (not pkg or raw):
            raise serializers.ValidationError(
                "PACKAGING purchase item must specify packaging_material only."
            )
        if attrs.get("quantity", Decimal("0")) <= 0:
            raise serializers.ValidationError("quantity must be greater than 0.")
        if attrs.get("unit_rate", Decimal("0")) < 0:
            raise serializers.ValidationError("unit_rate cannot be negative.")
        return attrs


class PurchaseSerializer(serializers.ModelSerializer):
    items = PurchaseItemSerializer(many=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    created_by_name = serializers.SerializerMethodField()
    confirmed_by_name = serializers.SerializerMethodField()
    auto_confirm = serializers.BooleanField(write_only=True, required=False, default=True)

    class Meta:
        model = Purchase
        fields = [
            "id",
            "purchase_number",
            "supplier",
            "supplier_name",
            "purchase_date",
            "invoice_ref",
            "status",
            "total_amount",
            "notes",
            "items",
            "auto_confirm",
            "created_by",
            "created_by_name",
            "confirmed_by",
            "confirmed_by_name",
            "confirmed_at",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "purchase_number",
            "status",
            "total_amount",
            "created_by",
            "confirmed_by",
            "confirmed_at",
            "created_at",
        ]

    def get_created_by_name(self, obj):
        return obj.created_by.full_name if obj.created_by else None

    def get_confirmed_by_name(self, obj):
        return obj.confirmed_by.full_name if obj.confirmed_by else None

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("At least one purchase item is required.")
        return value

    @transaction.atomic
    def create(self, validated_data):
        items_data = validated_data.pop("items")
        auto_confirm = validated_data.pop("auto_confirm", True)
        request = self.context.get("request")
        user = request.user if request and request.user.is_authenticated else None

        purchase = Purchase.objects.create(
            purchase_number=generate_purchase_number(),
            created_by=user,
            **validated_data,
        )
        total = Decimal("0.00")
        for item in items_data:
            line_total = (item["quantity"] * item["unit_rate"]).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            PurchaseItem.objects.create(
                purchase=purchase,
                line_total=line_total,
                **item,
            )
            total += line_total
        purchase.total_amount = total
        purchase.save(update_fields=["total_amount"])

        if auto_confirm:
            purchase = confirm_purchase(purchase.id, user=user, request=request)
        return purchase
