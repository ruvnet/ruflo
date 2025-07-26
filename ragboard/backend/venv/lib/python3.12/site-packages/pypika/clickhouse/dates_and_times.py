from pypika import CustomFunction

_add_subtract_args = ["name", "interval"]

ToYYYYMM = CustomFunction("toYYYYMM")
AddYears = CustomFunction("addYears", _add_subtract_args)
AddMonths = CustomFunction("addMonths", _add_subtract_args)
AddWeeks = CustomFunction("addWeeks", _add_subtract_args)
AddDays = CustomFunction("addDays", _add_subtract_args)
AddHours = CustomFunction("addHours", _add_subtract_args)
AddMinutes = CustomFunction("addMinutes", _add_subtract_args)
AddSeconds = CustomFunction("addSeconds", _add_subtract_args)
AddQuarters = CustomFunction("addQuarters", _add_subtract_args)
SubtractYears = CustomFunction("subtractYears", _add_subtract_args)
SubtractMonths = CustomFunction("subtractMonths", _add_subtract_args)
SubtractWeeks = CustomFunction("subtractWeeks", _add_subtract_args)
SubtractDays = CustomFunction("subtractDays", _add_subtract_args)
SubtractHours = CustomFunction("subtractHours", _add_subtract_args)
SubtractMinutes = CustomFunction("subtractMinutes", _add_subtract_args)
SubtractSeconds = CustomFunction("subtractSeconds", _add_subtract_args)
SubtractQuarters = CustomFunction("subtractQuarters", _add_subtract_args)
FormatDateTime = CustomFunction("formatDateTime", ["name", "dt_format"])
