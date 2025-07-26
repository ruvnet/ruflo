from chromadb.config import Component, System, Settings
from overrides import overrides
from threading import local
import random

data = local()  # use thread local just in case tests ever run in parallel


def reset() -> None:
    global data
    data.starts = []
    data.stops = []
    data.inits = []


class ComponentA(Component):
    def __init__(self, system: System):
        data.inits += "A"
        super().__init__(system)
        self.require(ComponentB)
        self.require(ComponentC)

    @overrides
    def start(self) -> None:
        data.starts += "A"

    @overrides
    def stop(self) -> None:
        data.stops += "A"


class ComponentB(Component):
    def __init__(self, system: System):
        data.inits += "B"
        super().__init__(system)
        self.require(ComponentC)
        self.require(ComponentD)

    @overrides
    def start(self) -> None:
        data.starts += "B"

    @overrides
    def stop(self) -> None:
        data.stops += "B"


class ComponentC(Component):
    def __init__(self, system: System):
        data.inits += "C"
        super().__init__(system)
        self.require(ComponentD)

    @overrides
    def start(self) -> None:
        data.starts += "C"

    @overrides
    def stop(self) -> None:
        data.stops += "C"


class ComponentD(Component):
    def __init__(self, system: System):
        data.inits += "D"
        super().__init__(system)

    @overrides
    def start(self) -> None:
        data.starts += "D"

    @overrides
    def stop(self) -> None:
        data.stops += "D"


# Dependency Graph for tests:
# ┌───┐
# │ A │
# └┬─┬┘
#  │┌▽──┐
#  ││ B │
#  │└┬─┬┘
# ┌▽─▽┐│
# │ C ││
# └┬──┘│
# ┌▽───▽┐
# │  D  │
# └─────┘


def test_leaf_only() -> None:
    settings = Settings()
    system = System(settings)

    reset()

    d = system.instance(ComponentD)
    assert isinstance(d, ComponentD)

    assert data.inits == ["D"]
    system.start()
    assert data.starts == ["D"]
    system.stop()
    assert data.stops == ["D"]


def test_partial() -> None:
    settings = Settings()
    system = System(settings)

    reset()

    c = system.instance(ComponentC)
    assert isinstance(c, ComponentC)

    assert data.inits == ["C", "D"]
    system.start()
    assert data.starts == ["D", "C"]
    system.stop()
    assert data.stops == ["C", "D"]


def test_system_startup() -> None:
    settings = Settings()
    system = System(settings)

    reset()

    a = system.instance(ComponentA)
    assert isinstance(a, ComponentA)

    assert data.inits == ["A", "B", "C", "D"]
    system.start()
    assert data.starts == ["D", "C", "B", "A"]
    system.stop()
    assert data.stops == ["A", "B", "C", "D"]


def test_system_override_order() -> None:
    settings = Settings()
    system = System(settings)

    reset()

    system.instance(ComponentA)

    # Deterministically shuffle the instances map to prove that topsort is actually
    # working and not just implicitly working because of insertion order.

    # This causes the test to actually fail if the deps are not wired up correctly.
    random.seed(0)
    entries = list(system._instances.items())
    random.shuffle(entries)
    system._instances = {k: v for k, v in entries}

    system.start()
    assert data.starts == ["D", "C", "B", "A"]
    system.stop()
    assert data.stops == ["A", "B", "C", "D"]


class ComponentZ(Component):
    def __init__(self, system: System):
        super().__init__(system)
        self.require(ComponentC)

    @overrides
    def start(self) -> None:
        pass

    @overrides
    def stop(self) -> None:
        pass


def test_runtime_dependencies() -> None:
    settings = Settings()
    system = System(settings)

    reset()

    # Nothing to do, no components were requested prior to start
    system.start()
    assert data.starts == []

    # Constructs dependencies and starts them in the correct order
    ComponentZ(system)
    assert data.starts == ["D", "C"]
    system.stop()
    assert data.stops == ["C", "D"]
