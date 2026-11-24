from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import UserRole
from apps.accounts.services import log_audit, notify_event
from apps.inventory.models import MovementType, StockItemType
from apps.inventory.services import record_stock_movement
from apps.masters.models import MaterialType
from apps.purchases.models import Purchase, PurchaseStatus


def generate_purchase_number() -> str:
    today = timezone.localdate().strftime("%Y%m%d")
    prefix = f"PO-{today}-"
    last = (
        Purchase.objects.filter(purchase_number__startswith=prefix)
        .order_by("-purchase_number")
        .first()
    )
    seq = 1
    if last:
        try:
            seq = int(last.purchase_number.split("-")[-1]) + 1
        except ValueError:
            seq = Purchase.objects.count() + 1
    return f"{prefix}{seq:04d}"


@transaction.atomic
def confirm_purchase(purchase_id: int, user, request=None) -> Purchase:
    purchase = (
        Purchase.objects.select_for_update()
        .prefetch_related("items")
        .select_related("supplier")
        .get(pk=purchase_id)
    )
    if purchase.status == PurchaseStatus.CONFIRMED:
        raise ValueError("Purchase is already confirmed.")
    if purchase.status == PurchaseStatus.CANCELLED:
        raise ValueError("Cancelled purchase cannot be confirmed.")
    items = list(purchase.items.all())
    if not items:
        raise ValueError("Purchase must have at least one line item.")

    total = Decimal("0.00")
    for item in items:
        line_total = (item.quantity * item.unit_rate).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        if item.line_total != line_total:
            item.line_total = line_total
            item.save(update_fields=["line_total"])
        total += line_total

        if item.material_type == MaterialType.RAW:
            item_type = StockItemType.RAW
            item_id = item.raw_material_id
        else:
            item_type = StockItemType.PACKAGING
            item_id = item.packaging_material_id

        record_stock_movement(
            item_type=item_type,
            item_id=item_id,
            movement_type=MovementType.PURCHASE_RECEIPT,
            quantity_delta=item.quantity,
            unit_cost=item.unit_rate,
            source_type="PURCHASE",
            source_id=str(purchase.id),
            reference_no=purchase.purchase_number,
            notes=f"Purchase receipt from {purchase.supplier.name} (Ref: {purchase.invoice_ref or purchase.purchase_number})",
            user=user,
        )

    purchase.total_amount = total
    purchase.status = PurchaseStatus.CONFIRMED
    purchase.confirmed_by = user
    purchase.confirmed_at = timezone.now()
    purchase.save(
        update_fields=["total_amount", "status", "confirmed_by", "confirmed_at", "updated_at"]
    )

    log_audit(
        user=user,
        action="CONFIRM_PURCHASE",
        entity_type="Purchase",
        entity_id=purchase.id,
        summary=f"Confirmed purchase {purchase.purchase_number} from {purchase.supplier.name} for Rs.{purchase.total_amount}.",
        request=request,
    )
    notify_event(
        event_type="PURCHASE_CONFIRMED",
        title=f"Purchase Received: {purchase.purchase_number}",
        message=f"Stock received from {purchase.supplier.name} (Rs.{purchase.total_amount}).",
        target_roles=[UserRole.PRODUCTION, UserRole.OWNER],
        entity_type="Purchase",
        entity_id=purchase.id,
    )
    return purchase
