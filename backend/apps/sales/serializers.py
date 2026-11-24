from decimal import Decimal

from rest_framework import serializers

from apps.masters.models import Customer, Product
from apps.sales.models import (
    CreditNote,
    Dispatch,
    DispatchItem,
    Invoice,
    InvoiceItem,
    OrderStatusHistory,
    Payment,
    PaymentAllocation,
    PaymentMode,
    PaymentStatus,
    SalesOrder,
    SalesOrderItem,
)
from apps.sales.services import (
    check_order_stock,
    get_invoice_allocated_total,
    get_invoice_dispatched_qty_map,
    get_invoice_outstanding,
)


class SalesOrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    pack_size = serializers.CharField(source="product.pack_size", read_only=True)
    unit_symbol = serializers.CharField(source="product.unit.symbol", read_only=True)

    class Meta:
        model = SalesOrderItem
        fields = [
            "id",
            "product",
            "product_name",
            "pack_size",
            "unit_symbol",
            "quantity",
            "unit_price",
            "gst_rate",
            "taxable_amount",
            "gst_amount",
            "line_total",
        ]


class OrderStatusHistorySerializer(serializers.ModelSerializer):
    changed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = OrderStatusHistory
        fields = [
            "id",
            "from_status",
            "to_status",
            "changed_by",
            "changed_by_name",
            "remarks",
            "created_at",
        ]

    def get_changed_by_name(self, obj):
        return obj.changed_by.full_name if obj.changed_by else "System"


class SalesOrderSerializer(serializers.ModelSerializer):
    items = SalesOrderItemSerializer(many=True, read_only=True)
    status_history = OrderStatusHistorySerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_state = serializers.CharField(source="customer.state", read_only=True)
    customer_type = serializers.CharField(source="customer.customer_type", read_only=True)
    salesman_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    invoice_id = serializers.SerializerMethodField()
    invoice_number = serializers.SerializerMethodField()
    total_quantity = serializers.SerializerMethodField()
    stock_sufficient = serializers.SerializerMethodField()

    class Meta:
        model = SalesOrder
        fields = [
            "id",
            "order_number",
            "idempotency_key",
            "customer",
            "customer_name",
            "customer_state",
            "customer_type",
            "salesman",
            "salesman_name",
            "order_date",
            "status",
            "subtotal",
            "tax_estimate",
            "grand_total",
            "total_quantity",
            "stock_sufficient",
            "delivery_notes",
            "rejection_reason",
            "approved_by",
            "approved_by_name",
            "approved_at",
            "invoice_id",
            "invoice_number",
            "items",
            "status_history",
            "created_at",
            "updated_at",
        ]

    def get_salesman_name(self, obj):
        return obj.salesman.full_name if obj.salesman else None

    def get_approved_by_name(self, obj):
        return obj.approved_by.full_name if obj.approved_by else None

    def get_invoice_id(self, obj):
        return obj.invoice.id if hasattr(obj, "invoice") else None

    def get_invoice_number(self, obj):
        return obj.invoice.invoice_number if hasattr(obj, "invoice") else None

    def get_total_quantity(self, obj):
        total = sum((i.quantity for i in obj.items.all()), Decimal("0.000"))
        return str(total)

    def get_stock_sufficient(self, obj):
        if obj.status in ("INVOICED", "DISPATCHED", "REJECTED"):
            return True
        return check_order_stock(obj)["is_sufficient"]


class SalesOrderItemInputSerializer(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    quantity = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0.001"))
    unit_price = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )


class SalesOrderCreateSerializer(serializers.Serializer):
    customer = serializers.PrimaryKeyRelatedField(queryset=Customer.objects.all())
    order_date = serializers.DateField(required=False)
    delivery_notes = serializers.CharField(required=False, allow_blank=True, default="")
    idempotency_key = serializers.CharField(
        max_length=80, required=False, allow_blank=True, allow_null=True
    )
    items = SalesOrderItemInputSerializer(many=True)

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("At least one order item is required.")
        return value


class InvoiceItemSerializer(serializers.ModelSerializer):
    dispatched_qty = serializers.SerializerMethodField()
    remaining_qty = serializers.SerializerMethodField()

    class Meta:
        model = InvoiceItem
        fields = [
            "id",
            "product",
            "product_name",
            "hsn_code",
            "quantity",
            "unit_price",
            "taxable_amount",
            "gst_rate",
            "cgst_amount",
            "sgst_amount",
            "igst_amount",
            "line_total",
            "dispatched_qty",
            "remaining_qty",
        ]

    def get_dispatched_qty(self, obj):
        dmap = self.context.get("dispatched_map")
        if dmap is None:
            dmap = get_invoice_dispatched_qty_map(obj.invoice_id)
        return str(dmap.get(obj.id, Decimal("0.000")))

    def get_remaining_qty(self, obj):
        dmap = self.context.get("dispatched_map")
        if dmap is None:
            dmap = get_invoice_dispatched_qty_map(obj.invoice_id)
        rem = max(Decimal("0.000"), obj.quantity - dmap.get(obj.id, Decimal("0.000")))
        return str(rem)


class CreditNoteSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = CreditNote
        fields = [
            "id",
            "credit_note_number",
            "invoice",
            "credit_date",
            "amount",
            "reason",
            "restock_finished_goods",
            "created_by",
            "created_by_name",
            "created_at",
        ]

    def get_created_by_name(self, obj):
        return obj.created_by.full_name if obj.created_by else None


