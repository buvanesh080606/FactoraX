from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from django.db import transaction
from django.db.models import Case, DecimalField, F, Sum, Value, When
from django.db.models.functions import Coalesce

from apps.accounts.models import UserRole
from apps.accounts.services import notify_event
from apps.inventory.models import MovementType, StockItemType, StockLedger
from apps.masters.models import PackagingMaterial, Product, RawMaterial

ZERO_QTY = Decimal("0.000")
ZERO_MONEY = Decimal("0.00")
ZERO_COST = Decimal("0.0000")


class InsufficientStockError(ValueError):
    """Raised when an outward stock movement would create invalid negative inventory."""


def _item_fk_field(item_type: str) -> str:
    if item_type == StockItemType.RAW:
        return "raw_material"
    if item_type == StockItemType.PACKAGING:
        return "packaging_material"
    if item_type == StockItemType.FINISHED:
        return "product"
    raise ValueError(f"Unsupported item_type: {item_type}")


def _item_model(item_type: str):
    if item_type == StockItemType.RAW:
        return RawMaterial
    if item_type == StockItemType.PACKAGING:
        return PackagingMaterial
    if item_type == StockItemType.FINISHED:
        return Product
    raise ValueError(f"Unsupported item_type: {item_type}")


def get_stock_balance(item_type: str, item_id: int) -> Decimal:
    fk = _item_fk_field(item_type)
    agg = StockLedger.objects.filter(
        item_type=item_type, **{f"{fk}_id": item_id}
    ).aggregate(
        total=Coalesce(
            Sum("quantity_delta"),
            Value(ZERO_QTY, output_field=DecimalField(max_digits=14, decimal_places=3)),
        )
    )
    return Decimal(agg["total"]).quantize(Decimal("0.001"))


def get_bulk_stock_balances(item_type: str) -> dict[int, Decimal]:
    fk_id = f"{_item_fk_field(item_type)}_id"
    rows = (
        StockLedger.objects.filter(item_type=item_type)
        .values(fk_id)
        .annotate(
            total=Coalesce(
                Sum("quantity_delta"),
                Value(ZERO_QTY, output_field=DecimalField(max_digits=14, decimal_places=3)),
            )
        )
    )
    return {
        row[fk_id]: Decimal(row["total"]).quantize(Decimal("0.001"))
        for row in rows
        if row[fk_id] is not None
    }


@transaction.atomic
def record_stock_movement(
    *,
    item_type: str,
    item_id: int,
    movement_type: str,
    quantity_delta: Decimal,
    unit_cost: Optional[Decimal] = None,
    source_type: str,
    source_id: str = "",
    reference_no: str = "",
    notes: str = "",
    user=None,
) -> StockLedger:
    """
    Atomically validates stock, locks the item row to prevent concurrent races,
    updates Moving Weighted Average Cost on inward receipts, and appends a StockLedger row.
    """
    qty_delta = Decimal(str(quantity_delta)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
    if qty_delta == 0:
        raise ValueError("Stock movement quantity_delta cannot be zero.")

    model_cls = _item_model(item_type)
    item = model_cls.objects.select_for_update().get(pk=item_id)

    current_balance = get_stock_balance(item_type, item_id)
    new_balance = (current_balance + qty_delta).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)

    if new_balance < 0:
        raise InsufficientStockError(
            f"Insufficient stock for {item.name}: available {current_balance}, requested issue {abs(qty_delta)}."
        )

    # Moving Weighted Average valuation for raw & packaging materials on inward receipts
    if item_type in (StockItemType.RAW, StockItemType.PACKAGING):
        if unit_cost is None:
            effective_cost = item.weighted_avg_cost
        else:
            effective_cost = Decimal(str(unit_cost)).quantize(
                Decimal("0.0001"), rounding=ROUND_HALF_UP
            )
        if qty_delta > 0 and movement_type in (
            MovementType.OPENING,
            MovementType.PURCHASE_RECEIPT,
        ):
            if new_balance > 0:
                total_existing_val = current_balance * item.weighted_avg_cost
                total_inward_val = qty_delta * effective_cost
                new_avg = ((total_existing_val + total_inward_val) / new_balance).quantize(
                    Decimal("0.0001"), rounding=ROUND_HALF_UP
                )
                item.weighted_avg_cost = new_avg
                item.save(update_fields=["weighted_avg_cost", "updated_at"])
    else:
        if unit_cost is None:
            effective_cost = item.selling_price
        else:
            effective_cost = Decimal(str(unit_cost)).quantize(
                Decimal("0.0001"), rounding=ROUND_HALF_UP
            )

    total_val = (abs(qty_delta) * effective_cost).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )

    fk_name = _item_fk_field(item_type)
    entry = StockLedger.objects.create(
        item_type=item_type,
        **{fk_name: item},
        movement_type=movement_type,
        quantity_delta=qty_delta,
        unit_cost=effective_cost,
        total_value=total_val,
        running_balance=new_balance,
        source_type=source_type,
        source_id=str(source_id or ""),
        reference_no=reference_no or "",
        notes=notes or "",
        created_by=user if (user and getattr(user, "is_authenticated", False)) else None,
    )

    # Emit low-stock alert when an outward movement crosses into reorder threshold
    if qty_delta < 0 and new_balance <= item.reorder_level:
        notify_event(
            event_type="LOW_STOCK_ALERT",
            title=f"Low Stock Alert: {item.name}",
            message=f"{item.name} stock is now {new_balance} {item.unit.symbol} (reorder level: {item.reorder_level}).",
            target_roles=[UserRole.ADMIN, UserRole.PRODUCTION, UserRole.OWNER],
            entity_type=item_type,
            entity_id=item.id,
        )

    return entry


