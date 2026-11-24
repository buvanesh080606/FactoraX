from decimal import Decimal

from django.contrib.auth.models import AbstractUser
from django.db import models


class UserRole(models.TextChoices):
    SALESMAN = "SALESMAN", "Salesman"
    ADMIN = "ADMIN", "Admin & Billing"
    PRODUCTION = "PRODUCTION", "Production Supervisor"
    ACCOUNTANT = "ACCOUNTANT", "Accountant / Auditor"
    OWNER = "OWNER", "Business Owner"


ROLE_HOME_ROUTES = {
    UserRole.SALESMAN: "/salesman/home",
    UserRole.ADMIN: "/admin/dashboard",
    UserRole.PRODUCTION: "/production/dashboard",
    UserRole.ACCOUNTANT: "/accountant/dashboard",
    UserRole.OWNER: "/owner/dashboard",
}


class User(AbstractUser):
    email = models.EmailField(unique=True)
    role = models.CharField(
        max_length=20,
        choices=UserRole.choices,
        default=UserRole.SALESMAN,
        db_index=True,
    )
    phone = models.CharField(max_length=20, blank=True, default="")
    territory = models.CharField(max_length=120, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    @property
    def full_name(self) -> str:
        name = f"{self.first_name} {self.last_name}".strip()
        return name or self.username

    @property
    def home_route(self) -> str:
        return ROLE_HOME_ROUTES.get(self.role, "/login")

    def __str__(self) -> str:
        return f"{self.full_name} ({self.role})"


class CompanySetting(models.Model):
    company_name = models.CharField(max_length=150, default="SmartFactory Foods Pvt. Ltd.")
    gstin = models.CharField(max_length=20, default="33AABCS1234F1Z5")
    state = models.CharField(max_length=60, default="Tamil Nadu")
    address = models.TextField(
        default="Plot 14, SIDCO Industrial Estate, Tiruchirappalli, Tamil Nadu 620015"
    )
    phone = models.CharField(max_length=30, default="+91 431 245 8900")
    email = models.EmailField(default="billing@smartfactoryfoods.in")
    invoice_prefix = models.CharField(max_length=12, default="SF")
    financial_year = models.CharField(max_length=12, default="2025-26")
    variance_tolerance_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("3.00")
    )
    default_gst_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("5.00")
    )
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def get_solo(cls) -> "CompanySetting":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self) -> str:
        return f"{self.company_name} ({self.gstin})"


class AuditLog(models.Model):
    user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs"
    )
    action = models.CharField(max_length=64, db_index=True)
    entity_type = models.CharField(max_length=64, db_index=True)
    entity_id = models.CharField(max_length=64, blank=True, default="")
    summary = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.action} {self.entity_type}#{self.entity_id}"


class Notification(models.Model):
    recipient = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notifications",
    )
    target_role = models.CharField(
        max_length=20, choices=UserRole.choices, blank=True, default="", db_index=True
    )
    event_type = models.CharField(max_length=64, db_index=True)
    title = models.CharField(max_length=160)
    message = models.TextField()
    entity_type = models.CharField(max_length=64, blank=True, default="")
    entity_id = models.CharField(max_length=64, blank=True, default="")
    is_read = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"[{self.target_role or self.recipient_id}] {self.title}"
