from decimal import Decimal

from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import UserRole
from apps.accounts.permissions import ADMIN_OWNER, role_permission
from apps.inventory.services import InsufficientStockError
from apps.masters.models import Customer
from apps.sales.models import Dispatch, Invoice, OrderStatus, Payment, SalesOrder
from apps.sales.pdf import render_invoice_pdf
from apps.sales.serializers import (
    CreditNoteSerializer,
    DispatchCreateSerializer,
    DispatchSerializer,
    InvoiceSerializer,
    PaymentCreateSerializer,
    PaymentSerializer,
    SalesOrderCreateSerializer,
    SalesOrderItemInputSerializer,
    SalesOrderSerializer,
)
from apps.sales.services import (
    approve_sales_order,
    check_order_stock,
    create_dispatch,
    create_sales_order,
    delete_payment,
    generate_gst_invoice,
    get_invoice_allocated_total,
    get_invoice_outstanding,
    issue_credit_note,
    record_payment,
    reject_sales_order,
    update_payment,
    update_pending_order,
)

SALES_READ = {UserRole.SALESMAN, UserRole.ADMIN, UserRole.ACCOUNTANT, UserRole.OWNER}
ORDER_WRITE = {UserRole.SALESMAN, UserRole.ADMIN, UserRole.OWNER}


