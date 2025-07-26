from typing import Optional, Union

from .exceptions_types import EmailSyntaxError, ValidatedEmail
from .syntax import split_email, validate_email_local_part, validate_email_domain_name, validate_email_domain_literal, validate_email_length
from .rfc_constants import CASE_INSENSITIVE_MAILBOX_NAMES


def validate_email(
    email: Union[str, bytes],
    /,  # prior arguments are positional-only
    *,  # subsequent arguments are keyword-only
    allow_smtputf8: Optional[bool] = None,
    allow_empty_local: bool = False,
    allow_quoted_local: Optional[bool] = None,
    allow_domain_literal: Optional[bool] = None,
    check_deliverability: Optional[bool] = None,
    test_environment: Optional[bool] = None,
    globally_deliverable: Optional[bool] = None,
    timeout: Optional[int] = None,
    dns_resolver: Optional[object] = None
) -> ValidatedEmail:
    """
    Given an email address, and some options, returns a ValidatedEmail instance
    with information about the address if it is valid or, if the address is not
    valid, raises an EmailNotValidError. This is the main function of the module.
    """

    # Fill in default values of arguments.
    from . import ALLOW_SMTPUTF8, ALLOW_QUOTED_LOCAL, ALLOW_DOMAIN_LITERAL, \
        GLOBALLY_DELIVERABLE, CHECK_DELIVERABILITY, TEST_ENVIRONMENT, DEFAULT_TIMEOUT
    if allow_smtputf8 is None:
        allow_smtputf8 = ALLOW_SMTPUTF8
    if allow_quoted_local is None:
        allow_quoted_local = ALLOW_QUOTED_LOCAL
    if allow_domain_literal is None:
        allow_domain_literal = ALLOW_DOMAIN_LITERAL
    if check_deliverability is None:
        check_deliverability = CHECK_DELIVERABILITY
    if test_environment is None:
        test_environment = TEST_ENVIRONMENT
    if globally_deliverable is None:
        globally_deliverable = GLOBALLY_DELIVERABLE
    if timeout is None and dns_resolver is None:
        timeout = DEFAULT_TIMEOUT

    # Allow email to be a str or bytes instance. If bytes,
    # it must be ASCII because that's how the bytes work
    # on the wire with SMTP.
    if not isinstance(email, str):
        try:
            email = email.decode("ascii")
        except ValueError:
            raise EmailSyntaxError("The email address is not valid ASCII.")

    # Split the address into the local part (before the @-sign)
    # and the domain part (after the @-sign). Normally, there
    # is only one @-sign. But the awkward "quoted string" local
    # part form (RFC 5321 4.1.2) allows @-signs in the local
    # part if the local part is quoted.
    local_part, domain_part, is_quoted_local_part \
        = split_email(email)

    # Collect return values in this instance.
    ret = ValidatedEmail()
    ret.original = email

    # Validate the email address's local part syntax and get a normalized form.
    # If the original address was quoted and the decoded local part is a valid
    # unquoted local part, then we'll get back a normalized (unescaped) local
    # part.
    local_part_info = validate_email_local_part(local_part,
                                                allow_smtputf8=allow_smtputf8,
                                                allow_empty_local=allow_empty_local,
                                                quoted_local_part=is_quoted_local_part)
    ret.local_part = local_part_info["local_part"]
    ret.ascii_local_part = local_part_info["ascii_local_part"]
    ret.smtputf8 = local_part_info["smtputf8"]

    # If a quoted local part isn't allowed but is present, now raise an exception.
    # This is done after any exceptions raised by validate_email_local_part so
    # that mandatory checks have highest precedence.
    if is_quoted_local_part and not allow_quoted_local:
        raise EmailSyntaxError("Quoting the part before the @-sign is not allowed here.")

    # Some local parts are required to be case-insensitive, so we should normalize
    # to lowercase.
    # RFC 2142
    if ret.ascii_local_part is not None \
       and ret.ascii_local_part.lower() in CASE_INSENSITIVE_MAILBOX_NAMES \
       and ret.local_part is not None:
        ret.ascii_local_part = ret.ascii_local_part.lower()
        ret.local_part = ret.local_part.lower()

    # Validate the email address's domain part syntax and get a normalized form.
    is_domain_literal = False
    if len(domain_part) == 0:
        raise EmailSyntaxError("There must be something after the @-sign.")

    elif domain_part.startswith("[") and domain_part.endswith("]"):
        # Parse the address in the domain literal and get back a normalized domain.
        domain_part_info = validate_email_domain_literal(domain_part[1:-1])
        if not allow_domain_literal:
            raise EmailSyntaxError("A bracketed IP address after the @-sign is not allowed here.")
        ret.domain = domain_part_info["domain"]
        ret.ascii_domain = domain_part_info["domain"]  # Domain literals are always ASCII.
        ret.domain_address = domain_part_info["domain_address"]
        is_domain_literal = True  # Prevent deliverability checks.

    else:
        # Check the syntax of the domain and get back a normalized
        # internationalized and ASCII form.
        domain_part_info = validate_email_domain_name(domain_part, test_environment=test_environment, globally_deliverable=globally_deliverable)
        ret.domain = domain_part_info["domain"]
        ret.ascii_domain = domain_part_info["ascii_domain"]

    # Construct the complete normalized form.
    ret.normalized = ret.local_part + "@" + ret.domain

    # If the email address has an ASCII form, add it.
    if not ret.smtputf8:
        if not ret.ascii_domain:
            raise Exception("Missing ASCII domain.")
        ret.ascii_email = (ret.ascii_local_part or "") + "@" + ret.ascii_domain
    else:
        ret.ascii_email = None

    # Check the length of the address.
    validate_email_length(ret)

    if check_deliverability and not test_environment:
        # Validate the email address's deliverability using DNS
        # and update the returned ValidatedEmail object with metadata.

        if is_domain_literal:
            # There is nothing to check --- skip deliverability checks.
            return ret

        # Lazy load `deliverability` as it is slow to import (due to dns.resolver)
        from .deliverability import validate_email_deliverability
        deliverability_info = validate_email_deliverability(
            ret.ascii_domain, ret.domain, timeout, dns_resolver
        )
        for key, value in deliverability_info.items():
            setattr(ret, key, value)

    return ret
