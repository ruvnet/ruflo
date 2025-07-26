"""A directed acyclic graph of reusable components."""

from collections import deque
from threading import Event

from kombu.common import ignore_errors
from kombu.utils.encoding import bytes_to_str
from kombu.utils.imports import symbol_by_name

from .utils.graph import DependencyGraph, GraphFormatter
from .utils.imports import instantiate, qualname
from .utils.log import get_logger

try:
    from greenlet import GreenletExit
except ImportError:
    IGNORE_ERRORS = ()
else:
    IGNORE_ERRORS = (GreenletExit,)

__all__ = ('Blueprint', 'Step', 'StartStopStep', 'ConsumerStep')

#: States
RUN = 0x1
CLOSE = 0x2
TERMINATE = 0x3

logger = get_logger(__name__)


def _pre(ns, fmt):
    return f'| {ns.alias}: {fmt}'


def _label(s):
    return s.name.rsplit('.', 1)[-1]


class StepFormatter(GraphFormatter):
    """Graph formatter for :class:`Blueprint`."""

    blueprint_prefix = '⧉'
    conditional_prefix = '∘'
    blueprint_scheme = {
        'shape': 'parallelogram',
        'color': 'slategray4',
        'fillcolor': 'slategray3',
    }

    def label(self, step):
        return step and '{}{}'.format(
            self._get_prefix(step),
            bytes_to_str(
                (step.label or _label(step)).encode('utf-8', 'ignore')),
        )

    def _get_prefix(self, step):
        if step.last:
            return self.blueprint_prefix
        if step.conditional:
            return self.conditional_prefix
        return ''

    def node(self, obj, **attrs):
        scheme = self.blueprint_scheme if obj.last else self.node_scheme
        return self.draw_node(obj, scheme, attrs)

    def edge(self, a, b, **attrs):
        if a.last:
            attrs.update(arrowhead='none', color='darkseagreen3')
        return self.draw_edge(a, b, self.edge_scheme, attrs)


class Blueprint:
    """Blueprint containing bootsteps that can be applied to objects.

    Arguments:
        steps Sequence[Union[str, Step]]: List of steps.
        name (str): Set explicit name for this blueprint.
        on_start (Callable): Optional callback applied after blueprint start.
        on_close (Callable): Optional callback applied before blueprint close.
        on_stopped (Callable): Optional callback applied after
            blueprint stopped.
    """

    GraphFormatter = StepFormatter

    name = None
    state = None
    started = 0
    default_steps = set()
    state_to_name = {
        0: 'initializing',
        RUN: 'running',
        CLOSE: 'closing',
        TERMINATE: 'terminating',
    }

    def __init__(self, steps=None, name=None,
                 on_start=None, on_close=None, on_stopped=None):
        self.name = name or self.name or qualname(type(self))
        self.types = set(steps or []) | set(self.default_steps)
        self.on_start = on_start
        self.on_close = on_close
        self.on_stopped = on_stopped
        self.shutdown_complete = Event()
        self.steps = {}

    def start(self, parent):
        self.state = RUN
        if self.on_start:
            self.on_start()
        for i, step in enumerate(s for s in parent.steps if s is not None):
            self._debug('Starting %s', step.alias)
            self.started = i + 1
            step.start(parent)
            logger.debug('^-- substep ok')

    def human_state(self):
        return self.state_to_name[self.state or 0]

    def info(self, parent):
        info = {}
        for step in parent.steps:
            info.update(step.info(parent) or {})
        return info

    def close(self, parent):
        if self.on_close:
            self.on_close()
        self.send_all(parent, 'close', 'closing', reverse=False)

    def restart(self, parent, method='stop',
                description='restarting', propagate=False):
        self.send_all(parent, method, description, propagate=propagate)

    def send_all(self, parent, method,
                 description=None, reverse=True, propagate=True, args=()):
        description = description or method.replace('_', ' ')
        steps = reversed(parent.steps) if reverse else parent.steps
        for step in steps:
            if step:
                fun = getattr(step, method, None)
                if fun is not None:
                    self._debug('%s %s...',
                                description.capitalize(), step.alias)
                    try:
                        fun(parent, *args)
                    except Exception as exc:  # pylint: disable=broad-except
                        if propagate:
                            raise
                        logger.exception(
                            'Error on %s %s: %r', description, step.alias, exc)

    def stop(self, parent, close=True, terminate=False):
        what = 'terminating' if terminate else 'stopping'
        if self.state in (CLOSE, TERMINATE):
            return

        if self.state != RUN or self.started != len(parent.steps):
            # Not fully started, can safely exit.
            self.state = TERMINATE
            self.shutdown_complete.set()
            return
        self.close(parent)
        self.state = CLOSE

        self.restart(
            parent, 'terminate' if terminate else 'stop',
            description=what, propagate=False,
        )

        if self.on_stopped:
            self.on_stopped()
        self.state = TERMINATE
        self.shutdown_complete.set()

    def join(self, timeout=None):
        try:
            # Will only get here if running green,
            # makes sure all greenthreads have exited.
            self.shutdown_complete.wait(timeout=timeout)
        except IGNORE_ERRORS:
            pass

    def apply(self, parent, **kwargs):
        """Apply the steps in this blueprint to an object.

        This will apply the ``__init__`` and ``include`` methods
        of each step, with the object as argument::

            step = Step(obj)
            ...
            step.include(obj)

        For :class:`StartStopStep` the services created
        will also be added to the objects ``steps`` attribute.
        """
        self._debug('Preparing bootsteps.')
        order = self.order = []
        steps = self.steps = self.claim_steps()

        self._debug('Building graph...')
        for S in self._finalize_steps(steps):
            step = S(parent, **kwargs)
            steps[step.name] = step
            order.append(step)
        self._debug('New boot order: {%s}',
                    ', '.join(s.alias for s in self.order))
        for step in order:
            step.include(parent)
        return self

    def connect_with(self, other):
        self.graph.adjacent.update(other.graph.adjacent)
        self.graph.add_edge(type(other.order[0]), type(self.order[-1]))

    def __getitem__(self, name):
        return self.steps[name]

    def _find_last(self):
        return next((C for C in self.steps.values() if C.last), None)

    def _firstpass(self, steps):
        for step in steps.values():
            step.requires = [symbol_by_name(dep) for dep in step.requires]
        stream = deque(step.requires for step in steps.values())
        while stream:
            for node in stream.popleft():
                node = symbol_by_name(node)
                if node.name not in self.steps:
                    steps[node.name] = node
                stream.append(node.requires)

    def _finalize_steps(self, steps):
        last = self._find_last()
        self._firstpass(steps)
        it = ((C, C.requires) for C in steps.values())
        G = self.graph = DependencyGraph(
            it, formatter=self.GraphFormatter(root=last),
        )
        if last:
            for obj in G:
                if obj != last:
                    G.add_edge(last, obj)
        try:
            return G.topsort()
        except KeyError as exc:
            raise KeyError('unknown bootstep: %s' % exc)

    def claim_steps(self):
        return dict(self.load_step(step) for step in self.types)

    def load_step(self, step):
        step = symbol_by_name(step)
        return step.name, step

    def _debug(self, msg, *args):
        return logger.debug(_pre(self, msg), *args)

    @property
    def alias(self):
        return _label(self)


