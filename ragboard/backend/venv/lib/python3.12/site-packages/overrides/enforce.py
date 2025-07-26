from abc import ABCMeta


class EnforceOverridesMeta(ABCMeta):
    def __new__(mcls, name, bases, namespace, **kwargs):
        # Ignore any methods defined on the metaclass when enforcing overrides.
        for method in dir(mcls):
            if not method.startswith("__") and method != "mro":
                value = getattr(mcls, method)
                if not isinstance(value, (bool, str, int, float, tuple, list, dict)):
                    setattr(getattr(mcls, method), "__ignored__", True)

        cls = super().__new__(mcls, name, bases, namespace, **kwargs)
        for name, value in namespace.items():
            mcls._check_if_overrides_final_method(name, bases)
            if not name.startswith("__"):
                value = mcls._handle_special_value(value)
                mcls._check_if_overrides_without_overrides_decorator(name, value, bases)
        return cls

    @staticmethod
    def _check_if_overrides_without_overrides_decorator(name, value, bases):
        is_override = getattr(value, "__override__", False)
        for base in bases:
            base_class_method = getattr(base, name, False)
            if (
                not base_class_method
                or not callable(base_class_method)
                or getattr(base_class_method, "__ignored__", False)
            ):
                continue
            if not is_override:
                raise TypeError(
                    f"Method {name} overrides method from {base} but does not have @override decorator"
                )

    @staticmethod
    def _check_if_overrides_final_method(name, bases):
        for base in bases:
            base_class_method = getattr(base, name, False)
            # `__final__` is added by `@final` decorator
            if getattr(base_class_method, "__final__", False):
                raise TypeError(
                    f"Method {name} is finalized in {base}, it cannot be overridden"
                )

    @staticmethod
    def _handle_special_value(value):
        if isinstance(value, classmethod) or isinstance(value, staticmethod):
            value = value.__get__(None, dict)
        elif isinstance(value, property):
            value = value.fget
        return value


class EnforceOverrides(metaclass=EnforceOverridesMeta):
    "Use this as the parent class for your custom classes"
    pass
