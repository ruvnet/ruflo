# A command-line tool for testing.
#
# Usage:
#
# python -m email_validator test@example.org
# python -m email_validator < LIST_OF_ADDRESSES.TXT
#
# Provide email addresses to validate either as a command-line argument
# or in STDIN separated by newlines. Validation errors will be printed for
# invalid email addresses. When passing an email address on the command
# line, if the email address is valid, information about it will be printed.
# When using STDIN, no output will be given for valid email addresses.
#
# Keyword arguments to validate_email can be set in environment variables
# of the same name but upprcase (see below).

import json
import os
import sys

from .validate_email import validate_email
from .deliverability import caching_resolver
from .exceptions_types import EmailNotValidError


def main(dns_resolver=None):
    # The dns_resolver argument is for tests.

    # Set options from environment variables.
    options = {}
    for varname in ('ALLOW_SMTPUTF8', 'ALLOW_QUOTED_LOCAL', 'ALLOW_DOMAIN_LITERAL',
                    'GLOBALLY_DELIVERABLE', 'CHECK_DELIVERABILITY', 'TEST_ENVIRONMENT'):
        if varname in os.environ:
            options[varname.lower()] = bool(os.environ[varname])
    for varname in ('DEFAULT_TIMEOUT',):
        if varname in os.environ:
            options[varname.lower()] = float(os.environ[varname])

    if len(sys.argv) == 1:
        # Validate the email addresses pased line-by-line on STDIN.
        dns_resolver = dns_resolver or caching_resolver()
        for line in sys.stdin:
            email = line.strip()
            try:
                validate_email(email, dns_resolver=dns_resolver, **options)
            except EmailNotValidError as e:
                print(f"{email} {e}")
    else:
        # Validate the email address passed on the command line.
        email = sys.argv[1]
        try:
            result = validate_email(email, dns_resolver=dns_resolver, **options)
            print(json.dumps(result.as_dict(), indent=2, sort_keys=True, ensure_ascii=False))
        except EmailNotValidError as e:
            print(e)


if __name__ == "__main__":
    main()
