from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.masters.models import Customer, Product


class OrderStatus(models.TextChoices):
    SUBMITTED = "SUBMITTED", "Submitted"
    PENDING_APPROVAL = "PENDING_APPROVAL", "Pending Approval"
    APPROVED = "APPROVED", "Approved"
    INVOICED = "INVOICED", "Invoiced"
    DISPATCHED = "DISPATCHED", "Dispatched"
    REJECTED = "REJECTED", "Rejected"


class SalesOrder(models.Model):
    order_number = models.CharField(max_length=32, unique=True, db_index=True)
    idempotency_key = models.CharField(
        max_length=80, unique=True, null=True, blank=True, db_index=True
    )
    customer = models.ForeignKey(
        Customer, on_delete=models.PROTECT, related_name="sales_orders"
    )
    salesman = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="sales_orders",
    )
    order_date = models.DateField(default=timezone.localdate, db_index=True)
    status = models.CharField(
        max_length=24,
        choices=OrderStatus.choices,
        default=OrderStatus.PENDING_APPROVAL,
        db_index=True,
    )
    subtotal = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    tax_estimate = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    grand_total = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    delivery_notes = models.TextField(blank=True, default="")
    rejection_reason = models.TextField(blank=True, default="")
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="approved_orders",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.order_number} - {self.customer.name} ({self.status})"


class SalesOrderItem(models.Model):
    order = models.ForeignKey(
        SalesOrder, on_delete=models.CASCADE, related_name="items"
    )
    product = models.ForeignKey(
        Product, on_delete=models.PROTECT, related_name="order_items"
    )
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    gst_rate = models.DecimalField(
        max_digits=5, decimal_places=2, default=Decimal("5.00")
    )
    taxable_amount = models.DecimalField(max_digits=14, decimal_places=2)
    gst_amount = models.DecimalField(max_digits=14, decimal_places=2)
    line_total = models.DecimalField(max_digits=14, decimal_places=2)


class OrderStatusHistory(models.Model):
    order = models.ForeignKey(
        SalesOrder, on_delete=models.CASCADE, related_name="status_history"
    )
    from_status = models.CharField(max_length=24, blank=True, default="")
    to_status = models.CharField(max_length=24)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
    )
    remarks = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class Invoice(models.Model):
    invoice_number = models.CharField(max_length=40, unique=True, db_index=True)
    financial_year = models.CharField(max_length=12, db_index=True)
    invoice_date = models.DateField(default=timezone.localdate, db_index=True)
    order = models.OneToOneField(
        SalesOrder, on_delete=models.PROTECT, related_name="invoice"
    )
    customer = models.ForeignKey(
        Customer, on_delete=models.PROTECT, related_name="invoices"
    )

    # Immutable GST snapshot at time of invoicing
    seller_name = models.CharField(max_length=160)
    seller_gstin = models.CharField(max_length=20)
    seller_state = models.CharField(max_length=60)
    seller_address = models.TextField(blank=True, default="")
    customer_name = models.CharField(max_length=160)
    customer_gstin = models.CharField(max_length=20, blank=True, default="")
    customer_state = models.CharField(max_length=60)
    customer_address = models.TextField(blank=True, default="")

    is_inter_state = models.BooleanField(default=False)
    taxable_total = models.DecimalField(max_digits=14, decimal_places=2)
    cgst_total = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    sgst_total = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    igst_total = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    grand_total = models.DecimalField(max_digits=14, decimal_places=2)
    credit_notes_total = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_invoices",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-invoice_date", "-created_at"]

    def __str__(self) -> str:
        return f"{self.invoice_number} - {self.customer_name} (Rs.{self.grand_total})"


class InvoiceItem(models.Model):
    invoice = models.ForeignKey(
        Invoice, on_delete=models.CASCADE, related_name="items"
    )
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    product_name = models.CharField(max_length=180)
    hsn_code = models.CharField(max_length=16)
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    taxable_amount = models.DecimalField(max_digits=14, decimal_places=2)
    gst_rate = models.DecimalField(max_digits=5, decimal_places=2)
    cgst_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    sgst_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    igst_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    line_total = models.DecimalField(max_digits=14, decimal_places=2)


class Dispatch(models.Model):
    dispatch_number = models.CharField(max_length=32, unique=True, db_index=True)
    invoice = models.ForeignKey(
        Invoice, on_delete=models.PROTECT, related_name="dispatches"
    )
    order = models.ForeignKey(
        SalesOrder, on_delete=models.PROTECT, related_name="dispatches"
    )
    dispatch_date = models.DateField(default=timezone.localdate, db_index=True)
    vehicle_no = models.CharField(max_length=40, blank=True, default="")
    transporter = models.CharField(max_length=120, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    dispatched_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="dispatches",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-dispatch_date", "-created_at"]


class DispatchItem(models.Model):
    dispatch = models.ForeignKey(
        Dispatch, on_delete=models.CASCADE, related_name="items"
    )
    invoice_item = models.ForeignKey(
        InvoiceItem, on_delete=models.PROTECT, related_name="dispatch_items"
    )
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    dispatched_qty = models.DecimalField(max_digits=12, decimal_places=3)


class PaymentMode(models.TextChoices):
    CASH = "CASH", "Cash"
    UPI = "UPI", "UPI"
    BANK_TRANSFER = "BANK_TRANSFER", "Bank Transfer"
    CHEQUE = "CHEQUE", "Cheque"


class PaymentStatus(models.TextChoices):
    PENDING_DUE = "PENDING_DUE", "Pending Due"
    NO_PENDING_DUE = "NO_PENDING_DUE", "No Pending Due"
    REVERSED = "REVERSED", "Reversed / Cancelled"


class Payment(models.Model):
    payment_number = models.CharField(max_length=32, unique=True, db_index=True)
    idempotency_key = models.CharField(
        max_length=80, unique=True, null=True, blank=True, db_index=True
    )
    customer = models.ForeignKey(
        Customer, on_delete=models.PROTECT, related_name="payments"
    )
    payment_date = models.DateField(default=timezone.localdate, db_index=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    payment_status = models.CharField(
        max_length=20,
        choices=PaymentStatus.choices,
        default=PaymentStatus.NO_PENDING_DUE,
        db_index=True,
    )
    pending_amount = models.DecimalField(
        max_digits=14, decimal_places=2, default=Decimal("0.00")
    )
    payment_mode = models.CharField(
        max_length=20, choices=PaymentMode.choices, default=PaymentMode.UPI
    )
    reference_number = models.CharField(max_length=80, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="recorded_payments",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-payment_date", "-created_at"]


class PaymentAllocation(models.Model):
    payment = models.ForeignKey(
        Payment, on_delete=models.CASCADE, related_name="allocations"
    )
    invoice = models.ForeignKey(
        Invoice, on_delete=models.PROTECT, related_name="payment_allocations"
    )
    allocated_amount = models.DecimalField(max_digits=14, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("payment", "invoice")]


class CreditNote(models.Model):
    """Audit-safe cancellation/adjustment against a posted GST invoice (posted invoices are never deleted)."""
    credit_note_number = models.CharField(max_length=40, unique=True, db_index=True)
    invoice = models.ForeignKey(
        Invoice, on_delete=models.PROTECT, related_name="credit_notes"
    )
    credit_date = models.DateField(default=timezone.localdate, db_index=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    reason = models.TextField()
    restock_finished_goods = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="issued_credit_notes",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-credit_date", "-created_at"]

    def __str__(self) -> str:
        return f"{self.credit_note_number} against {self.invoice.invoice_number} (Rs.{self.amount})"
