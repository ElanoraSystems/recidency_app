"""Unit-of-measure conversion — see app/models/purchasing.py's
UnitOfMeasure docstring for the single-level base-unit design this
implements. Used wherever a quantity needs to move between two
UnitOfMeasure rows (currently: Recipe ingredient overrides)."""

from app.models.purchasing import UnitOfMeasure


class IncompatibleUnitsError(ValueError):
    pass


def _ultimate_base_id(unit: UnitOfMeasure):
    return unit.base_unit_id or unit.id


def _factor_to_base(unit: UnitOfMeasure) -> float:
    # A base unit (base_unit_id is None) is always factor 1 relative to
    # itself, regardless of whatever is stored in factor_to_base.
    return float(unit.factor_to_base) if unit.base_unit_id else 1.0


def convert(qty: float, from_unit: UnitOfMeasure, to_unit: UnitOfMeasure) -> float:
    """Converts `qty` from from_unit to to_unit. Raises IncompatibleUnitsError
    if the two units don't share an ultimate base (e.g. mass vs volume, or
    either is a non-convertible unit like "units"/"pack")."""
    if from_unit.id == to_unit.id:
        return qty
    if _ultimate_base_id(from_unit) != _ultimate_base_id(to_unit):
        raise IncompatibleUnitsError(f'"{from_unit.label}" can\'t be converted to "{to_unit.label}"')
    qty_in_base = qty * _factor_to_base(from_unit)
    return qty_in_base / _factor_to_base(to_unit)
