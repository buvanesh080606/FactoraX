from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone


class Unit(models.Model):
    name = models.CharField(max_length=60, unique=True)
    symbol = models.CharField(max_length=16, unique=True)
    base_unit = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="derived_units",
    )
    factor_to_base = models.DecimalField(
        max_digits=14,
        decimal_places=6,
        default=Decimal("1.000000"),
        help_text="Multiply a quantity in this unit by factor_to_base to get base_unit quantity (e.g. g->kg = 0.001, carton->pkt = 20).",
    )

    class Meta:
        ordering = ["name"]

    @property
    def canonical_root(self) -> tuple["Unit", Decimal]:
        unit = self
        factor = Decimal("1.000000")
        visited = set()
        while unit.base_unit_id and unit.id not in visited:
            visited.add(unit.id)
            factor *= unit.factor_to_base
            unit = unit.base_unit
        return unit, factor

    def __str__(self) -> str:
        return f"{self.name} ({self.symbol})"


class CustomerType(models.TextChoices):
    RETAILER = "RETAILER", "Retailer"
    DISTRIBUTOR = "DISTRIBUTOR", "Distributor"
    WHOLESALER = "WHOLESALER", "Wholesaler"
    SUPERMARKET = "SUPERMARKET", "Supermarket"


class Customer(models.Model):
    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=160, db_index=True)
    customer_type = models.CharField(
        max_length=20, choices=CustomerType.choices, default=CustomerType.RETAILER
    )
    state = models.CharField(max_length=60, default="Tamil Nadu", db_index=True)
    gstin = models.CharField(max_length=20, blank=True, default="")
    contact_person = models.CharField(max_length=120, blank=True, default="")
    phone = models.CharField(max_length=24, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    address = models.TextField(blank=True, default="")
    credit_limit = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    assigned_salesman = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assigned_customers",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.state})"


class Supplier(models.Model):
    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=160, db_index=True)
    gstin = models.CharField(max_length=20, blank=True, default="")
    state = models.CharField(max_length=60, default="Tamil Nadu")
    contact_person = models.CharField(max_length=120, blank=True, default="")
    phone = models.CharField(max_length=24, blank=True, default="")
    email = models.EmailField(blank=True, default="")
    address = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class ProductCategory(models.TextChoices):
    MURUKKU = "MURUKKU", "Murukku"
    MIXTURE = "MIXTURE", "Mixture"
    CHIPS = "CHIPS", "Chips"
    SWEETS = "SWEETS", "Sweets"


class Product(models.Model):
    sku = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=160, db_index=True)
    category = models.CharField(
        max_length=20, choices=ProductCategory.choices, db_index=True
    )
    pack_size = models.CharField(max_length=40, default="200 g")
    unit = models.ForeignKey(Unit, on_delete=models.PROTECT, related_name="products")
    hsn_code = models.CharField(max_length=16, default="21069099")
    gst_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("5.00")
    )
    selling_price = models.DecimalField(max_digits=12, decimal_places=2)
    reorder_level = models.DecimalField(
        max_digits=12, decimal_places=3, default=Decimal("50.000")
    )
    image_url = models.CharField(max_length=500, blank=True, default="")
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category", "name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.pack_size})"


class ProductPrice(models.Model):
    product = models.ForeignKey(
        Product, on_delete=models.CASCADE, related_name="price_history"
    )
    price = models.DecimalField(max_digits=12, decimal_places=2)
    effective_from = models.DateField(default=timezone.localdate)
    effective_to = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-effective_from", "-created_at"]


class RawMaterial(models.Model):
    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=160, db_index=True)
    unit = models.ForeignKey(
        Unit, on_delete=models.PROTECT, related_name="raw_materials"
    )
    reorder_level = models.DecimalField(
        max_digits=12, decimal_places=3, default=Decimal("20.000")
    )
    weighted_avg_cost = models.DecimalField(
        max_digits=12, decimal_places=4, default=Decimal("0.0000")
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.unit.symbol})"


class PackagingMaterial(models.Model):
    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=160, db_index=True)
    unit = models.ForeignKey(
        Unit, on_delete=models.PROTECT, related_name="packaging_materials"
    )
    reorder_level = models.DecimalField(
        max_digits=12, decimal_places=3, default=Decimal("100.000")
    )
    weighted_avg_cost = models.DecimalField(
        max_digits=12, decimal_places=4, default=Decimal("0.0000")
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.unit.symbol})"


class MaterialType(models.TextChoices):
    RAW = "RAW", "Raw Material"
    PACKAGING = "PACKAGING", "Packaging Material"


class BOM(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="boms")
    version = models.PositiveIntegerField(default=1)
    expected_output_qty = models.DecimalField(max_digits=12, decimal_places=3)
    is_active = models.BooleanField(default=True, db_index=True)
    notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_boms",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["product__name", "-version"]
        unique_together = [("product", "version")]

    def save(self, *args, **kwargs):
        if self.is_active and self.product_id:
            BOM.objects.filter(product_id=self.product_id, is_active=True).exclude(
                pk=self.pk
            ).update(is_active=False)
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"BOM v{self.version} - {self.product.name} ({self.expected_output_qty} {self.product.unit.symbol})"


class BOMItem(models.Model):
    bom = models.ForeignKey(BOM, on_delete=models.CASCADE, related_name="items")
    material_type = models.CharField(max_length=16, choices=MaterialType.choices)
    raw_material = models.ForeignKey(
        RawMaterial,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="bom_items",
    )
    packaging_material = models.ForeignKey(
        PackagingMaterial,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="bom_items",
    )
    standard_qty = models.DecimalField(max_digits=12, decimal_places=3)
    unit = models.ForeignKey(Unit, on_delete=models.PROTECT)

    class Meta:
        ordering = ["material_type", "id"]

    def clean(self):
        if self.material_type == MaterialType.RAW:
            if not self.raw_material_id or self.packaging_material_id:
                raise ValidationError(
                    "RAW BOM item must reference raw_material only."
                )
        elif self.material_type == MaterialType.PACKAGING:
            if not self.packaging_material_id or self.raw_material_id:
                raise ValidationError(
                    "PACKAGING BOM item must reference packaging_material only."
                )

    @property
    def material_name(self) -> str:
        if self.material_type == MaterialType.RAW and self.raw_material:
            return self.raw_material.name
        if self.material_type == MaterialType.PACKAGING and self.packaging_material:
            return self.packaging_material.name
        return ""
