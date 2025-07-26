from .runtime.environment import EnvironmentContext

# create proxy functions for
# each method on the EnvironmentContext class.
EnvironmentContext.create_module_class_proxy(globals(), locals())
