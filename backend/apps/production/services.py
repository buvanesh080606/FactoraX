from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone

from apps.accounts.models import CompanySetting, UserRole
from apps.accounts.services import log_audit, notify_event
from apps.inventory.models import MovementType, StockItemType
from apps.inventory.services import get_stock_balance, record_stock_movement
from apps.masters.models import BOM, MaterialType, PackagingMaterial, Product, RawMaterial, Unit
from apps.masters.services import convert_quantity
from apps.production.models import (
    Expense,
    ExpenseCategory,
    ProductionConsumption,
    ProductionRun,
    ProductionStatus,
)


def generate_run_number() -> str:
    today = timezone.localdate().strftime("%Y%m%d")
    prefix = f"PRD-{today}-"
    last = (
        ProductionRun.objects.filter(run_number__startswith=prefix)
        .order_by("-run_number")
        .first()
    )
    seq = 1
    if last:
        try:
            seq = int(last.run_number.split("-")[-1]) + 1
        except ValueError:
            seq = ProductionRun.objects.count() + 1
    return f"{prefix}{seq:04d}"


def _quant2(val: Decimal) -> Decimal:
    return val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _quant3(val: Decimal) -> Decimal:
    return val.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)


def _quant4(val: Decimal) -> Decimal:
    return val.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)


