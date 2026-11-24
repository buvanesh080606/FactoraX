from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.db.models import DecimalField, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.accounts.models import CompanySetting, UserRole
from apps.accounts.services import log_audit, notify_event
from apps.inventory.models import MovementType, StockItemType
from apps.inventory.services import (
    InsufficientStockError,
    get_stock_balance,
    record_stock_movement,
)
from apps.masters.models import Customer, Product
from apps.sales.models import (
    CreditNote,
    Dispatch,
    DispatchItem,
    Invoice,
    InvoiceItem,
    OrderStatus,
    OrderStatusHistory,
    Payment,
    PaymentAllocation,
    PaymentStatus,
    SalesOrder,
    SalesOrderItem,
)

ZERO_MONEY = Decimal("0.00")
ZERO_QTY = Decimal("0.000")


def _q2(val: Decimal) -> Decimal:
    return Decimal(str(val)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _q3(val: Decimal) -> Decimal:
    return Decimal(str(val)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def _next_sequence(model_cls, field_name: str, prefix: str) -> str:
    last = (
        model_cls.objects.filter(**{f"{field_name}__startswith": prefix})
        .order_by(f"-{field_name}")
        .first()
    )
    seq = 1
    if last:
        raw = getattr(last, field_name)
        try:
            seq = int(raw.split("-")[-1]) + 1
        except ValueError:
            seq = model_cls.objects.count() + 1
    return f"{prefix}{seq:04d}"


def get_invoice_allocated_total(invoice_id: int) -> Decimal:
    agg = PaymentAllocation.objects.filter(invoice_id=invoice_id).aggregate(
        total=Coalesce(
            Sum("allocated_amount"),
            Value(ZERO_MONEY, output_field=DecimalField(max_digits=14, decimal_places=2)),
        )
    )
    return _q2(agg["total"])


def get_invoice_outstanding(invoice: Invoice) -> Decimal:
    allocated = get_invoice_allocated_total(invoice.id)
    outstanding = invoice.grand_total - allocated - invoice.credit_notes_total
    return _q2(max(ZERO_MONEY, outstanding))


def get_customer_outstanding(customer_id: int) -> Decimal:
    inv_total = Invoice.objects.filter(customer_id=customer_id).aggregate(
        total=Coalesce(
            Sum("grand_total"),
            Value(ZERO_MONEY, output_field=DecimalField(max_digits=14, decimal_places=2)),
        ),
        credits=Coalesce(
            Sum("credit_notes_total"),
            Value(ZERO_MONEY, output_field=DecimalField(max_digits=14, decimal_places=2)),
        ),
    )
    alloc_total = PaymentAllocation.objects.filter(
        invoice__customer_id=customer_id
    ).aggregate(
        total=Coalesce(
            Sum("allocated_amount"),
            Value(ZERO_MONEY, output_field=DecimalField(max_digits=14, decimal_places=2)),
        )
    )
    return _q2(max(ZERO_MONEY, inv_total["total"] - alloc_total["total"] - inv_total["credits"]))


def get_bulk_customer_outstanding() -> dict[int, Decimal]:
    inv_rows = (
        Invoice.objects.values("customer_id")
        .annotate(
            billed=Coalesce(
                Sum("grand_total"),
                Value(ZERO_MONEY, output_field=DecimalField(max_digits=14, decimal_places=2)),
            ),
            credits=Coalesce(
                Sum("credit_notes_total"),
                Value(ZERO_MONEY, output_field=DecimalField(max_digits=14, decimal_places=2)),
            ),
        )
    )
    alloc_rows = (
        PaymentAllocation.objects.values("invoice__customer_id")
        .annotate(
            paid=Coalesce(
                Sum("allocated_amount"),
                Value(ZERO_MONEY, output_field=DecimalField(max_digits=14, decimal_places=2)),
            )
        )
    )
    paid_map = {r["invoice__customer_id"]: Decimal(r["paid"]) for r in alloc_rows}
    out = {}
    for r in inv_rows:
        cid = r["customer_id"]
        bal = Decimal(r["billed"]) - paid_map.get(cid, ZERO_MONEY) - Decimal(r["credits"])
        out[cid] = _q2(max(ZERO_MONEY, bal))
    return out


def check_order_stock(order: SalesOrder) -> dict:
    lines = []
    all_sufficient = True
    for item in order.items.select_related("product", "product__unit").all():
        avail = get_stock_balance(StockItemType.FINISHED, item.product_id)
        shortage = max(ZERO_QTY, item.quantity - avail)
        if shortage > 0:
            all_sufficient = False
        lines.append(
            {
                "order_item_id": item.id,
                "product_id": item.product_id,
                "product_name": f"{item.product.name} ({item.product.pack_size})",
                "unit_symbol": item.product.unit.symbol,
                "ordered_qty": str(item.quantity),
                "available_stock": str(avail),
                "shortage_qty": str(_q3(shortage)),
                "is_sufficient": shortage == 0,
            }
        )
    return {
        "order_id": order.id,
        "order_number": order.order_number,
        "is_sufficient": all_sufficient,
        "items": lines,
    }


@transaction.atomic
def create_sales_order(
    *,
    customer: Customer,
    salesman,
    items_data: list[dict],
    delivery_notes: str = "",
    order_date=None,
    idempotency_key: str | None = None,
    request=None,
) -> tuple[SalesOrder, bool]:
    """Creates a sales order with idempotency support (returns (order, created))."""
    if idempotency_key:
        existing = SalesOrder.objects.filter(idempotency_key=idempotency_key).first()
        if existing:
            return existing, False

    if not items_data:
        raise ValueError("Order must contain at least one product.")

    today_str = timezone.localdate().strftime("%Y%m%d")
    order_number = _next_sequence(SalesOrder, "order_number", f"ORD-{today_str}-")

    order = SalesOrder.objects.create(
        order_number=order_number,
        idempotency_key=idempotency_key or None,
        customer=customer,
        salesman=salesman,
        order_date=order_date or timezone.localdate(),
        status=OrderStatus.PENDING_APPROVAL,
        delivery_notes=delivery_notes,
    )

    subtotal = ZERO_MONEY
    tax_total = ZERO_MONEY
    for row in items_data:
        product = (
            row["product"]
            if isinstance(row["product"], Product)
            else Product.objects.get(pk=row["product"])
        )
        qty = _q3(row["quantity"])
        if qty <= 0:
            raise ValueError("Quantity must be greater than zero.")
        unit_price = _q2(row.get("unit_price") or product.selling_price)
        gst_rate = _q2(product.gst_rate)
        taxable = _q2(qty * unit_price)
        gst_amt = _q2((taxable * gst_rate) / Decimal("100"))
        line_total = _q2(taxable + gst_amt)

        SalesOrderItem.objects.create(
            order=order,
            product=product,
            quantity=qty,
            unit_price=unit_price,
            gst_rate=gst_rate,
            taxable_amount=taxable,
            gst_amount=gst_amt,
            line_total=line_total,
        )
        subtotal += taxable
        tax_total += gst_amt

    order.subtotal = _q2(subtotal)
    order.tax_estimate = _q2(tax_total)
    order.grand_total = _q2(subtotal + tax_total)
    order.save(update_fields=["subtotal", "tax_estimate", "grand_total"])

    OrderStatusHistory.objects.create(
        order=order,
        from_status=OrderStatus.SUBMITTED,
        to_status=OrderStatus.PENDING_APPROVAL,
        changed_by=salesman,
        remarks="Order submitted by salesman.",
    )

    log_audit(
        user=salesman,
        action="CREATE_SALES_ORDER",
        entity_type="SalesOrder",
        entity_id=order.id,
        summary=f"Order {order.order_number} placed for {customer.name} (Total Rs.{order.grand_total}).",
        request=request,
    )
    notify_event(
        event_type="ORDER_SUBMITTED",
        title=f"New Order: {order.order_number}",
        message=f"{salesman.full_name} placed an order for {customer.name} worth Rs.{order.grand_total}.",
        target_roles=[UserRole.ADMIN, UserRole.OWNER],
        entity_type="SalesOrder",
        entity_id=order.id,
    )
    return order, True


@transaction.atomic
def approve_sales_order(order_id: int, user, remarks: str = "", request=None) -> SalesOrder:
    order = (
        SalesOrder.objects.select_for_update()
        .select_related("customer", "salesman")
        .prefetch_related("items", "items__product")
        .get(pk=order_id)
    )
    if order.status not in (OrderStatus.SUBMITTED, OrderStatus.PENDING_APPROVAL):
        raise ValueError(f"Cannot approve order in status {order.status}.")

    stock_check = check_order_stock(order)
    if not stock_check["is_sufficient"]:
        shortages = [
            f"{i['product_name']}: short by {i['shortage_qty']} {i['unit_symbol']} (available {i['available_stock']})"
            for i in stock_check["items"]
            if not i["is_sufficient"]
        ]
        raise InsufficientStockError(
            "Insufficient finished stock to approve order. " + "; ".join(shortages)
        )

    prev_status = order.status
    order.status = OrderStatus.APPROVED
    order.approved_by = user
    order.approved_at = timezone.now()
    order.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])

    OrderStatusHistory.objects.create(
        order=order,
        from_status=prev_status,
        to_status=OrderStatus.APPROVED,
        changed_by=user,
        remarks=remarks or "Stock verified and order approved.",
    )

    log_audit(
        user=user,
        action="APPROVE_SALES_ORDER",
        entity_type="SalesOrder",
        entity_id=order.id,
        summary=f"Approved {order.order_number} for {order.customer.name}.",
        request=request,
    )
    notify_event(
        event_type="ORDER_APPROVED",
        title=f"Order Approved: {order.order_number}",
        message=f"Your order for {order.customer.name} (Rs.{order.grand_total}) has been approved.",
        recipient=order.salesman,
        entity_type="SalesOrder",
        entity_id=order.id,
    )
    return order


