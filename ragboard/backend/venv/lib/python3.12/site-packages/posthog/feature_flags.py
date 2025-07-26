import datetime
import hashlib
import logging
import re
from typing import Optional

from dateutil import parser
from dateutil.relativedelta import relativedelta

from posthog import utils
from posthog.types import FlagValue
from posthog.utils import convert_to_datetime_aware, is_valid_regex

__LONG_SCALE__ = float(0xFFFFFFFFFFFFFFF)

log = logging.getLogger("posthog")

NONE_VALUES_ALLOWED_OPERATORS = ["is_not"]


class InconclusiveMatchError(Exception):
    pass


# This function takes a distinct_id and a feature flag key and returns a float between 0 and 1.
# Given the same distinct_id and key, it'll always return the same float. These floats are
# uniformly distributed between 0 and 1, so if we want to show this feature to 20% of traffic
# we can do _hash(key, distinct_id) < 0.2
def _hash(key: str, distinct_id: str, salt: str = "") -> float:
    hash_key = f"{key}.{distinct_id}{salt}"
    hash_val = int(hashlib.sha1(hash_key.encode("utf-8")).hexdigest()[:15], 16)
    return hash_val / __LONG_SCALE__


def get_matching_variant(flag, distinct_id):
    hash_value = _hash(flag["key"], distinct_id, salt="variant")
    for variant in variant_lookup_table(flag):
        if hash_value >= variant["value_min"] and hash_value < variant["value_max"]:
            return variant["key"]
    return None


def variant_lookup_table(feature_flag):
    lookup_table = []
    value_min = 0
    multivariates = ((feature_flag.get("filters") or {}).get("multivariate") or {}).get(
        "variants"
    ) or []
    for variant in multivariates:
        value_max = value_min + variant["rollout_percentage"] / 100
        lookup_table.append(
            {"value_min": value_min, "value_max": value_max, "key": variant["key"]}
        )
        value_min = value_max
    return lookup_table


def match_feature_flag_properties(
    flag, distinct_id, properties, cohort_properties=None
) -> FlagValue:
    flag_conditions = (flag.get("filters") or {}).get("groups") or []
    is_inconclusive = False
    cohort_properties = cohort_properties or {}
    # Some filters can be explicitly set to null, which require accessing variants like so
    flag_variants = ((flag.get("filters") or {}).get("multivariate") or {}).get(
        "variants"
    ) or []
    valid_variant_keys = [variant["key"] for variant in flag_variants]

    # Stable sort conditions with variant overrides to the top. This ensures that if overrides are present, they are
    # evaluated first, and the variant override is applied to the first matching condition.
    sorted_flag_conditions = sorted(
        flag_conditions,
        key=lambda condition: 0 if condition.get("variant") else 1,
    )

    for condition in sorted_flag_conditions:
        try:
            # if any one condition resolves to True, we can shortcircuit and return
            # the matching variant
            if is_condition_match(
                flag, distinct_id, condition, properties, cohort_properties
            ):
                variant_override = condition.get("variant")
                if variant_override and variant_override in valid_variant_keys:
                    variant = variant_override
                else:
                    variant = get_matching_variant(flag, distinct_id)
                return variant or True
        except InconclusiveMatchError:
            is_inconclusive = True

    if is_inconclusive:
        raise InconclusiveMatchError(
            "Can't determine if feature flag is enabled or not with given properties"
        )

    # We can only return False when either all conditions are False, or
    # no condition was inconclusive.
    return False


def is_condition_match(
    feature_flag, distinct_id, condition, properties, cohort_properties
) -> bool:
    rollout_percentage = condition.get("rollout_percentage")
    if len(condition.get("properties") or []) > 0:
        for prop in condition.get("properties"):
            property_type = prop.get("type")
            if property_type == "cohort":
                matches = match_cohort(prop, properties, cohort_properties)
            else:
                matches = match_property(prop, properties)
            if not matches:
                return False

        if rollout_percentage is None:
            return True

    if rollout_percentage is not None and _hash(feature_flag["key"], distinct_id) > (
        rollout_percentage / 100
    ):
        return False

    return True