def calculate_production_plan(
    *,
    product: Product,
    bom: BOM,
    batch_multiplier: Decimal,
    actual_good_output_qty: Decimal,
    wastage_qty: Decimal = Decimal("0.000"),
    consumptions_input: list[dict] | None = None,
    labour_cost: Decimal = Decimal("0.00"),
    gas_power_cost: Decimal = Decimal("0.00"),
    other_overhead_cost: Decimal = Decimal("0.00"),
) -> dict:
    """
    Pure calculation engine for planned vs actual consumption, variance (>tolerance flagging),
    stock sufficiency check, and Weighted Average production costing.
    """
    settings_obj = CompanySetting.get_solo()
    tolerance_pct = settings_obj.variance_tolerance_pct

    batch_multiplier = _quant3(Decimal(str(batch_multiplier)))
    expected_output = _quant3(bom.expected_output_qty * batch_multiplier)
    actual_good = _quant3(Decimal(str(actual_good_output_qty)))
    wastage_qty = _quant3(Decimal(str(wastage_qty)))
    labour_cost = _quant2(Decimal(str(labour_cost)))
    gas_power_cost = _quant2(Decimal(str(gas_power_cost)))
    other_overhead_cost = _quant2(Decimal(str(other_overhead_cost)))

    if expected_output <= 0:
        raise ValueError("Expected output must be positive.")
    if actual_good <= 0:
        raise ValueError("Actual good output must be greater than zero.")

    yield_variance_pct = _quant2(
        ((actual_good - expected_output) / expected_output) * Decimal("100")
    )
    yield_flagged = abs(yield_variance_pct) > tolerance_pct

    # Index user-supplied consumption inputs by (material_type, material_id)
    input_map = {}
    for row in consumptions_input or []:
        mtype = row["material_type"]
        mid = row.get("raw_material") if mtype == MaterialType.RAW else row.get("packaging_material")
        if hasattr(mid, "id"):
            mid = mid.id
        input_map[(mtype, int(mid))] = row

    lines = []
    raw_cost_total = Decimal("0.00")
    pkg_cost_total = Decimal("0.00")
    total_damaged_pkg = Decimal("0.000")
    any_flagged = yield_flagged
    stock_ok = True

    bom_items = list(
        bom.items.select_related("raw_material", "packaging_material", "unit").all()
    )
    seen_keys = set()

    for bitem in bom_items:
        mtype = bitem.material_type
        if mtype == MaterialType.RAW:
            mat = bitem.raw_material
            avail = get_stock_balance(StockItemType.RAW, mat.id)
        else:
            mat = bitem.packaging_material
            avail = get_stock_balance(StockItemType.PACKAGING, mat.id)

        key = (mtype, mat.id)
        seen_keys.add(key)
        planned_in_bom_unit = _quant3(bitem.standard_qty * batch_multiplier)
        try:
            planned = convert_quantity(planned_in_bom_unit, bitem.unit, mat.unit)
        except ValueError:
            raise ValueError(
                f"Unit mismatch for '{mat.name}': BOM uses '{bitem.unit.symbol}', "
                f"while Inventory tracks it in '{mat.unit.symbol}'. "
                f"Please update its unit to '{mat.unit.symbol}' in BOM Master & Editor."
            )

        supplied = input_map.get(key)
        if supplied:
            sup_unit_id = supplied.get("unit")
            sup_unit = Unit.objects.select_related("base_unit").get(pk=sup_unit_id) if sup_unit_id else mat.unit
            actual_qty = convert_quantity(Decimal(str(supplied["actual_qty"])), sup_unit, mat.unit)
            damaged_qty = convert_quantity(Decimal(str(supplied.get("damaged_qty", "0"))), sup_unit, mat.unit)
        else:
            actual_qty = planned
            damaged_qty = Decimal("0.000")
        total_issued = _quant3(actual_qty + damaged_qty)

        variance_qty = _quant3(total_issued - planned)
        variance_pct = (
            _quant2((variance_qty / planned) * Decimal("100"))
            if planned > 0
            else Decimal("0.00")
        )
        is_flagged = abs(variance_pct) > tolerance_pct
        if is_flagged:
            any_flagged = True

        unit_cost = _quant4(mat.weighted_avg_cost)
        line_cost = _quant2(total_issued * unit_cost)

        if mtype == MaterialType.RAW:
            raw_cost_total += line_cost
        else:
            pkg_cost_total += line_cost
            total_damaged_pkg += damaged_qty

        shortage = max(Decimal("0.000"), total_issued - avail)
        if shortage > 0:
            stock_ok = False

        lines.append(
            {
                "material_type": mtype,
                "raw_material": mat.id if mtype == MaterialType.RAW else None,
                "packaging_material": mat.id if mtype == MaterialType.PACKAGING else None,
                "material_name": mat.name,
                "unit_id": mat.unit_id,
                "unit_symbol": mat.unit.symbol,
                "planned_qty": planned,
                "actual_qty": actual_qty,
                "damaged_qty": damaged_qty,
                "total_issued_qty": total_issued,
                "available_stock": avail,
                "shortage_qty": shortage,
                "variance_qty": variance_qty,
                "variance_pct": variance_pct,
                "is_variance_flagged": is_flagged,
                "unit_cost": unit_cost,
                "total_cost": line_cost,
            }
        )

    # Support any extra non-BOM material consumption explicitly provided
    for (mtype, mid), supplied in input_map.items():
        if (mtype, mid) in seen_keys:
            continue
        if mtype == MaterialType.RAW:
            mat = RawMaterial.objects.select_related("unit").get(pk=mid)
            avail = get_stock_balance(StockItemType.RAW, mat.id)
        else:
            mat = PackagingMaterial.objects.select_related("unit").get(pk=mid)
            avail = get_stock_balance(StockItemType.PACKAGING, mat.id)
        actual_qty = _quant3(Decimal(str(supplied["actual_qty"])))
        damaged_qty = _quant3(Decimal(str(supplied.get("damaged_qty", "0"))))
        total_issued = _quant3(actual_qty + damaged_qty)
        unit_cost = _quant4(mat.weighted_avg_cost)
        line_cost = _quant2(total_issued * unit_cost)
        if mtype == MaterialType.RAW:
            raw_cost_total += line_cost
        else:
            pkg_cost_total += line_cost
            total_damaged_pkg += damaged_qty
        shortage = max(Decimal("0.000"), total_issued - avail)
        if shortage > 0:
            stock_ok = False
        lines.append(
            {
                "material_type": mtype,
                "raw_material": mat.id if mtype == MaterialType.RAW else None,
                "packaging_material": mat.id if mtype == MaterialType.PACKAGING else None,
                "material_name": mat.name,
                "unit_id": mat.unit_id,
                "unit_symbol": mat.unit.symbol,
                "planned_qty": Decimal("0.000"),
                "actual_qty": actual_qty,
                "damaged_qty": damaged_qty,
                "total_issued_qty": total_issued,
                "available_stock": avail,
                "shortage_qty": shortage,
                "variance_qty": total_issued,
                "variance_pct": Decimal("100.00"),
                "is_variance_flagged": True,
                "unit_cost": unit_cost,
                "total_cost": line_cost,
            }
        )
        any_flagged = True

    overhead_total = _quant2(labour_cost + gas_power_cost + other_overhead_cost)
    total_production_cost = _quant2(raw_cost_total + pkg_cost_total + overhead_total)
    cost_per_good_packet = _quant4(total_production_cost / actual_good)
    selling_price = product.selling_price
    estimated_margin_per_packet = _quant2(selling_price - cost_per_good_packet)
    estimated_margin_pct = (
        _quant2((estimated_margin_per_packet / selling_price) * Decimal("100"))
        if selling_price > 0
        else Decimal("0.00")
    )

    return {
        "product_id": product.id,
        "product_name": product.name,
        "bom_id": bom.id,
        "batch_multiplier": batch_multiplier,
        "expected_output_qty": expected_output,
        "actual_good_output_qty": actual_good,
        "wastage_qty": wastage_qty,
        "damaged_packaging_qty": _quant3(total_damaged_pkg),
        "yield_variance_pct": yield_variance_pct,
        "yield_flagged": yield_flagged,
        "tolerance_pct": tolerance_pct,
        "has_variance_flag": any_flagged,
        "is_stock_sufficient": stock_ok,
        "raw_material_cost": _quant2(raw_cost_total),
        "packaging_cost": _quant2(pkg_cost_total),
        "labour_cost": labour_cost,
        "gas_power_cost": gas_power_cost,
        "other_overhead_cost": other_overhead_cost,
        "total_production_cost": total_production_cost,
        "cost_per_good_packet": cost_per_good_packet,
        "selling_price": selling_price,
        "estimated_margin_per_packet": estimated_margin_per_packet,
        "estimated_margin_pct": estimated_margin_pct,
        "valuation_method": "WEIGHTED_AVERAGE",
        "consumptions": lines,
    }