@transaction.atomic
def reject_sales_order(order_id: int, user, reason: str, request=None) -> SalesOrder:
    if not (reason or "").strip():
        raise ValueError("Rejection reason is required.")
    order = (
        SalesOrder.objects.select_for_update()
        .select_related("customer", "salesman")
        .get(pk=order_id)
    )
    if order.status not in (OrderStatus.SUBMITTED, OrderStatus.PENDING_APPROVAL):
        raise ValueError(f"Cannot reject order in status {order.status}.")

    prev_status = order.status
    order.status = OrderStatus.REJECTED
    order.rejection_reason = reason.strip()
    order.approved_by = user
    order.approved_at = timezone.now()
    order.save(
        update_fields=["status", "rejection_reason", "approved_by", "approved_at", "updated_at"]
    )

    OrderStatusHistory.objects.create(
        order=order,
        from_status=prev_status,
        to_status=OrderStatus.REJECTED,
        changed_by=user,
        remarks=order.rejection_reason,
    )
    log_audit(
        user=user,
        action="REJECT_SALES_ORDER",
        entity_type="SalesOrder",
        entity_id=order.id,
        summary=f"Rejected {order.order_number}: {order.rejection_reason}",
        request=request,
    )
    notify_event(
        event_type="ORDER_REJECTED",
        title=f"Order Rejected: {order.order_number}",
        message=f"Order for {order.customer.name} was rejected: {order.rejection_reason}",
        recipient=order.salesman,
        entity_type="SalesOrder",
        entity_id=order.id,
    )
    return order