def build_inventory_summary(item_type: Optional[str] = None) -> list[dict]:
    """
    Computes Opening, Receipts, Issues, Adjustments, and Closing Stock strictly from StockLedger.
    Formula: Closing = Opening + Receipts - Issues + Adjustments.
    """
    types = [item_type] if item_type else [
        StockItemType.RAW,
        StockItemType.PACKAGING,
        StockItemType.FINISHED,
    ]
    results = []

    for itype in types:
        fk_id = f"{_item_fk_field(itype)}_id"
        model_cls = _item_model(itype)
        items = list(model_cls.objects.select_related("unit").all())

        agg_rows = (
            StockLedger.objects.filter(item_type=itype)
            .values(fk_id)
            .annotate(
                opening=Coalesce(
                    Sum(
                        Case(
                            When(movement_type=MovementType.OPENING, then=F("quantity_delta")),
                            default=Value(ZERO_QTY),
                            output_field=DecimalField(max_digits=14, decimal_places=3),
                        )
                    ),
                    Value(ZERO_QTY, output_field=DecimalField(max_digits=14, decimal_places=3)),
                ),
                receipts=Coalesce(
                    Sum(
                        Case(
                            When(
                                movement_type__in=[
                                    MovementType.PURCHASE_RECEIPT,
                                    MovementType.PRODUCTION_OUTPUT,
                                    MovementType.RETURN,
                                ],
                                then=F("quantity_delta"),
                            ),
                            default=Value(ZERO_QTY),
                            output_field=DecimalField(max_digits=14, decimal_places=3),
                        )
                    ),
                    Value(ZERO_QTY, output_field=DecimalField(max_digits=14, decimal_places=3)),
                ),
                issues=Coalesce(
                    Sum(
                        Case(
                            When(
                                movement_type__in=[
                                    MovementType.PRODUCTION_ISSUE,
                                    MovementType.SALES_DISPATCH,
                                ],
                                then=-F("quantity_delta"),
                            ),
                            default=Value(ZERO_QTY),
                            output_field=DecimalField(max_digits=14, decimal_places=3),
                        )
                    ),
                    Value(ZERO_QTY, output_field=DecimalField(max_digits=14, decimal_places=3)),
                ),
                adjustments=Coalesce(
                    Sum(
                        Case(
                            When(movement_type=MovementType.ADJUSTMENT, then=F("quantity_delta")),
                            default=Value(ZERO_QTY),
                            output_field=DecimalField(max_digits=14, decimal_places=3),
                        )
                    ),
                    Value(ZERO_QTY, output_field=DecimalField(max_digits=14, decimal_places=3)),
                ),
            )
        )
        agg_map = {r[fk_id]: r for r in agg_rows if r[fk_id] is not None}

        # Latest finished unit cost from production runs (fallback to selling price for valuation display)
        finished_cost_map = {}
        if itype == StockItemType.FINISHED:
            from apps.production.models import ProductionRun

            for run in (
                ProductionRun.objects.filter(status="CONFIRMED")
                .order_by("product_id", "-confirmed_at")
                .distinct("product_id")
                if False
                else ProductionRun.objects.filter(status="CONFIRMED").order_by("-confirmed_at")
            ):
                if run.product_id not in finished_cost_map and run.cost_per_good_packet > 0:
                    finished_cost_map[run.product_id] = run.cost_per_good_packet

        for item in items:
            row = agg_map.get(item.id)
            opening = Decimal(row["opening"]) if row else ZERO_QTY
            receipts = Decimal(row["receipts"]) if row else ZERO_QTY
            issues = Decimal(row["issues"]) if row else ZERO_QTY
            adjustments = Decimal(row["adjustments"]) if row else ZERO_QTY
            closing = (opening + receipts - issues + adjustments).quantize(Decimal("0.001"))

            if itype == StockItemType.FINISHED:
                unit_val = finished_cost_map.get(item.id, item.selling_price)
                code = item.sku
                label = f"{item.name} ({item.pack_size})"
            else:
                unit_val = item.weighted_avg_cost
                code = item.code
                label = item.name

            stock_value = (closing * unit_val).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if closing <= 0:
                status_label = "OUT_OF_STOCK"
            elif closing <= item.reorder_level:
                status_label = "LOW_STOCK"
            else:
                status_label = "IN_STOCK"

            results.append(
                {
                    "item_type": itype,
                    "item_id": item.id,
                    "code": code,
                    "name": label,
                    "unit_symbol": item.unit.symbol,
                    "opening_stock": str(opening.quantize(Decimal("0.001"))),
                    "receipts": str(receipts.quantize(Decimal("0.001"))),
                    "issues": str(issues.quantize(Decimal("0.001"))),
                    "adjustments": str(adjustments.quantize(Decimal("0.001"))),
                    "closing_stock": str(closing),
                    "reorder_level": str(item.reorder_level),
                    "unit_cost": str(Decimal(unit_val).quantize(Decimal("0.0001"))),
                    "stock_value": str(stock_value),
                    "status": status_label,
                }
            )
    return results