@transaction.atomic
def execute_production_run(
    *,
    product: Product,
    bom: BOM,
    run_date=None,
    batch_multiplier: Decimal,
    actual_good_output_qty: Decimal,
    wastage_qty: Decimal = Decimal("0.000"),
    consumptions_input: list[dict],
    labour_cost: Decimal = Decimal("0.00"),
    gas_power_cost: Decimal = Decimal("0.00"),
    other_overhead_cost: Decimal = Decimal("0.00"),
    notes: str = "",
    user=None,
    request=None,
) -> ProductionRun:
    """
    Atomically confirms a production run:
    1. Calculates variance and Weighted Average costing.
    2. Deducts raw & packaging materials (including damaged packaging) from StockLedger.
    3. Adds actual good finished packets to StockLedger at calculated cost_per_good_packet.
    4. Persists ProductionRun, ProductionConsumption, and overhead Expense records.
    Rolls back entirely if any material lacks sufficient stock.
    """
    calc = calculate_production_plan(
        product=product,
        bom=bom,
        batch_multiplier=batch_multiplier,
        actual_good_output_qty=actual_good_output_qty,
        wastage_qty=wastage_qty,
        consumptions_input=consumptions_input,
        labour_cost=labour_cost,
        gas_power_cost=gas_power_cost,
        other_overhead_cost=other_overhead_cost,
    )

    run_number = generate_run_number()
    now = timezone.now()
    rdate = run_date or timezone.localdate()

    run = ProductionRun.objects.create(
        run_number=run_number,
        product=product,
        bom=bom,
        run_date=rdate,
        batch_multiplier=calc["batch_multiplier"],
        expected_output_qty=calc["expected_output_qty"],
        actual_good_output_qty=calc["actual_good_output_qty"],
        wastage_qty=calc["wastage_qty"],
        damaged_packaging_qty=calc["damaged_packaging_qty"],
        yield_variance_pct=calc["yield_variance_pct"],
        has_variance_flag=calc["has_variance_flag"],
        raw_material_cost=calc["raw_material_cost"],
        packaging_cost=calc["packaging_cost"],
        labour_cost=calc["labour_cost"],
        gas_power_cost=calc["gas_power_cost"],
        other_overhead_cost=calc["other_overhead_cost"],
        total_production_cost=calc["total_production_cost"],
        cost_per_good_packet=calc["cost_per_good_packet"],
        status=ProductionStatus.CONFIRMED,
        notes=notes,
        supervised_by=user,
        confirmed_by=user,
        confirmed_at=now,
    )

    # Deduct all consumed materials atomically
    for line in calc["consumptions"]:
        ProductionConsumption.objects.create(
            production_run=run,
            material_type=line["material_type"],
            raw_material_id=line["raw_material"],
            packaging_material_id=line["packaging_material"],
            unit_id=line["unit_id"],
            planned_qty=line["planned_qty"],
            actual_qty=line["actual_qty"],
            damaged_qty=line["damaged_qty"],
            total_issued_qty=line["total_issued_qty"],
            variance_qty=line["variance_qty"],
            variance_pct=line["variance_pct"],
            is_variance_flagged=line["is_variance_flagged"],
            unit_cost=line["unit_cost"],
            total_cost=line["total_cost"],
        )
        if line["total_issued_qty"] > 0:
            if line["material_type"] == MaterialType.RAW:
                item_type = StockItemType.RAW
                item_id = line["raw_material"]
            else:
                item_type = StockItemType.PACKAGING
                item_id = line["packaging_material"]

            record_stock_movement(
                item_type=item_type,
                item_id=item_id,
                movement_type=MovementType.PRODUCTION_ISSUE,
                quantity_delta=-line["total_issued_qty"],
                unit_cost=line["unit_cost"],
                source_type="PRODUCTION_RUN",
                source_id=str(run.id),
                reference_no=run.run_number,
                notes=f"Issued for {run.run_number} ({product.name})",
                user=user,
            )

    # Credit actual good finished output to StockLedger
    record_stock_movement(
        item_type=StockItemType.FINISHED,
        item_id=product.id,
        movement_type=MovementType.PRODUCTION_OUTPUT,
        quantity_delta=calc["actual_good_output_qty"],
        unit_cost=calc["cost_per_good_packet"],
        source_type="PRODUCTION_RUN",
        source_id=str(run.id),
        reference_no=run.run_number,
        notes=f"Good finished output from {run.run_number}",
        user=user,
    )

    # Record production overhead expenses
    if calc["labour_cost"] > 0:
        Expense.objects.create(
            production_run=run,
            category=ExpenseCategory.LABOUR,
            description=f"Labour overhead for {run.run_number} ({product.name})",
            amount=calc["labour_cost"],
            expense_date=rdate,
            recorded_by=user,
        )
    if calc["gas_power_cost"] > 0:
        Expense.objects.create(
            production_run=run,
            category=ExpenseCategory.GAS_POWER,
            description=f"Gas & Electricity overhead for {run.run_number} ({product.name})",
            amount=calc["gas_power_cost"],
            expense_date=rdate,
            recorded_by=user,
        )
    if calc["other_overhead_cost"] > 0:
        Expense.objects.create(
            production_run=run,
            category=ExpenseCategory.OTHER,
            description=f"Other overhead for {run.run_number} ({product.name})",
            amount=calc["other_overhead_cost"],
            expense_date=rdate,
            recorded_by=user,
        )

    log_audit(
        user=user,
        action="CONFIRM_PRODUCTION_RUN",
        entity_type="ProductionRun",
        entity_id=run.id,
        summary=(
            f"Confirmed {run.run_number}: {product.name} good output {run.actual_good_output_qty} "
            f"(yield variance {run.yield_variance_pct}%), cost/pkt Rs.{run.cost_per_good_packet}."
        ),
        request=request,
    )

    notify_event(
        event_type="PRODUCTION_CONFIRMED",
        title=f"Production Completed: {run.run_number}",
        message=f"{product.name}: +{run.actual_good_output_qty} {product.unit.symbol} added to finished stock (Cost/pkt: Rs.{run.cost_per_good_packet}).",
        target_roles=[UserRole.ADMIN, UserRole.OWNER],
        entity_type="ProductionRun",
        entity_id=run.id,
    )
    if run.has_variance_flag:
        notify_event(
            event_type="VARIANCE_ALERT",
            title=f"Variance Alert on {run.run_number}",
            message=f"{product.name} batch exceeded variance tolerance (Yield variance: {run.yield_variance_pct}%).",
            target_roles=[UserRole.OWNER, UserRole.ADMIN, UserRole.PRODUCTION],
            entity_type="ProductionRun",
            entity_id=run.id,
        )

    return run


