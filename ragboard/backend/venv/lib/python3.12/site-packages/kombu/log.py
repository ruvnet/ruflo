"""Logging Utilities."""

from __future__ import annotations

import logging
import numbers
import os
import sys
from logging.handlers import WatchedFileHandler
from typing import TYPE_CHECKING

from .utils.encoding import safe_repr, safe_str
from .utils.functional import maybe_evaluate
from .utils.objects import cached_property

if TYPE_CHECKING:
    from logging import Logger

__all__ = ('LogMixin', 'LOG_LEVELS', 'get_loglevel', 'setup_logging')

LOG_LEVELS = dict(logging._nameToLevel)
LOG_LEVELS.update(logging._levelToName)
LOG_LEVELS.setdefault('FATAL', logging.FATAL)
LOG_LEVELS.setdefault(logging.FATAL, 'FATAL')
DISABLE_TRACEBACKS = os.environ.get('DISABLE_TRACEBACKS')


def get_logger(logger: str | Logger):
    """Get logger by name."""
    if isinstance(logger, str):
        logger = logging.getLogger(logger)
    if not logger.handlers:
        logger.addHandler(logging.NullHandler())
    return logger


def get_loglevel(level):
    """Get loglevel by name."""
    if isinstance(level, str):
        return LOG_LEVELS[level]
    return level


def naive_format_parts(fmt):
    parts = fmt.split('%')
    for i, e in enumerate(parts[1:]):
        yield None if not e or not parts[i - 1] else e[0]


def safeify_format(fmt, args, filters=None):
    filters = {'s': safe_str, 'r': safe_repr} if not filters else filters
    for index, type in enumerate(naive_format_parts(fmt)):
        filt = filters.get(type)
        yield filt(args[index]) if filt else args[index]


class LogMixin:
    """Mixin that adds severity methods to any class."""

    def debug(self, *args, **kwargs):
        return self.log(logging.DEBUG, *args, **kwargs)

    def info(self, *args, **kwargs):
        return self.log(logging.INFO, *args, **kwargs)

    def warn(self, *args, **kwargs):
        return self.log(logging.WARN, *args, **kwargs)

    def error(self, *args, **kwargs):
        kwargs.setdefault('exc_info', True)
        return self.log(logging.ERROR, *args, **kwargs)

    def critical(self, *args, **kwargs):
        kwargs.setdefault('exc_info', True)
        return self.log(logging.CRITICAL, *args, **kwargs)

    def annotate(self, text):
        return f'{self.logger_name} - {text}'

    def log(self, severity, *args, **kwargs):
        if DISABLE_TRACEBACKS:
            kwargs.pop('exc_info', None)
        if self.logger.isEnabledFor(severity):
            log = self.logger.log
            if len(args) > 1 and isinstance(args[0], str):
                expand = [maybe_evaluate(arg) for arg in args[1:]]
                return log(severity,
                           self.annotate(args[0].replace('%r', '%s')),
                           *list(safeify_format(args[0], expand)), **kwargs)
            else:
                return self.logger.log(
                    severity, self.annotate(' '.join(map(safe_str, args))),
                    **kwargs)

    def get_logger(self):
        return get_logger(self.logger_name)

    def is_enabled_for(self, level):
        return self.logger.isEnabledFor(self.get_loglevel(level))

    def get_loglevel(self, level):
        if not isinstance(level, numbers.Integral):
            return LOG_LEVELS[level]
        return level

    @cached_property
    def logger(self):
        return self.get_logger()

    @property
    def logger_name(self):
        return self.__class__.__name__


class Log(LogMixin):

    def __init__(self, name, logger=None):
        self._logger_name = name
        self._logger = logger

    def get_logger(self):
        if self._logger:
            return self._logger
        return super().get_logger()

    @property
    def logger_name(self):
        return self._logger_name


def setup_logging(loglevel=None, logfile=None):
    """Setup logging."""
    logger = logging.getLogger()
    loglevel = get_loglevel(loglevel or 'ERROR')
    logfile = logfile if logfile else sys.__stderr__
    if not logger.handlers:
        if hasattr(logfile, 'write'):
            handler = logging.StreamHandler(logfile)
        else:
            handler = WatchedFileHandler(logfile)
        logger.addHandler(handler)
        logger.setLevel(loglevel)
    return logger