@transaction.atomic
def generate_gst_invoice(order_id: int, user, invoice_date=None, request=None) -> Invoice:
    order = (
        SalesOrder.objects.select_for_update()
        .select_related("customer", "salesman")
        .prefetch_related("items", "items__product")
        .get(pk=order_id)
    )
    if hasattr(order, "invoice"):
        raise ValueError(f"Invoice {order.invoice.invoice_number} already exists for this order.")
    if order.status != OrderStatus.APPROVED:
        raise ValueError("Only APPROVED orders can be invoiced.")

    company = CompanySetting.get_solo()
    fy = company.financial_year
    prefix = f"{company.invoice_prefix}/{fy}/"
    last_inv = (
        Invoice.objects.filter(invoice_number__startswith=prefix)
        .order_by("-invoice_number")
        .first()
    )
    seq = 1
    if last_inv:
        try:
            seq = int(last_inv.invoice_number.split("/")[-1]) + 1
        except ValueError:
            seq = Invoice.objects.count() + 1
    invoice_number = f"{prefix}{seq:04d}"

    is_inter_state = (
        company.state.strip().lower() != order.customer.state.strip().lower()
    )

    taxable_total = ZERO_MONEY
    cgst_total = ZERO_MONEY
    sgst_total = ZERO_MONEY
    igst_total = ZERO_MONEY
    prepared_items = []

    for oitem in order.items.all():
        taxable = _q2(oitem.quantity * oitem.unit_price)
        rate = _q2(oitem.gst_rate)
        if is_inter_state:
            cgst = ZERO_MONEY
            sgst = ZERO_MONEY
            igst = _q2((taxable * rate) / Decimal("100"))
        else:
            half_rate = rate / Decimal("2")
            cgst = _q2((taxable * half_rate) / Decimal("100"))
            sgst = _q2((taxable * half_rate) / Decimal("100"))
            igst = ZERO_MONEY
        line_total = _q2(taxable + cgst + sgst + igst)

        taxable_total += taxable
        cgst_total += cgst
        sgst_total += sgst
        igst_total += igst
        prepared_items.append(
            {
                "product": oitem.product,
                "product_name": f"{oitem.product.name} ({oitem.product.pack_size})",
                "hsn_code": oitem.product.hsn_code,
                "quantity": oitem.quantity,
                "unit_price": oitem.unit_price,
                "taxable_amount": taxable,
                "gst_rate": rate,
                "cgst_amount": cgst,
                "sgst_amount": sgst,
                "igst_amount": igst,
                "line_total": line_total,
            }
        )

    grand_total = _q2(taxable_total + cgst_total + sgst_total + igst_total)

    invoice = Invoice.objects.create(
        invoice_number=invoice_number,
        financial_year=fy,
        invoice_date=invoice_date or timezone.localdate(),
        order=order,
        customer=order.customer,
        seller_name=company.company_name,
        seller_gstin=company.gstin,
        seller_state=company.state,
        seller_address=company.address,
        customer_name=order.customer.name,
        customer_gstin=order.customer.gstin,
        customer_state=order.customer.state,
        customer_address=order.customer.address,
        is_inter_state=is_inter_state,
        taxable_total=_q2(taxable_total),
        cgst_total=_q2(cgst_total),
        sgst_total=_q2(sgst_total),
        igst_total=_q2(igst_total),
        grand_total=grand_total,
        created_by=user,
    )

    for p in prepared_items:
        InvoiceItem.objects.create(invoice=invoice, **p)

    order.status = OrderStatus.INVOICED
    order.save(update_fields=["status", "updated_at"])
    OrderStatusHistory.objects.create(
        order=order,
        from_status=OrderStatus.APPROVED,
        to_status=OrderStatus.INVOICED,
        changed_by=user,
        remarks=f"Generated GST Invoice {invoice.invoice_number} ({'IGST' if is_inter_state else 'CGST+SGST'}).",
    )

    log_audit(
        user=user,
        action="GENERATE_INVOICE",
        entity_type="Invoice",
        entity_id=invoice.id,
        summary=f"Generated {invoice.invoice_number} for {invoice.customer_name} (Total Rs.{invoice.grand_total}).",
        request=request,
    )
    notify_event(
        event_type="INVOICE_GENERATED",
        title=f"Invoice Ready: {invoice.invoice_number}",
        message=f"GST Invoice {invoice.invoice_number} for {invoice.customer_name} (Rs.{invoice.grand_total}) generated.",
        recipient=order.salesman,
        target_roles=[UserRole.OWNER, UserRole.ACCOUNTANT],
        entity_type="Invoice",
        entity_id=invoice.id,
    )
    return invoice


