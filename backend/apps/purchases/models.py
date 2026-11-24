from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.masters.models import MaterialType, PackagingMaterial, RawMaterial, Supplier


class PurchaseStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    CONFIRMED = "CONFIRMED", "Confirmed"
    CANCELLED = "CANCELLED", "Cancelled"


class Purchase(models.Model):
    purchase_number = models.CharField(max_length=32, unique=True, db_index=True)
    supplier = models.ForeignKey(
        Supplier, on_delete=models.PROTECT, related_name="purchases"
    )
    purchase_date = models.DateField(default=timezone.localdate, db_index=True)
    invoice_ref = models.CharField(max_length=64, blank=True, default="")
    status = models.CharField(
        max_length=16,
        choices=PurchaseStatus.choices,
        default=PurchaseStatus.DRAFT,
        db_index=True,
    )
    total_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_purchases",
    )
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="confirmed_purchases",
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-purchase_date", "-created_at"]

    def __str__(self) -> str:
        return f"{self.purchase_number} - {self.supplier.name}"


class PurchaseItem(models.Model):
    purchase = models.ForeignKey(
        Purchase, on_delete=models.CASCADE, related_name="items"
    )
    material_type = models.CharField(max_length=16, choices=MaterialType.choices)
    raw_material = models.ForeignKey(
        RawMaterial,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="purchase_items",
    )
    packaging_material = models.ForeignKey(
        PackagingMaterial,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="purchase_items",
    )
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit_rate = models.DecimalField(max_digits=12, decimal_places=4)
    line_total = models.DecimalField(max_digits=14, decimal_places=2)

    @property
    def material_name(self) -> str:
        if self.material_type == MaterialType.RAW and self.raw_material:
            return self.raw_material.name
        if self.material_type == MaterialType.PACKAGING and self.packaging_material:
            return self.packaging_material.name
        return ""

    @property
    def unit_symbol(self) -> str:
        if self.material_type == MaterialType.RAW and self.raw_material:
            return self.raw_material.unit.symbol
        if self.material_type == MaterialType.PACKAGING and self.packaging_material:
            return self.packaging_material.unit.symbol
        return ""