class StepType(type):
    """Meta-class for steps."""

    name = None
    requires = None

    def __new__(cls, name, bases, attrs):
        module = attrs.get('__module__')
        qname = f'{module}.{name}' if module else name
        attrs.update(
            __qualname__=qname,
            name=attrs.get('name') or qname,
        )
        return super().__new__(cls, name, bases, attrs)

    def __str__(cls):
        return cls.name

    def __repr__(cls):
        return 'step:{0.name}{{{0.requires!r}}}'.format(cls)


class Step(metaclass=StepType):
    """A Bootstep.

    The :meth:`__init__` method is called when the step
    is bound to a parent object, and can as such be used
    to initialize attributes in the parent object at
    parent instantiation-time.
    """

    #: Optional step name, will use ``qualname`` if not specified.
    name = None

    #: Optional short name used for graph outputs and in logs.
    label = None

    #: Set this to true if the step is enabled based on some condition.
    conditional = False

    #: List of other steps that that must be started before this step.
    #: Note that all dependencies must be in the same blueprint.
    requires = ()

    #: This flag is reserved for the workers Consumer,
    #: since it is required to always be started last.
    #: There can only be one object marked last
    #: in every blueprint.
    last = False

    #: This provides the default for :meth:`include_if`.
    enabled = True

    def __init__(self, parent, **kwargs):
        pass

    def include_if(self, parent):
        """Return true if bootstep should be included.

        You can define this as an optional predicate that decides whether
        this step should be created.
        """
        return self.enabled

    def instantiate(self, name, *args, **kwargs):
        return instantiate(name, *args, **kwargs)

    def _should_include(self, parent):
        if self.include_if(parent):
            return True, self.create(parent)
        return False, None

    def include(self, parent):
        return self._should_include(parent)[0]

    def create(self, parent):
        """Create the step."""

    def __repr__(self):
        return f'<step: {self.alias}>'

    @property
    def alias(self):
        return self.label or _label(self)

    def info(self, obj):
        pass


class StartStopStep(Step):
    """Bootstep that must be started and stopped in order."""

    #: Optional obj created by the :meth:`create` method.
    #: This is used by :class:`StartStopStep` to keep the
    #: original service object.
    obj = None

    def start(self, parent):
        if self.obj:
            return self.obj.start()

    def stop(self, parent):
        if self.obj:
            return self.obj.stop()

    def close(self, parent):
        pass

    def terminate(self, parent):
        if self.obj:
            return getattr(self.obj, 'terminate', self.obj.stop)()

    def include(self, parent):
        inc, ret = self._should_include(parent)
        if inc:
            self.obj = ret
            parent.steps.append(self)
        return inc


class ConsumerStep(StartStopStep):
    """Bootstep that starts a message consumer."""

    requires = ('celery.worker.consumer:Connection',)
    consumers = None

    def get_consumers(self, channel):
        raise NotImplementedError('missing get_consumers')

    def start(self, c):
        channel = c.connection.channel()
        self.consumers = self.get_consumers(channel)
        for consumer in self.consumers or []:
            consumer.consume()

    def stop(self, c):
        self._close(c, True)

    def shutdown(self, c):
        self._close(c, False)

    def _close(self, c, cancel_consumers=True):
        channels = set()
        for consumer in self.consumers or []:
            if cancel_consumers:
                ignore_errors(c.connection, consumer.cancel)
            if consumer.channel:
                channels.add(consumer.channel)
        for channel in channels:
            ignore_errors(c.connection, channel.close)