def get_invoice_dispatched_qty_map(invoice_id: int) -> dict[int, Decimal]:
    rows = (
        DispatchItem.objects.filter(dispatch__invoice_id=invoice_id)
        .values("invoice_item_id")
        .annotate(
            total=Coalesce(
                Sum("dispatched_qty"),
                Value(ZERO_QTY, output_field=DecimalField(max_digits=12, decimal_places=3)),
            )
        )
    )
    return {r["invoice_item_id"]: _q3(r["total"]) for r in rows}


@transaction.atomic
def create_dispatch(
    *,
    invoice_id: int,
    user,
    items_input: list[dict] | None = None,
    dispatch_date=None,
    vehicle_no: str = "",
    transporter: str = "",
    notes: str = "",
    request=None,
) -> Dispatch:
    """
    Atomically dispatches goods against an invoice:
    - Locks the Invoice row to prevent duplicate concurrent dispatches.
    - Supports full dispatch (default when items_input omitted) or partial dispatch.
    - Blocks over-dispatch and duplicate dispatch.
    - Deducts finished goods from StockLedger exactly once.
    """
    invoice = (
        Invoice.objects.select_for_update()
        .select_related("order", "order__salesman", "customer")
        .prefetch_related("items", "items__product")
        .get(pk=invoice_id)
    )
    inv_items = {ii.id: ii for ii in invoice.items.all()}
    already_dispatched = get_invoice_dispatched_qty_map(invoice.id)

    # Determine dispatch quantities
    to_dispatch = []
    if not items_input:
        for ii in inv_items.values():
            remaining = _q3(ii.quantity - already_dispatched.get(ii.id, ZERO_QTY))
            if remaining > 0:
                to_dispatch.append((ii, remaining))
        if not to_dispatch:
            raise ValueError(
                f"Invoice {invoice.invoice_number} is already fully dispatched. Duplicate dispatch is not allowed."
            )
    else:
        for row in items_input:
            ii_id = row["invoice_item"]
            if ii_id not in inv_items:
                raise ValueError(f"Invoice item {ii_id} does not belong to invoice {invoice.invoice_number}.")
            ii = inv_items[ii_id]
            qty = _q3(row["dispatched_qty"])
            if qty <= 0:
                raise ValueError("Dispatched quantity must be greater than zero.")
            remaining = _q3(ii.quantity - already_dispatched.get(ii.id, ZERO_QTY))
            if qty > remaining:
                raise ValueError(
                    f"Cannot dispatch {qty} of {ii.product_name}: only {remaining} remaining on {invoice.invoice_number}."
                )
            to_dispatch.append((ii, qty))

    today_str = timezone.localdate().strftime("%Y%m%d")
    dispatch_number = _next_sequence(Dispatch, "dispatch_number", f"DSP-{today_str}-")

    dispatch = Dispatch.objects.create(
        dispatch_number=dispatch_number,
        invoice=invoice,
        order=invoice.order,
        dispatch_date=dispatch_date or timezone.localdate(),
        vehicle_no=vehicle_no,
        transporter=transporter,
        notes=notes,
        dispatched_by=user,
    )

    for ii, qty in to_dispatch:
        DispatchItem.objects.create(
            dispatch=dispatch,
            invoice_item=ii,
            product=ii.product,
            dispatched_qty=qty,
        )
        record_stock_movement(
            item_type=StockItemType.FINISHED,
            item_id=ii.product_id,
            movement_type=MovementType.SALES_DISPATCH,
            quantity_delta=-qty,
            unit_cost=ii.unit_price,
            source_type="DISPATCH",
            source_id=str(dispatch.id),
            reference_no=dispatch.dispatch_number,
            notes=f"Dispatched against {invoice.invoice_number} for {invoice.customer_name}",
            user=user,
        )

    # Check if invoice is now fully dispatched
    updated_dispatched = get_invoice_dispatched_qty_map(invoice.id)
    fully_dispatched = all(
        updated_dispatched.get(ii.id, ZERO_QTY) >= ii.quantity
        for ii in inv_items.values()
    )
    if fully_dispatched and invoice.order.status != OrderStatus.DISPATCHED:
        prev = invoice.order.status
        invoice.order.status = OrderStatus.DISPATCHED
        invoice.order.save(update_fields=["status", "updated_at"])
        OrderStatusHistory.objects.create(
            order=invoice.order,
            from_status=prev,
            to_status=OrderStatus.DISPATCHED,
            changed_by=user,
            remarks=f"Dispatched via {dispatch.dispatch_number}.",
        )

    log_audit(
        user=user,
        action="CREATE_DISPATCH",
        entity_type="Dispatch",
        entity_id=dispatch.id,
        summary=f"Dispatched {dispatch.dispatch_number} for {invoice.invoice_number} ({invoice.customer_name}).",
        request=request,
    )
    notify_event(
        event_type="ORDER_DISPATCHED",
        title=f"Order Dispatched: {dispatch.dispatch_number}",
        message=f"Invoice {invoice.invoice_number} for {invoice.customer_name} has been dispatched.",
        recipient=invoice.order.salesman,
        target_roles=[UserRole.OWNER, UserRole.ACCOUNTANT],
        entity_type="Dispatch",
        entity_id=dispatch.id,
    )
    return dispatch