class InvoiceSerializer(serializers.ModelSerializer):
    items = serializers.SerializerMethodField()
    credit_notes = CreditNoteSerializer(many=True, read_only=True)
    order_number = serializers.CharField(source="order.order_number", read_only=True)
    order_status = serializers.CharField(source="order.status", read_only=True)
    customer_phone = serializers.CharField(source="customer.phone", read_only=True)
    customer_email = serializers.CharField(source="customer.email", read_only=True)
    allocated_payments = serializers.SerializerMethodField()
    outstanding_amount = serializers.SerializerMethodField()
    dispatch_status = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = [
            "id",
            "invoice_number",
            "financial_year",
            "invoice_date",
            "order",
            "order_number",
            "order_status",
            "customer",
            "customer_phone",
            "customer_email",
            "seller_name",
            "seller_gstin",
            "seller_state",
            "customer_name",
            "customer_gstin",
            "customer_state",
            "customer_address",
            "is_inter_state",
            "taxable_total",
            "cgst_total",
            "sgst_total",
            "igst_total",
            "grand_total",
            "credit_notes_total",
            "credit_notes",
            "allocated_payments",
            "outstanding_amount",
            "dispatch_status",
            "items",
            "created_at",
        ]

    def get_items(self, obj):
        dmap = get_invoice_dispatched_qty_map(obj.id)
        return InvoiceItemSerializer(
            obj.items.all(), many=True, context={"dispatched_map": dmap}
        ).data

    def get_allocated_payments(self, obj):
        return str(get_invoice_allocated_total(obj.id))

    def get_outstanding_amount(self, obj):
        return str(get_invoice_outstanding(obj))

    def get_dispatch_status(self, obj):
        dmap = get_invoice_dispatched_qty_map(obj.id)
        items = list(obj.items.all())
        if not items:
            return "PENDING"
        total_inv = sum((i.quantity for i in items), Decimal("0.000"))
        total_dsp = sum((dmap.get(i.id, Decimal("0.000")) for i in items), Decimal("0.000"))
        if total_dsp <= 0:
            return "PENDING"
        if total_dsp < total_inv:
            return "PARTIAL"
        return "DISPATCHED"


class DispatchItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    pack_size = serializers.CharField(source="product.pack_size", read_only=True)

    class Meta:
        model = DispatchItem
        fields = ["id", "invoice_item", "product", "product_name", "pack_size", "dispatched_qty"]


class DispatchSerializer(serializers.ModelSerializer):
    items = DispatchItemSerializer(many=True, read_only=True)
    invoice_number = serializers.CharField(source="invoice.invoice_number", read_only=True)
    order_number = serializers.CharField(source="order.order_number", read_only=True)
    customer_name = serializers.CharField(source="invoice.customer_name", read_only=True)
    dispatched_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Dispatch
        fields = [
            "id",
            "dispatch_number",
            "invoice",
            "invoice_number",
            "order",
            "order_number",
            "customer_name",
            "dispatch_date",
            "vehicle_no",
            "transporter",
            "notes",
            "dispatched_by",
            "dispatched_by_name",
            "items",
            "created_at",
        ]

    def get_dispatched_by_name(self, obj):
        return obj.dispatched_by.full_name if obj.dispatched_by else None


class DispatchItemInputSerializer(serializers.Serializer):
    invoice_item = serializers.IntegerField()
    dispatched_qty = serializers.DecimalField(
        max_digits=12, decimal_places=3, min_value=Decimal("0.001")
    )


class DispatchCreateSerializer(serializers.Serializer):
    invoice = serializers.IntegerField()
    dispatch_date = serializers.DateField(required=False)
    vehicle_no = serializers.CharField(max_length=40, required=False, allow_blank=True, default="")
    transporter = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    items = DispatchItemInputSerializer(many=True, required=False)


class PaymentAllocationSerializer(serializers.ModelSerializer):
    invoice_number = serializers.CharField(source="invoice.invoice_number", read_only=True)

    class Meta:
        model = PaymentAllocation
        fields = ["id", "invoice", "invoice_number", "allocated_amount", "created_at"]


class PaymentSerializer(serializers.ModelSerializer):
    allocations = PaymentAllocationSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    recorded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            "id",
            "payment_number",
            "idempotency_key",
            "customer",
            "customer_name",
            "payment_date",
            "amount",
            "payment_status",
            "pending_amount",
            "payment_mode",
            "reference_number",
            "notes",
            "recorded_by",
            "recorded_by_name",
            "allocations",
            "created_at",
        ]

    def get_recorded_by_name(self, obj):
        return obj.recorded_by.full_name if obj.recorded_by else None


class PaymentAllocationInputSerializer(serializers.Serializer):
    invoice = serializers.IntegerField()
    allocated_amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0.01")
    )


class PaymentCreateSerializer(serializers.Serializer):
    customer = serializers.PrimaryKeyRelatedField(queryset=Customer.objects.all())
    invoice = serializers.IntegerField(required=False, allow_null=True)
    amount = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0.01"))
    payment_status = serializers.ChoiceField(
        choices=PaymentStatus.choices, required=False, allow_null=True
    )
    pending_amount = serializers.DecimalField(
        max_digits=14, decimal_places=2, min_value=Decimal("0.00"), required=False, allow_null=True
    )
    payment_mode = serializers.ChoiceField(choices=PaymentMode.choices)
    payment_date = serializers.DateField(required=False)
    reference_number = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    idempotency_key = serializers.CharField(
        max_length=80, required=False, allow_blank=True, allow_null=True
    )
    allocations = PaymentAllocationInputSerializer(many=True, required=False)