class SalesOrderViewSet(viewsets.ModelViewSet):
    queryset = (
        SalesOrder.objects.select_related("customer", "salesman", "approved_by", "invoice")
        .prefetch_related(
            "items",
            "items__product",
            "items__product__unit",
            "status_history",
            "status_history__changed_by",
        )
        .all()
    )
    serializer_class = SalesOrderSerializer
    permission_classes = [role_permission(SALES_READ, ORDER_WRITE)]
    filterset_fields = ["status", "customer", "salesman", "order_date"]
    search_fields = ["order_number", "customer__name", "salesman__username", "delivery_notes"]
    ordering_fields = ["created_at", "order_date", "grand_total", "status"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role == UserRole.SALESMAN:
            qs = qs.filter(salesman=user)
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(order_date__gte=date_from)
        if date_to:
            qs = qs.filter(order_date__lte=date_to)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = SalesOrderCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        customer = d["customer"]

        if request.user.role == UserRole.SALESMAN:
            if customer.assigned_salesman_id and customer.assigned_salesman_id != request.user.id:
                return Response(
                    {"detail": "You are not authorized to place orders for this customer."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        try:
            order, created = create_sales_order(
                customer=customer,
                salesman=request.user,
                items_data=d["items"],
                delivery_notes=d["delivery_notes"],
                order_date=d.get("order_date"),
                idempotency_key=d.get("idempotency_key") or None,
                request=request,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            SalesOrderSerializer(order).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def partial_update(self, request, *args, **kwargs):
        if request.user.role not in ADMIN_OWNER:
            return Response(
                {"detail": "Only Admin or Owner can edit submitted orders."},
                status=status.HTTP_403_FORBIDDEN,
            )
        order = self.get_object()
        items_data = None
        if "items" in request.data:
            item_ser = SalesOrderItemInputSerializer(data=request.data["items"], many=True)
            item_ser.is_valid(raise_exception=True)
            items_data = item_ser.validated_data
        try:
            updated = update_pending_order(
                order_id=order.id,
                user=request.user,
                items_data=items_data,
                delivery_notes=request.data.get("delivery_notes"),
                request=request,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(SalesOrderSerializer(updated).data)

    @action(detail=True, methods=["get"], url_path="stock-check")
    def stock_check(self, request, pk=None):
        if request.user.role not in (UserRole.ADMIN, UserRole.OWNER, UserRole.PRODUCTION):
            return Response({"detail": "Not authorized."}, status=status.HTTP_403_FORBIDDEN)
        order = self.get_object()
        return Response(check_order_stock(order))

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        if request.user.role not in ADMIN_OWNER:
            return Response(
                {"detail": "Only Admin or Owner can approve orders."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            order = approve_sales_order(
                int(pk),
                user=request.user,
                remarks=request.data.get("remarks", ""),
                request=request,
            )
        except (InsufficientStockError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(SalesOrderSerializer(order).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        if request.user.role not in ADMIN_OWNER:
            return Response(
                {"detail": "Only Admin or Owner can reject orders."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            order = reject_sales_order(
                int(pk),
                user=request.user,
                reason=request.data.get("reason", ""),
                request=request,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(SalesOrderSerializer(order).data)

    @action(detail=True, methods=["post"], url_path="generate-invoice")
    def generate_invoice(self, request, pk=None):
        if request.user.role not in ADMIN_OWNER:
            return Response(
                {"detail": "Only Admin or Owner can generate invoices."},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            invoice = generate_gst_invoice(
                int(pk),
                user=request.user,
                invoice_date=request.data.get("invoice_date") or None,
                request=request,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(InvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)


class InvoiceViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = (
        Invoice.objects.select_related("order", "customer", "created_by")
        .prefetch_related("items", "items__product")
        .all()
    )
    serializer_class = InvoiceSerializer
    permission_classes = [role_permission(SALES_READ, ADMIN_OWNER)]
    filterset_fields = ["customer", "is_inter_state", "financial_year", "invoice_date"]
    search_fields = ["invoice_number", "customer_name", "order__order_number"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role == UserRole.SALESMAN:
            qs = qs.filter(
                Q(order__salesman=user)
                | Q(customer__assigned_salesman=user)
                | Q(customer__assigned_salesman__isnull=True)
            )
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(invoice_date__gte=date_from)
        if date_to:
            qs = qs.filter(invoice_date__lte=date_to)
        return qs

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        invoice = self.get_object()
        pdf_bytes = render_invoice_pdf(invoice)
        filename = f"{invoice.invoice_number.replace('/', '-')}.pdf"
        resp = HttpResponse(pdf_bytes, content_type="application/pdf")
        resp["Content-Disposition"] = f'attachment; filename="{filename}"'
        return resp

    @action(detail=True, methods=["post"], url_path="credit-note")
    def credit_note(self, request, pk=None):
        if request.user.role not in ADMIN_OWNER:
            return Response(
                {"detail": "Only Admin or Owner can issue credit notes."},
                status=status.HTTP_403_FORBIDDEN,
            )
        invoice = self.get_object()
        try:
            cn = issue_credit_note(
                invoice_id=invoice.id,
                user=request.user,
                amount=Decimal(str(request.data.get("amount", invoice.grand_total))),
                reason=request.data.get("reason", ""),
                restock_finished_goods=bool(request.data.get("restock_finished_goods", False)),
                request=request,
            )
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(CreditNoteSerializer(cn).data, status=status.HTTP_201_CREATED)


class DispatchViewSet(viewsets.ModelViewSet):
    queryset = (
        Dispatch.objects.select_related("invoice", "order", "dispatched_by")
        .prefetch_related("items", "items__product")
        .all()
    )
    serializer_class = DispatchSerializer
    permission_classes = [role_permission(SALES_READ, ADMIN_OWNER)]
    filterset_fields = ["invoice", "order", "dispatch_date"]
    search_fields = ["dispatch_number", "invoice__invoice_number", "vehicle_no", "transporter"]
    http_method_names = ["get", "post", "head", "options"]

    def create(self, request, *args, **kwargs):
        serializer = DispatchCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        try:
            dispatch = create_dispatch(
                invoice_id=d["invoice"],
                user=request.user,
                items_input=d.get("items"),
                dispatch_date=d.get("dispatch_date"),
                vehicle_no=d["vehicle_no"],
                transporter=d["transporter"],
                notes=d["notes"],
                request=request,
            )
        except (InsufficientStockError, ValueError, Invoice.DoesNotExist) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(DispatchSerializer(dispatch).data, status=status.HTTP_201_CREATED)


class PaymentViewSet(viewsets.ModelViewSet):
    queryset = (
        Payment.objects.select_related("customer", "recorded_by")
        .prefetch_related("allocations", "allocations__invoice")
        .all()
    )
    serializer_class = PaymentSerializer
    permission_classes = [role_permission(SALES_READ, ORDER_WRITE)]
    filterset_fields = ["customer", "payment_mode", "payment_date", "payment_status"]
    search_fields = ["payment_number", "customer__name", "reference_number"]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.role == UserRole.SALESMAN:
            qs = qs.filter(
                Q(recorded_by=user)
                | Q(customer__assigned_salesman=user)
                | Q(customer__assigned_salesman__isnull=True)
            )
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if date_from:
            qs = qs.filter(payment_date__gte=date_from)
        if date_to:
            qs = qs.filter(payment_date__lte=date_to)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = PaymentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        customer = d["customer"]

        if request.user.role == UserRole.SALESMAN:
            if customer.assigned_salesman_id and customer.assigned_salesman_id != request.user.id:
                return Response(
                    {"detail": "You are not authorized to record collections for this customer."},
                    status=status.HTTP_403_FORBIDDEN,
                )
        try:
            payment, created = record_payment(
                customer=customer,
                amount=d["amount"],
                payment_mode=d["payment_mode"],
                payment_date=d.get("payment_date"),
                reference_number=d["reference_number"],
                notes=d["notes"],
                payment_status=d.get("payment_status"),
                pending_amount=d.get("pending_amount"),
                allocations_input=d.get("allocations"),
                invoice_id=d.get("invoice"),
                idempotency_key=d.get("idempotency_key") or None,
                user=request.user,
                request=request,
            )
        except (ValueError, Invoice.DoesNotExist) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            PaymentSerializer(payment).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def partial_update(self, request, *args, **kwargs):
        if request.user.role not in ADMIN_OWNER:
            return Response(
                {"detail": "Only Admin or Owner can edit payment records."},
                status=status.HTTP_403_FORBIDDEN,
            )
        payment = self.get_object()
        try:
            updated = update_payment(
                payment_id=payment.id,
                user=request.user,
                amount=Decimal(str(request.data["amount"])) if "amount" in request.data and request.data["amount"] != "" else None,
                payment_mode=request.data.get("payment_mode"),
                payment_date=request.data.get("payment_date") or None,
                reference_number=request.data.get("reference_number"),
                notes=request.data.get("notes"),
                payment_status=request.data.get("payment_status") or None,
                pending_amount=Decimal(str(request.data["pending_amount"])) if "pending_amount" in request.data and request.data["pending_amount"] != "" else None,
                invoice_id=int(request.data["invoice"]) if request.data.get("invoice") else None,
                request=request,
            )
        except Exception as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(PaymentSerializer(updated).data)

    def destroy(self, request, *args, **kwargs):
        if request.user.role not in ADMIN_OWNER:
            return Response(
                {"detail": "Only Admin or Owner can reverse payment records."},
                status=status.HTTP_403_FORBIDDEN,
            )
        payment = self.get_object()
        try:
            info = delete_payment(payment_id=payment.id, user=request.user, request=request)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {
                "reversed": True,
                "detail": f"Reversed {info['payment_number']} (Rs.{info['amount']}) — record preserved for audit.",
                **info,
            },
            status=status.HTTP_200_OK,
        )


class ReceivablesAgeingView(APIView):
    permission_classes = [role_permission(SALES_READ, ADMIN_OWNER)]

    def get(self, request):
        today = timezone.localdate()
        qs = Invoice.objects.select_related("customer").all()
        if request.user.role == UserRole.SALESMAN:
            qs = qs.filter(
                Q(customer__assigned_salesman=request.user)
                | Q(customer__assigned_salesman__isnull=True)
            )
        customer_id = request.query_params.get("customer")
        if customer_id:
            qs = qs.filter(customer_id=customer_id)

        invoices_data = []
        buckets = {
            "0_30": Decimal("0.00"),
            "31_60": Decimal("0.00"),
            "61_90": Decimal("0.00"),
            "90_plus": Decimal("0.00"),
        }
        total_outstanding = Decimal("0.00")

        for inv in qs:
            paid = get_invoice_allocated_total(inv.id)
            out = get_invoice_outstanding(inv)
            if out <= 0:
                continue
            age_days = max(0, (today - inv.invoice_date).days)
            if age_days <= 30:
                bucket = "0-30 Days"
                buckets["0_30"] += out
            elif age_days <= 60:
                bucket = "31-60 Days"
                buckets["31_60"] += out
            elif age_days <= 90:
                bucket = "61-90 Days"
                buckets["61_90"] += out
            else:
                bucket = "90+ Days"
                buckets["90_plus"] += out
            total_outstanding += out
            invoices_data.append(
                {
                    "invoice_id": inv.id,
                    "invoice_number": inv.invoice_number,
                    "invoice_date": str(inv.invoice_date),
                    "customer_id": inv.customer_id,
                    "customer_name": inv.customer_name,
                    "customer_state": inv.customer_state,
                    "grand_total": str(inv.grand_total),
                    "paid_amount": str(paid),
                    "outstanding_amount": str(out),
                    "age_days": age_days,
                    "ageing_bucket": bucket,
                }
            )

        return Response(
            {
                "total_outstanding": str(total_outstanding),
                "ageing_buckets": {k: str(v) for k, v in buckets.items()},
                "invoices": invoices_data,
            }
        )