@transaction.atomic
def record_payment(
    *,
    customer: Customer,
    amount: Decimal,
    payment_mode: str,
    payment_date=None,
    reference_number: str = "",
    notes: str = "",
    payment_status: str | None = None,
    pending_amount: Decimal | None = None,
    allocations_input: list[dict] | None = None,
    invoice_id: int | None = None,
    idempotency_key: str | None = None,
    user=None,
    request=None,
) -> tuple[Payment, bool]:
    """
    Records a payment with idempotency protection and allocates it against one or more customer invoices.
    Prevents over-allocation beyond invoice outstanding or payment amount.
    """
    if idempotency_key:
        existing = Payment.objects.filter(idempotency_key=idempotency_key).first()
        if existing:
            return existing, False

    amount = _q2(amount)
    if amount <= 0:
        raise ValueError("Payment amount must be greater than zero.")

    today_str = timezone.localdate().strftime("%Y%m%d")
    payment_number = _next_sequence(Payment, "payment_number", f"PAY-{today_str}-")

    payment = Payment.objects.create(
        payment_number=payment_number,
        idempotency_key=idempotency_key or None,
        customer=customer,
        payment_date=payment_date or timezone.localdate(),
        amount=amount,
        payment_mode=payment_mode,
        reference_number=reference_number,
        notes=notes,
        recorded_by=user,
    )

    alloc_rows = list(allocations_input or [])
    if invoice_id and not alloc_rows:
        alloc_rows = [{"invoice": invoice_id, "allocated_amount": amount}]

    # If no explicit allocation provided, auto-allocate FIFO across customer's unpaid invoices
    if not alloc_rows:
        remaining_pay = amount
        for inv in Invoice.objects.select_for_update().filter(customer=customer).order_by("invoice_date", "id"):
            if remaining_pay <= 0:
                break
            out = get_invoice_outstanding(inv)
            if out > 0:
                take = min(remaining_pay, out)
                PaymentAllocation.objects.create(
                    payment=payment,
                    invoice=inv,
                    allocated_amount=_q2(take),
                )
                remaining_pay = _q2(remaining_pay - take)
    else:
        total_alloc = ZERO_MONEY
        for row in alloc_rows:
            inv = Invoice.objects.select_for_update().get(pk=row["invoice"])
            if inv.customer_id != customer.id:
                raise ValueError(f"Invoice {inv.invoice_number} does not belong to {customer.name}.")
            alloc_amt = _q2(row["allocated_amount"])
            if alloc_amt <= 0:
                raise ValueError("Allocated amount must be greater than zero.")
            outstanding = get_invoice_outstanding(inv)
            if alloc_amt > outstanding:
                raise ValueError(
                    f"Allocation Rs.{alloc_amt} exceeds outstanding Rs.{outstanding} on {inv.invoice_number}."
                )
            total_alloc = _q2(total_alloc + alloc_amt)
            if total_alloc > amount:
                raise ValueError("Total allocated amount cannot exceed payment amount.")
            PaymentAllocation.objects.create(
                payment=payment,
                invoice=inv,
                allocated_amount=alloc_amt,
            )

    # Compute/persist explicit pending status & pending amount
    if payment_status == PaymentStatus.PENDING_DUE:
        pend = _q2(pending_amount if pending_amount is not None else get_customer_outstanding(customer.id))
        payment.payment_status = PaymentStatus.PENDING_DUE if pend > 0 else PaymentStatus.NO_PENDING_DUE
        payment.pending_amount = max(ZERO_MONEY, pend)
    elif payment_status == PaymentStatus.NO_PENDING_DUE:
        payment.payment_status = PaymentStatus.NO_PENDING_DUE
        payment.pending_amount = ZERO_MONEY
    else:
        rem = get_customer_outstanding(customer.id)
        payment.payment_status = PaymentStatus.PENDING_DUE if rem > 0 else PaymentStatus.NO_PENDING_DUE
        payment.pending_amount = rem
    payment.save(update_fields=["payment_status", "pending_amount"])

    log_audit(
        user=user,
        action="RECORD_PAYMENT",
        entity_type="Payment",
        entity_id=payment.id,
        summary=f"Recorded {payment.payment_number} of Rs.{payment.amount} ({payment.payment_mode}) from {customer.name}.",
        request=request,
    )
    notify_event(
        event_type="PAYMENT_RECORDED",
        title=f"Payment Received: {payment.payment_number}",
        message=f"Rs.{payment.amount} received from {customer.name} via {payment.payment_mode}.",
        target_roles=[UserRole.ADMIN, UserRole.OWNER, UserRole.ACCOUNTANT],
        entity_type="Payment",
        entity_id=payment.id,
    )
    return payment, True


