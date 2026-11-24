from decimal import Decimal, ROUND_HALF_UP

from apps.masters.models import Unit


def convert_quantity(qty: Decimal, from_unit: Unit, to_unit: Unit) -> Decimal:
    """
    Converts quantities accurately between compatible units using Decimal arithmetic.
    Supports kg <-> g (1 kg = 1000 g), L <-> ml (1 L = 1000 ml), and carton <-> pkt (1 carton = 20 pkt).
    """
    amount = Decimal(str(qty))
    if from_unit.id == to_unit.id:
        return amount.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)

    from_root, from_factor = from_unit.canonical_root
    to_root, to_factor = to_unit.canonical_root
    if from_root.id != to_root.id:
        raise ValueError(
            f"Incompatible units: cannot convert {from_unit.symbol} to {to_unit.symbol}."
        )
    converted = (amount * from_factor) / to_factor
    return converted.quantize(Decimal("0.001"), rounding=ROUND_HALF_UP)
