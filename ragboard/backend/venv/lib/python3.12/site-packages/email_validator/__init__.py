# -*- coding: utf-8 -*-

# Export the main method, helper methods, and the public data types.
from .exceptions_types import ValidatedEmail, EmailNotValidError, \
                              EmailSyntaxError, EmailUndeliverableError
from .validate_email import validate_email
from .version import __version__

__all__ = ["validate_email",
           "ValidatedEmail", "EmailNotValidError",
           "EmailSyntaxError", "EmailUndeliverableError",
           "caching_resolver", "__version__"]


def caching_resolver(*args, **kwargs):
    # Lazy load `deliverability` as it is slow to import (due to dns.resolver)
    from .deliverability import caching_resolver

    return caching_resolver(*args, **kwargs)


# These global attributes are a part of the library's API and can be
# changed by library users.

# Default values for keyword arguments.

ALLOW_SMTPUTF8 = True
ALLOW_QUOTED_LOCAL = False
ALLOW_DOMAIN_LITERAL = False
GLOBALLY_DELIVERABLE = True
CHECK_DELIVERABILITY = True
TEST_ENVIRONMENT = False
DEFAULT_TIMEOUT = 15  # secs

# IANA Special Use Domain Names
# Last Updated 2021-09-21
# https://www.iana.org/assignments/special-use-domain-names/special-use-domain-names.txt
#
# The domain names without dots would be caught by the check that the domain
# name in an email address must have a period, but this list will also catch
# subdomains of these domains, which are also reserved.
SPECIAL_USE_DOMAIN_NAMES = [
    # The "arpa" entry here is consolidated from a lot of arpa subdomains
    # for private address (i.e. non-routable IP addresses like 172.16.x.x)
    # reverse mapping, plus some other subdomains. Although RFC 6761 says
    # that application software should not treat these domains as special,
    # they are private-use domains and so cannot have globally deliverable
    # email addresses, which is an assumption of this library, and probably
    # all of arpa is similarly special-use, so we reject it all.
    "arpa",

    # RFC 6761 says applications "SHOULD NOT" treat the "example" domains
    # as special, i.e. applications should accept these domains.
    #
    # The domain "example" alone fails our syntax validation because it
    # lacks a dot (we assume no one has an email address on a TLD directly).
    # "@example.com/net/org" will currently fail DNS-based deliverability
    # checks because IANA publishes a NULL MX for these domains, and
    # "@mail.example[.com/net/org]" and other subdomains will fail DNS-
    # based deliverability checks because IANA does not publish MX or A
    # DNS records for these subdomains.
    # "example", # i.e. "wwww.example"
    # "example.com",
    # "example.net",
    # "example.org",

    # RFC 6761 says that applications are permitted to treat this domain
    # as special and that DNS should return an immediate negative response,
    # so we also immediately reject this domain, which also follows the
    # purpose of the domain.
    "invalid",

    # RFC 6762 says that applications "may" treat ".local" as special and
    # that "name resolution APIs and libraries SHOULD recognize these names
    # as special," and since ".local" has no global definition, we reject
    # it, as we expect email addresses to be gloally routable.
    "local",

    # RFC 6761 says that applications (like this library) are permitted
    # to treat "localhost" as special, and since it cannot have a globally
    # deliverable email address, we reject it.
    "localhost",

    # RFC 7686 says "applications that do not implement the Tor protocol
    # SHOULD generate an error upon the use of .onion and SHOULD NOT
    # perform a DNS lookup.
    "onion",

    # Although RFC 6761 says that application software should not treat
    # these domains as special, it also warns users that the address may
    # resolve differently in different systems, and therefore it cannot
    # have a globally routable email address, which is an assumption of
    # this library, so we reject "@test" and "@*.test" addresses, unless
    # the test_environment keyword argument is given, to allow their use
    # in application-level test environments. These domains will generally
    # fail deliverability checks because "test" is not an actual TLD.
    "test",
]