@transaction.atomic
def update_pending_order(
    *,
    order_id: int,
    user,
    items_data: list[dict] | None = None,
    delivery_notes: str | None = None,
    request=None,
) -> SalesOrder:
    """
    Allows Factory Admin / Owner to edit quantities, unit prices, or delivery notes
    on a pending order prior to approval, with full audit logging.
    """
    order = (
        SalesOrder.objects.select_for_update()
        .select_related("customer", "salesman")
        .prefetch_related("items", "items__product")
        .get(pk=order_id)
    )
    if order.status not in (OrderStatus.SUBMITTED, OrderStatus.PENDING_APPROVAL):
        raise ValueError(f"Only pending orders can be edited (current status: {order.status}).")

    old_total = order.grand_total
    if delivery_notes is not None:
        order.delivery_notes = delivery_notes

    if items_data is not None:
        if not items_data:
            raise ValueError("Order must retain at least one item.")
        order.items.all().delete()
        subtotal = ZERO_MONEY
        tax_total = ZERO_MONEY
        for row in items_data:
            product = (
                row["product"]
                if isinstance(row["product"], Product)
                else Product.objects.get(pk=row["product"])
            )
            qty = _q3(row["quantity"])
            if qty <= 0:
                raise ValueError("Quantity must be greater than zero.")
            unit_price = _q2(row.get("unit_price") if row.get("unit_price") is not None else product.selling_price)
            if unit_price < 0:
                raise ValueError("Unit price cannot be negative.")
            gst_rate = _q2(product.gst_rate)
            taxable = _q2(qty * unit_price)
            gst_amt = _q2((taxable * gst_rate) / Decimal("100"))
            line_total = _q2(taxable + gst_amt)
            SalesOrderItem.objects.create(
                order=order,
                product=product,
                quantity=qty,
                unit_price=unit_price,
                gst_rate=gst_rate,
                taxable_amount=taxable,
                gst_amount=gst_amt,
                line_total=line_total,
            )
            subtotal += taxable
            tax_total += gst_amt
        order.subtotal = _q2(subtotal)
        order.tax_estimate = _q2(tax_total)
        order.grand_total = _q2(subtotal + tax_total)

    order.save(update_fields=["delivery_notes", "subtotal", "tax_estimate", "grand_total", "updated_at"])
    OrderStatusHistory.objects.create(
        order=order,
        from_status=order.status,
        to_status=order.status,
        changed_by=user,
        remarks=f"Order edited by {user.full_name} (Total: Rs.{old_total} -> Rs.{order.grand_total}).",
    )
    log_audit(
        user=user,
        action="EDIT_SALES_ORDER",
        entity_type="SalesOrder",
        entity_id=order.id,
        summary=f"Edited pending order {order.order_number}: Rs.{old_total} -> Rs.{order.grand_total}.",
        request=request,
    )
    return order


