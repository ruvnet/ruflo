"""AMQP Spec."""

from collections import namedtuple

method_t = namedtuple('method_t', ('method_sig', 'args', 'content'))


def method(method_sig, args=None, content=False):
    """Create amqp method specification tuple."""
    return method_t(method_sig, args, content)


class Connection:
    """AMQ Connection class."""

    CLASS_ID = 10

    Start = (10, 10)
    StartOk = (10, 11)
    Secure = (10, 20)
    SecureOk = (10, 21)
    Tune = (10, 30)
    TuneOk = (10, 31)
    Open = (10, 40)
    OpenOk = (10, 41)
    Close = (10, 50)
    CloseOk = (10, 51)
    Blocked = (10, 60)
    Unblocked = (10, 61)


class Channel:
    """AMQ Channel class."""

    CLASS_ID = 20

    Open = (20, 10)
    OpenOk = (20, 11)
    Flow = (20, 20)
    FlowOk = (20, 21)
    Close = (20, 40)
    CloseOk = (20, 41)


class Exchange:
    """AMQ Exchange class."""

    CLASS_ID = 40

    Declare = (40, 10)
    DeclareOk = (40, 11)
    Delete = (40, 20)
    DeleteOk = (40, 21)
    Bind = (40, 30)
    BindOk = (40, 31)
    Unbind = (40, 40)
    UnbindOk = (40, 51)


class Queue:
    """AMQ Queue class."""

    CLASS_ID = 50

    Declare = (50, 10)
    DeclareOk = (50, 11)
    Bind = (50, 20)
    BindOk = (50, 21)
    Purge = (50, 30)
    PurgeOk = (50, 31)
    Delete = (50, 40)
    DeleteOk = (50, 41)
    Unbind = (50, 50)
    UnbindOk = (50, 51)


class Basic:
    """AMQ Basic class."""

    CLASS_ID = 60

    Qos = (60, 10)
    QosOk = (60, 11)
    Consume = (60, 20)
    ConsumeOk = (60, 21)
    Cancel = (60, 30)
    CancelOk = (60, 31)
    Publish = (60, 40)
    Return = (60, 50)
    Deliver = (60, 60)
    Get = (60, 70)
    GetOk = (60, 71)
    GetEmpty = (60, 72)
    Ack = (60, 80)
    Nack = (60, 120)
    Reject = (60, 90)
    RecoverAsync = (60, 100)
    Recover = (60, 110)
    RecoverOk = (60, 111)


class Confirm:
    """AMQ Confirm class."""

    CLASS_ID = 85

    Select = (85, 10)
    SelectOk = (85, 11)


class Tx:
    """AMQ Tx class."""

    CLASS_ID = 90

    Select = (90, 10)
    SelectOk = (90, 11)
    Commit = (90, 20)
    CommitOk = (90, 21)
    Rollback = (90, 30)
    RollbackOk = (90, 31)
