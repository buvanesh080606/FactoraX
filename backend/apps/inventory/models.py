from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.masters.models import PackagingMaterial, Product, RawMaterial


class StockItemType(models.TextChoices):
    RAW = "RAW", "Raw Material"
    PACKAGING = "PACKAGING", "Packaging Material"
    FINISHED = "FINISHED", "Finished Goods"


class MovementType(models.TextChoices):
    OPENING = "OPENING", "Opening Stock"
    PURCHASE_RECEIPT = "PURCHASE_RECEIPT", "Purchase Receipt"
    PRODUCTION_ISSUE = "PRODUCTION_ISSUE", "Production Material Issue"
    PRODUCTION_OUTPUT = "PRODUCTION_OUTPUT", "Production Finished Output"
    SALES_DISPATCH = "SALES_DISPATCH", "Sales Dispatch"
    RETURN = "RETURN", "Return"
    ADJUSTMENT = "ADJUSTMENT", "Adjustment"


class StockLedger(models.Model):
    item_type = models.CharField(
        max_length=16, choices=StockItemType.choices, db_index=True
    )
    raw_material = models.ForeignKey(
        RawMaterial,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="ledger_entries",
    )
    packaging_material = models.ForeignKey(
        PackagingMaterial,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="ledger_entries",
    )
    product = models.ForeignKey(
        Product,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="ledger_entries",
    )
    movement_type = models.CharField(
        max_length=24, choices=MovementType.choices, db_index=True
    )
    quantity_delta = models.DecimalField(max_digits=14, decimal_places=3)
    unit_cost = models.DecimalField(
        max_digits=12, decimal_places=4, default=Decimal("0.0000")
    )
    total_value = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    running_balance = models.DecimalField(max_digits=14, decimal_places=3)
    source_type = models.CharField(max_length=40, db_index=True)
    source_id = models.CharField(max_length=64, blank=True, default="", db_index=True)
    reference_no = models.CharField(max_length=64, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="stock_movements",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["item_type", "raw_material", "created_at"]),
            models.Index(fields=["item_type", "packaging_material", "created_at"]),
            models.Index(fields=["item_type", "product", "created_at"]),
            models.Index(fields=["source_type", "source_id"]),
        ]

    @property
    def item_name(self) -> str:
        if self.item_type == StockItemType.RAW and self.raw_material:
            return self.raw_material.name
        if self.item_type == StockItemType.PACKAGING and self.packaging_material:
            return self.packaging_material.name
        if self.item_type == StockItemType.FINISHED and self.product:
            return f"{self.product.name} ({self.product.pack_size})"
        return ""

    @property
    def unit_symbol(self) -> str:
        if self.item_type == StockItemType.RAW and self.raw_material:
            return self.raw_material.unit.symbol
        if self.item_type == StockItemType.PACKAGING and self.packaging_material:
            return self.packaging_material.unit.symbol
        if self.item_type == StockItemType.FINISHED and self.product:
            return self.product.unit.symbol
        return ""