@transaction.atomic
def issue_credit_note(
    *,
    invoice_id: int,
    user,
    amount: Decimal,
    reason: str,
    restock_finished_goods: bool = False,
    request=None,
) -> CreditNote:
    """
    Cancels or adjusts a posted GST invoice via an audit-safe CreditNote (never deletes posted invoices).
    Updates Invoice.credit_notes_total, optionally restocks returned finished goods into StockLedger,
    and writes an AuditLog entry.
    """
    if not (reason or "").strip():
        raise ValueError("Reason for credit note is required.")

    invoice = (
        Invoice.objects.select_for_update()
        .select_related("order", "customer")
        .prefetch_related("items", "items__product")
        .get(pk=invoice_id)
    )
    credit_amt = _q2(amount)
    if credit_amt <= 0:
        raise ValueError("Credit note amount must be greater than zero.")

    max_creditable = _q2(invoice.grand_total - invoice.credit_notes_total)
    if credit_amt > max_creditable:
        raise ValueError(
            f"Credit amount Rs.{credit_amt} exceeds remaining creditable invoice total Rs.{max_creditable}."
        )

    company = CompanySetting.get_solo()
    prefix = f"CN/{company.financial_year}/"
    last_cn = (
        CreditNote.objects.filter(credit_note_number__startswith=prefix)
        .order_by("-credit_note_number")
        .first()
    )
    seq = 1
    if last_cn:
        try:
            seq = int(last_cn.credit_note_number.split("/")[-1]) + 1
        except ValueError:
            seq = CreditNote.objects.count() + 1
    cn_number = f"{prefix}{seq:04d}"

    cn = CreditNote.objects.create(
        credit_note_number=cn_number,
        invoice=invoice,
        amount=credit_amt,
        reason=reason.strip(),
        restock_finished_goods=restock_finished_goods,
        created_by=user,
    )

    invoice.credit_notes_total = _q2(invoice.credit_notes_total + credit_amt)
    invoice.save(update_fields=["credit_notes_total"])

    if restock_finished_goods:
        dispatched_map = get_invoice_dispatched_qty_map(invoice.id)
        for ii in invoice.items.all():
            disp_qty = dispatched_map.get(ii.id, ZERO_QTY)
            if disp_qty > 0:
                record_stock_movement(
                    item_type=StockItemType.FINISHED,
                    item_id=ii.product_id,
                    movement_type=MovementType.RETURN,
                    quantity_delta=disp_qty,
                    unit_cost=ii.unit_price,
                    source_type="CREDIT_NOTE",
                    source_id=str(cn.id),
                    reference_no=cn.credit_note_number,
                    notes=f"Return restock via {cn.credit_note_number} for {invoice.invoice_number}",
                    user=user,
                )

    log_audit(
        user=user,
        action="ISSUE_CREDIT_NOTE",
        entity_type="CreditNote",
        entity_id=cn.id,
        summary=f"Issued {cn.credit_note_number} (Rs.{cn.amount}) against {invoice.invoice_number}: {cn.reason}",
        request=request,
    )
    notify_event(
        event_type="CREDIT_NOTE_ISSUED",
        title=f"Credit Note Issued: {cn.credit_note_number}",
        message=f"Rs.{cn.amount} credited against {invoice.invoice_number} ({invoice.customer_name}).",
        target_roles=[UserRole.ACCOUNTANT, UserRole.OWNER],
        entity_type="CreditNote",
        entity_id=cn.id,
    )
    return cn


