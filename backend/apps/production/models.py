from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.masters.models import (
    BOM,
    MaterialType,
    PackagingMaterial,
    Product,
    RawMaterial,
    Unit,
)


class ProductionStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    CONFIRMED = "CONFIRMED", "Confirmed"


class ProductionRun(models.Model):
    run_number = models.CharField(max_length=32, unique=True, db_index=True)
    product = models.ForeignKey(
        Product, on_delete=models.PROTECT, related_name="production_runs"
    )
    bom = models.ForeignKey(
        BOM, on_delete=models.PROTECT, related_name="production_runs"
    )
    run_date = models.DateField(default=timezone.localdate, db_index=True)
    batch_multiplier = models.DecimalField(
        max_digits=10, decimal_places=3, default=Decimal("1.000")
    )
    expected_output_qty = models.DecimalField(max_digits=12, decimal_places=3)
    actual_good_output_qty = models.DecimalField(max_digits=12, decimal_places=3)
    wastage_qty = models.DecimalField(
        max_digits=12, decimal_places=3, default=Decimal("0.000")
    )
    damaged_packaging_qty = models.DecimalField(
        max_digits=12, decimal_places=3, default=Decimal("0.000")
    )
    yield_variance_pct = models.DecimalField(
        max_digits=8, decimal_places=2, default=Decimal("0.00")
    )
    has_variance_flag = models.BooleanField(default=False, db_index=True)

    # Costing fields (Weighted Average Material Cost + Allocated Overheads)
    raw_material_cost = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    packaging_cost = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    labour_cost = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    gas_power_cost = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    other_overhead_cost = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    total_production_cost = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    cost_per_good_packet = models.DecimalField(
        max_digits=12, decimal_places=4, default=Decimal("0.0000")
    )

    status = models.CharField(
        max_length=16,
        choices=ProductionStatus.choices,
        default=ProductionStatus.CONFIRMED,
        db_index=True,
    )
    notes = models.TextField(blank=True, default="")
    supervised_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="supervised_runs",
    )
    confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="confirmed_runs",
    )
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-run_date", "-created_at"]

    def __str__(self) -> str:
        return f"{self.run_number} - {self.product.name} ({self.actual_good_output_qty})"


class ProductionConsumption(models.Model):
    production_run = models.ForeignKey(
        ProductionRun, on_delete=models.CASCADE, related_name="consumptions"
    )
    material_type = models.CharField(max_length=16, choices=MaterialType.choices)
    raw_material = models.ForeignKey(
        RawMaterial,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="production_consumptions",
    )
    packaging_material = models.ForeignKey(
        PackagingMaterial,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="production_consumptions",
    )
    unit = models.ForeignKey(Unit, on_delete=models.PROTECT)
    planned_qty = models.DecimalField(max_digits=12, decimal_places=3)
    actual_qty = models.DecimalField(max_digits=12, decimal_places=3)
    damaged_qty = models.DecimalField(
        max_digits=12, decimal_places=3, default=Decimal("0.000")
    )
    total_issued_qty = models.DecimalField(max_digits=12, decimal_places=3)
    variance_qty = models.DecimalField(max_digits=12, decimal_places=3)
    variance_pct = models.DecimalField(max_digits=8, decimal_places=2)
    is_variance_flagged = models.BooleanField(default=False, db_index=True)
    unit_cost = models.DecimalField(
        max_digits=12, decimal_places=4, default=Decimal("0.0000")
    )
    total_cost = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )

    @property
    def material_name(self) -> str:
        if self.material_type == MaterialType.RAW and self.raw_material:
            return self.raw_material.name
        if self.material_type == MaterialType.PACKAGING and self.packaging_material:
            return self.packaging_material.name
        return ""


class ExpenseCategory(models.TextChoices):
    LABOUR = "LABOUR", "Labour"
    GAS_POWER = "GAS_POWER", "Gas & Electricity"
    MAINTENANCE = "MAINTENANCE", "Maintenance"
    OTHER = "OTHER", "Other Overhead"


class Expense(models.Model):
    production_run = models.ForeignKey(
        ProductionRun,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
    )
    category = models.CharField(max_length=20, choices=ExpenseCategory.choices, db_index=True)
    description = models.CharField(max_length=240)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    expense_date = models.DateField(default=timezone.localdate, db_index=True)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recorded_expenses",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-expense_date", "-created_at"]