@transaction.atomic
def update_production_run(
    *,
    run: ProductionRun,
    data: dict,
    user=None,
    request=None,
) -> ProductionRun:
    """
    Updates a committed production run's date, actual good output, wastage, overheads,
    and notes while preserving the append-only StockLedger via ADJUSTMENT deltas.
    """
    settings_obj = CompanySetting.get_solo()
    tolerance_pct = settings_obj.variance_tolerance_pct

    if run.status == ProductionStatus.CANCELLED:
        raise ValueError(f"{run.run_number} has already been cancelled/reversed and cannot be edited.")

    old_good = run.actual_good_output_qty
    new_good = _quant3(Decimal(str(data.get("actual_good_output_qty", old_good))))
    new_wastage = _quant3(Decimal(str(data.get("wastage_qty", run.wastage_qty))))
    new_labour = _quant2(Decimal(str(data.get("labour_cost", run.labour_cost))))
    new_gas = _quant2(Decimal(str(data.get("gas_power_cost", run.gas_power_cost))))
    new_other = _quant2(Decimal(str(data.get("other_overhead_cost", run.other_overhead_cost))))
    new_notes = str(data.get("notes", run.notes or ""))
    new_date = data.get("run_date") or run.run_date

    if new_good <= 0:
        raise ValueError("Actual good output must be greater than zero.")
    if new_wastage < 0 or new_labour < 0 or new_gas < 0 or new_other < 0:
        raise ValueError("Wastage and overhead costs cannot be negative.")

    yield_variance_pct = (
        _quant2(((new_good - run.expected_output_qty) / run.expected_output_qty) * Decimal("100"))
        if run.expected_output_qty > 0
        else Decimal("0.00")
    )
    any_cons_flagged = run.consumptions.filter(is_variance_flagged=True).exists()
    has_variance_flag = any_cons_flagged or (abs(yield_variance_pct) > tolerance_pct)

    overhead_total = _quant2(new_labour + new_gas + new_other)
    total_cost = _quant2(run.raw_material_cost + run.packaging_cost + overhead_total)
    cost_per_pkt = _quant4(total_cost / new_good)

    delta_good = _quant3(new_good - old_good)
    if delta_good != 0:
        record_stock_movement(
            item_type=StockItemType.FINISHED,
            item_id=run.product_id,
            movement_type=MovementType.ADJUSTMENT,
            quantity_delta=delta_good,
            unit_cost=cost_per_pkt,
            source_type="PRODUCTION_RUN_EDIT",
            source_id=str(run.id),
            reference_no=run.run_number,
            notes=f"Adjusted good output on {run.run_number} ({old_good} -> {new_good})",
            user=user,
        )

    run.run_date = new_date
    run.actual_good_output_qty = new_good
    run.wastage_qty = new_wastage
    run.yield_variance_pct = yield_variance_pct
    run.has_variance_flag = has_variance_flag
    run.labour_cost = new_labour
    run.gas_power_cost = new_gas
    run.other_overhead_cost = new_other
    run.total_production_cost = total_cost
    run.cost_per_good_packet = cost_per_pkt
    run.notes = new_notes
    run.save()

    Expense.objects.filter(production_run=run).delete()
    if new_labour > 0:
        Expense.objects.create(
            production_run=run,
            category=ExpenseCategory.LABOUR,
            description=f"Labour overhead for {run.run_number} ({run.product.name})",
            amount=new_labour,
            expense_date=run.run_date,
            recorded_by=user,
        )
    if new_gas > 0:
        Expense.objects.create(
            production_run=run,
            category=ExpenseCategory.GAS_POWER,
            description=f"Gas & Electricity overhead for {run.run_number} ({run.product.name})",
            amount=new_gas,
            expense_date=run.run_date,
            recorded_by=user,
        )
    if new_other > 0:
        Expense.objects.create(
            production_run=run,
            category=ExpenseCategory.OTHER,
            description=f"Other overhead for {run.run_number} ({run.product.name})",
            amount=new_other,
            expense_date=run.run_date,
            recorded_by=user,
        )

    log_audit(
        user=user,
        action="EDIT_PRODUCTION_RUN",
        entity_type="ProductionRun",
        entity_id=run.id,
        summary=(
            f"Edited {run.run_number} ({run.product.name}): good output {old_good} -> {new_good}, "
            f"total cost Rs.{total_cost}, cost/pkt Rs.{cost_per_pkt}."
        ),
        request=request,
    )
    return run