@transaction.atomic
def update_payment(
    *,
    payment_id: int,
    user,
    amount: Decimal | None = None,
    payment_mode: str | None = None,
    payment_date=None,
    reference_number: str | None = None,
    notes: str | None = None,
    payment_status: str | None = None,
    pending_amount: Decimal | None = None,
    invoice_id: int | None = None,
    request=None,
) -> Payment:
    payment = (
        Payment.objects.select_for_update()
        .select_related("customer")
        .prefetch_related("allocations", "allocations__invoice")
        .get(pk=payment_id)
    )
    old_amount = payment.amount
    new_amount = _q2(amount) if amount is not None else payment.amount
    if new_amount <= 0:
        raise ValueError("Payment amount must be greater than zero.")

    if payment_mode is not None:
        payment.payment_mode = payment_mode
    if payment_date is not None:
        payment.payment_date = payment_date
    if reference_number is not None:
        payment.reference_number = reference_number
    if notes is not None:
        payment.notes = notes
    payment.amount = new_amount

    # Re-allocate if amount or target invoice changed
    if amount is not None or invoice_id is not None:
        existing_allocs = list(payment.allocations.all())
        target_inv_id = invoice_id or (existing_allocs[0].invoice_id if existing_allocs else None)
        payment.allocations.all().delete()
        if target_inv_id:
            inv = Invoice.objects.select_for_update().get(pk=target_inv_id)
            if inv.customer_id != payment.customer_id:
                raise ValueError("Selected invoice does not belong to this customer.")
            outstanding = get_invoice_outstanding(inv)
            if new_amount > outstanding:
                raise ValueError(
                    f"Amount Rs.{new_amount} exceeds remaining outstanding Rs.{outstanding} on {inv.invoice_number}."
                )
            PaymentAllocation.objects.create(
                payment=payment, invoice=inv, allocated_amount=new_amount
            )

    if payment_status == PaymentStatus.PENDING_DUE:
        pend = _q2(pending_amount if pending_amount is not None else payment.pending_amount)
        payment.payment_status = PaymentStatus.PENDING_DUE if pend > 0 else PaymentStatus.NO_PENDING_DUE
        payment.pending_amount = max(ZERO_MONEY, pend)
    elif payment_status == PaymentStatus.NO_PENDING_DUE:
        payment.payment_status = PaymentStatus.NO_PENDING_DUE
        payment.pending_amount = ZERO_MONEY

    payment.save()
    log_audit(
        user=user,
        action="EDIT_PAYMENT",
        entity_type="Payment",
        entity_id=payment.id,
        summary=f"Edited {payment.payment_number} ({payment.customer.name}): Rs.{old_amount} -> Rs.{payment.amount} ({payment.payment_mode}).",
        request=request,
    )
    return payment


@transaction.atomic
def delete_payment(*, payment_id: int, user, request=None) -> dict:
    payment = (
        Payment.objects.select_for_update()
        .select_related("customer")
        .get(pk=payment_id)
    )
    info = {
        "id": payment.id,
        "payment_number": payment.payment_number,
        "customer_name": payment.customer.name,
        "amount": str(payment.amount),
    }
    payment.delete()
    log_audit(
        user=user,
        action="DELETE_PAYMENT",
        entity_type="Payment",
        entity_id=info["id"],
        summary=f"Removed payment {info['payment_number']} (Rs.{info['amount']}) for {info['customer_name']}.",
        request=request,
    )
    return info