def match_property(property, property_values) -> bool:
    # only looks for matches where key exists in override_property_values
    # doesn't support operator is_not_set
    key = property.get("key")
    operator = property.get("operator") or "exact"
    value = property.get("value")

    if key not in property_values:
        raise InconclusiveMatchError(
            "can't match properties without a given property value"
        )

    if operator == "is_not_set":
        raise InconclusiveMatchError("can't match properties with operator is_not_set")

    override_value = property_values[key]

    if (operator not in NONE_VALUES_ALLOWED_OPERATORS) and override_value is None:
        return False

    if operator in ("exact", "is_not"):

        def compute_exact_match(value, override_value):
            if isinstance(value, list):
                return str(override_value).casefold() in [
                    str(val).casefold() for val in value
                ]
            return utils.str_iequals(value, override_value)

        if operator == "exact":
            return compute_exact_match(value, override_value)
        else:
            return not compute_exact_match(value, override_value)

    if operator == "is_set":
        return key in property_values

    if operator == "icontains":
        return utils.str_icontains(override_value, value)

    if operator == "not_icontains":
        return not utils.str_icontains(override_value, value)

    if operator == "regex":
        return (
            is_valid_regex(str(value))
            and re.compile(str(value)).search(str(override_value)) is not None
        )

    if operator == "not_regex":
        return (
            is_valid_regex(str(value))
            and re.compile(str(value)).search(str(override_value)) is None
        )

    if operator in ("gt", "gte", "lt", "lte"):
        # :TRICKY: We adjust comparison based on the override value passed in,
        # to make sure we handle both numeric and string comparisons appropriately.
        def compare(lhs, rhs, operator):
            if operator == "gt":
                return lhs > rhs
            elif operator == "gte":
                return lhs >= rhs
            elif operator == "lt":
                return lhs < rhs
            elif operator == "lte":
                return lhs <= rhs
            else:
                raise ValueError(f"Invalid operator: {operator}")

        parsed_value = None
        try:
            parsed_value = float(value)  # type: ignore
        except Exception:
            pass

        if parsed_value is not None and override_value is not None:
            if isinstance(override_value, str):
                return compare(override_value, str(value), operator)
            else:
                return compare(override_value, parsed_value, operator)
        else:
            return compare(str(override_value), str(value), operator)

    if operator in ["is_date_before", "is_date_after"]:
        try:
            parsed_date = relative_date_parse_for_feature_flag_matching(str(value))

            if not parsed_date:
                parsed_date = parser.parse(str(value))
                parsed_date = convert_to_datetime_aware(parsed_date)
        except Exception as e:
            raise InconclusiveMatchError(
                "The date set on the flag is not a valid format"
            ) from e

        if not parsed_date:
            raise InconclusiveMatchError(
                "The date set on the flag is not a valid format"
            )

        if isinstance(override_value, datetime.datetime):
            override_date = convert_to_datetime_aware(override_value)
            if operator == "is_date_before":
                return override_date < parsed_date
            else:
                return override_date > parsed_date
        elif isinstance(override_value, datetime.date):
            if operator == "is_date_before":
                return override_value < parsed_date.date()
            else:
                return override_value > parsed_date.date()
        elif isinstance(override_value, str):
            try:
                override_date = parser.parse(override_value)
                override_date = convert_to_datetime_aware(override_date)
                if operator == "is_date_before":
                    return override_date < parsed_date
                else:
                    return override_date > parsed_date
            except Exception:
                raise InconclusiveMatchError("The date provided is not a valid format")
        else:
            raise InconclusiveMatchError(
                "The date provided must be a string or date object"
            )

    # if we get here, we don't know how to handle the operator
    raise InconclusiveMatchError(f"Unknown operator {operator}")


def match_cohort(property, property_values, cohort_properties) -> bool:
    # Cohort properties are in the form of property groups like this:
    # {
    #     "cohort_id": {
    #         "type": "AND|OR",
    #         "values": [{
    #            "key": "property_name", "value": "property_value"
    #        }]
    #     }
    # }
    cohort_id = str(property.get("value"))
    if cohort_id not in cohort_properties:
        raise InconclusiveMatchError(
            "can't match cohort without a given cohort property value"
        )

    property_group = cohort_properties[cohort_id]
    return match_property_group(property_group, property_values, cohort_properties)


def match_property_group(property_group, property_values, cohort_properties) -> bool:
    if not property_group:
        return True

    property_group_type = property_group.get("type")
    properties = property_group.get("values")

    if not properties or len(properties) == 0:
        # empty groups are no-ops, always match
        return True

    error_matching_locally = False

    if "values" in properties[0]:
        # a nested property group
        for prop in properties:
            try:
                matches = match_property_group(prop, property_values, cohort_properties)
                if property_group_type == "AND":
                    if not matches:
                        return False
                else:
                    # OR group
                    if matches:
                        return True
            except InconclusiveMatchError as e:
                log.debug(f"Failed to compute property {prop} locally: {e}")
                error_matching_locally = True

        if error_matching_locally:
            raise InconclusiveMatchError(
                "Can't match cohort without a given cohort property value"
            )
        # if we get here, all matched in AND case, or none matched in OR case
        return property_group_type == "AND"

    else:
        for prop in properties:
            try:
                if prop.get("type") == "cohort":
                    matches = match_cohort(prop, property_values, cohort_properties)
                else:
                    matches = match_property(prop, property_values)

                negation = prop.get("negation", False)

                if property_group_type == "AND":
                    # if negated property, do the inverse
                    if not matches and not negation:
                        return False
                    if matches and negation:
                        return False
                else:
                    # OR group
                    if matches and not negation:
                        return True
                    if not matches and negation:
                        return True
            except InconclusiveMatchError as e:
                log.debug(f"Failed to compute property {prop} locally: {e}")
                error_matching_locally = True

        if error_matching_locally:
            raise InconclusiveMatchError(
                "can't match cohort without a given cohort property value"
            )

        # if we get here, all matched in AND case, or none matched in OR case
        return property_group_type == "AND"


def relative_date_parse_for_feature_flag_matching(
    value: str,
) -> Optional[datetime.datetime]:
    regex = r"^-?(?P<number>[0-9]+)(?P<interval>[a-z])$"
    match = re.search(regex, value)
    parsed_dt = datetime.datetime.now(datetime.timezone.utc)
    if match:
        number = int(match.group("number"))

        if number >= 10_000:
            # Guard against overflow, disallow numbers greater than 10_000
            return None

        interval = match.group("interval")
        if interval == "h":
            parsed_dt = parsed_dt - relativedelta(hours=number)
        elif interval == "d":
            parsed_dt = parsed_dt - relativedelta(days=number)
        elif interval == "w":
            parsed_dt = parsed_dt - relativedelta(weeks=number)
        elif interval == "m":
            parsed_dt = parsed_dt - relativedelta(months=number)
        elif interval == "y":
            parsed_dt = parsed_dt - relativedelta(years=number)
        else:
            return None

        return parsed_dt
    else:
        return None