@transaction.atomic
def delete_production_run(
    *,
    run: ProductionRun,
    user=None,
    request=None,
) -> str:
    """
    Audit-safe cancellation/reversal of a production run:
    Never hard-deletes the posted ProductionRun record. Instead, posts reversing
    ADJUSTMENT entries to the append-only StockLedger (deducting finished output and
    restoring issued materials), marks status=CANCELLED, removes non-posted overhead
    expenses, and records a CANCEL_PRODUCTION_RUN entry in the AuditLog.
    """
    if run.status == ProductionStatus.CANCELLED:
        raise ValueError(f"{run.run_number} is already cancelled/reversed.")

    run_number = run.run_number
    product_name = run.product.name
    run_id = run.id

    if run.actual_good_output_qty > 0:
        record_stock_movement(
            item_type=StockItemType.FINISHED,
            item_id=run.product_id,
            movement_type=MovementType.ADJUSTMENT,
            quantity_delta=-run.actual_good_output_qty,
            unit_cost=run.cost_per_good_packet,
            source_type="PRODUCTION_RUN_REVERSAL",
            source_id=str(run.id),
            reference_no=run_number,
            notes=f"Reversed finished output on cancellation of {run_number}",
            user=user,
        )

    for cons in run.consumptions.all():
        if cons.total_issued_qty > 0:
            if cons.material_type == MaterialType.RAW and cons.raw_material_id:
                item_type = StockItemType.RAW
                item_id = cons.raw_material_id
            elif cons.packaging_material_id:
                item_type = StockItemType.PACKAGING
                item_id = cons.packaging_material_id
            else:
                continue

            record_stock_movement(
                item_type=item_type,
                item_id=item_id,
                movement_type=MovementType.ADJUSTMENT,
                quantity_delta=cons.total_issued_qty,
                unit_cost=cons.unit_cost,
                source_type="PRODUCTION_RUN_REVERSAL",
                source_id=str(run.id),
                reference_no=run_number,
                notes=f"Restored material on cancellation of {run_number} ({product_name})",
                user=user,
            )

    Expense.objects.filter(production_run=run).delete()
    run.status = ProductionStatus.CANCELLED
    run.notes = f"{run.notes} [CANCELLED / REVERSED]".strip()
    run.save(update_fields=["status", "notes", "updated_at"])

    log_audit(
        user=user,
        action="CANCEL_PRODUCTION_RUN",
        entity_type="ProductionRun",
        entity_id=run_id,
        summary=f"Cancelled {run_number} ({product_name}), reversed stock in ledger, and preserved record for audit.",
        request=request,
    )
    return run_number
