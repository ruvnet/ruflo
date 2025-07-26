from .exceptions_types import EmailSyntaxError
from .rfc_constants import EMAIL_MAX_LENGTH, LOCAL_PART_MAX_LENGTH, DOMAIN_MAX_LENGTH, \
    DOT_ATOM_TEXT, DOT_ATOM_TEXT_INTL, ATEXT_RE, ATEXT_INTL_RE, ATEXT_HOSTNAME_INTL, QTEXT_INTL, \
    DNS_LABEL_LENGTH_LIMIT, DOT_ATOM_TEXT_HOSTNAME, DOMAIN_NAME_REGEX, DOMAIN_LITERAL_CHARS, \
    QUOTED_LOCAL_PART_ADDR

import re
import unicodedata
import idna  # implements IDNA 2008; Python's codec is only IDNA 2003
import ipaddress
from typing import Optional


def split_email(email):
    # Return the local part and domain part of the address and
    # whether the local part was quoted as a three-tuple.

    # Typical email addresses have a single @-sign, but the
    # awkward "quoted string" local part form (RFC 5321 4.1.2)
    # allows @-signs (and escaped quotes) to appear in the local
    # part if the local part is quoted. If the address is quoted,
    # split it at a non-escaped @-sign and unescape the escaping.
    if m := QUOTED_LOCAL_PART_ADDR.match(email):
        local_part, domain_part = m.groups()

        # Since backslash-escaping is no longer needed because
        # the quotes are removed, remove backslash-escaping
        # to return in the normalized form.
        import re
        local_part = re.sub(r"\\(.)", "\\1", local_part)

        return local_part, domain_part, True

    else:
        # Split at the one and only at-sign.
        parts = email.split('@')
        if len(parts) != 2:
            raise EmailSyntaxError("The email address is not valid. It must have exactly one @-sign.")
        local_part, domain_part = parts
        return local_part, domain_part, False


def get_length_reason(addr, utf8=False, limit=EMAIL_MAX_LENGTH):
    """Helper function to return an error message related to invalid length."""
    diff = len(addr) - limit
    prefix = "at least " if utf8 else ""
    suffix = "s" if diff > 1 else ""
    return f"({prefix}{diff} character{suffix} too many)"


def safe_character_display(c):
    # Return safely displayable characters in quotes.
    if c == '\\':
        return f"\"{c}\""  # can't use repr because it escapes it
    if unicodedata.category(c)[0] in ("L", "N", "P", "S"):
        return repr(c)

    # Construct a hex string in case the unicode name doesn't exist.
    if ord(c) < 0xFFFF:
        h = f"U+{ord(c):04x}".upper()
    else:
        h = f"U+{ord(c):08x}".upper()

    # Return the character name or, if it has no name, the hex string.
    return unicodedata.name(c, h)


def validate_email_local_part(local: str, allow_smtputf8: bool = True, allow_empty_local: bool = False,
                              quoted_local_part: bool = False):
    """Validates the syntax of the local part of an email address."""

    if len(local) == 0:
        if not allow_empty_local:
            raise EmailSyntaxError("There must be something before the @-sign.")
        else:
            # The caller allows an empty local part. Useful for validating certain
            # Postfix aliases.
            return {
                "local_part": local,
                "ascii_local_part": local,
                "smtputf8": False,
            }

    # Check the length of the local part by counting characters.
    # (RFC 5321 4.5.3.1.1)
    # We're checking the number of characters here. If the local part
    # is ASCII-only, then that's the same as bytes (octets). If it's
    # internationalized, then the UTF-8 encoding may be longer, but
    # that may not be relevant. We will check the total address length
    # instead.
    if len(local) > LOCAL_PART_MAX_LENGTH:
        reason = get_length_reason(local, limit=LOCAL_PART_MAX_LENGTH)
        raise EmailSyntaxError(f"The email address is too long before the @-sign {reason}.")

    # Check the local part against the non-internationalized regular expression.
    # Most email addresses match this regex so it's probably fastest to check this first.
    # (RFC 5322 3.2.3)
    # All local parts matching the dot-atom rule are also valid as a quoted string
    # so if it was originally quoted (quoted_local_part is True) and this regex matches,
    # it's ok.
    # (RFC 5321 4.1.2 / RFC 5322 3.2.4).
    if DOT_ATOM_TEXT.match(local):
        # It's valid. And since it's just the permitted ASCII characters,
        # it's normalized and safe. If the local part was originally quoted,
        # the quoting was unnecessary and it'll be returned as normalized to
        # non-quoted form.

        # Return the local part and flag that SMTPUTF8 is not needed.
        return {
            "local_part": local,
            "ascii_local_part": local,
            "smtputf8": False,
        }

    # The local part failed the basic dot-atom check. Try the extended character set
    # for internationalized addresses. It's the same pattern but with additional
    # characters permitted.
    # RFC 6531 section 3.3.
    valid: Optional[str] = None
    requires_smtputf8 = False
    if DOT_ATOM_TEXT_INTL.match(local):
        # But international characters in the local part may not be permitted.
        if not allow_smtputf8:
            # Check for invalid characters against the non-internationalized
            # permitted character set.
            # (RFC 5322 3.2.3)
            bad_chars = set(
                safe_character_display(c)
                for c in local
                if not ATEXT_RE.match(c)
            )
            if bad_chars:
                raise EmailSyntaxError("Internationalized characters before the @-sign are not supported: " + ", ".join(sorted(bad_chars)) + ".")

            # Although the check above should always find something, fall back to this just in case.
            raise EmailSyntaxError("Internationalized characters before the @-sign are not supported.")

        # It's valid.
        valid = "dot-atom"
        requires_smtputf8 = True

    # There are no syntactic restrictions on quoted local parts, so if
    # it was originally quoted, it is probably valid. More characters
    # are allowed, like @-signs, spaces, and quotes, and there are no
    # restrictions on the placement of dots, as in dot-atom local parts.
    elif quoted_local_part:
        # Check for invalid characters in a quoted string local part.
        # (RFC 5321 4.1.2. RFC 5322 lists additional permitted *obsolete*
        # characters which are *not* allowed here. RFC 6531 section 3.3
        # extends the range to UTF8 strings.)
        bad_chars = set(
            safe_character_display(c)
            for c in local
            if not QTEXT_INTL.match(c)
        )
        if bad_chars:
            raise EmailSyntaxError("The email address contains invalid characters in quotes before the @-sign: " + ", ".join(sorted(bad_chars)) + ".")

        # See if any characters are outside of the ASCII range.
        bad_chars = set(
            safe_character_display(c)
            for c in local
            if not (32 <= ord(c) <= 126)
        )
        if bad_chars:
            requires_smtputf8 = True

            # International characters in the local part may not be permitted.
            if not allow_smtputf8:
                raise EmailSyntaxError("Internationalized characters before the @-sign are not supported: " + ", ".join(sorted(bad_chars)) + ".")

        # It's valid.
        valid = "quoted"

    # If the local part matches the internationalized dot-atom form or was quoted,
    # perform normalization and additional checks for Unicode strings.
    if valid:
        # RFC 6532 section 3.1 says that Unicode NFC normalization should be applied,
        # so we'll return the normalized local part in the return value.
        local = unicodedata.normalize("NFC", local)

        # Check that the local part is a valid, safe, and sensible Unicode string.
        # Some of this may be redundant with the range U+0080 to U+10FFFF that is checked
        # by DOT_ATOM_TEXT_INTL and QTEXT_INTL. Other characters may be permitted by the
        # email specs, but they may not be valid, safe, or sensible Unicode strings.
        # See the function for rationale.
        check_unsafe_chars(local, allow_space=(valid == "quoted"))

        # Try encoding to UTF-8. Failure is possible with some characters like
        # surrogate code points, but those are checked above. Still, we don't
        # want to have an unhandled exception later.
        try:
            local.encode("utf8")
        except ValueError:
            raise EmailSyntaxError("The email address contains an invalid character.")

        # If this address passes only by the quoted string form, re-quote it
        # and backslash-escape quotes and backslashes (removing any unnecessary
        # escapes). Per RFC 5321 4.1.2, "all quoted forms MUST be treated as equivalent,
        # and the sending system SHOULD transmit the form that uses the minimum quoting possible."
        if valid == "quoted":
            local = '"' + re.sub(r'(["\\])', r'\\\1', local) + '"'

        return {
            "local_part": local,
            "ascii_local_part": local if not requires_smtputf8 else None,
            "smtputf8": requires_smtputf8,
        }

    # It's not a valid local part. Let's find out why.
    # (Since quoted local parts are all valid or handled above, these checks
    # don't apply in those cases.)

    # Check for invalid characters.
    # (RFC 5322 3.2.3, plus RFC 6531 3.3)
    bad_chars = set(
        safe_character_display(c)
        for c in local
        if not ATEXT_INTL_RE.match(c)
    )
    if bad_chars:
        raise EmailSyntaxError("The email address contains invalid characters before the @-sign: " + ", ".join(sorted(bad_chars)) + ".")

    # Check for dot errors imposted by the dot-atom rule.
    # (RFC 5322 3.2.3)
    check_dot_atom(local, 'An email address cannot start with a {}.', 'An email address cannot have a {} immediately before the @-sign.', is_hostname=False)

    # All of the reasons should already have been checked, but just in case
    # we have a fallback message.
    raise EmailSyntaxError("The email address contains invalid characters before the @-sign.")


def check_unsafe_chars(s, allow_space=False):
    # Check for unsafe characters or characters that would make the string
    # invalid or non-sensible Unicode.
    bad_chars = set()
    for i, c in enumerate(s):
        category = unicodedata.category(c)
        if category[0] in ("L", "N", "P", "S"):
            # Letters, numbers, punctuation, and symbols are permitted.
            pass
        elif category[0] == "M":
            # Combining character in first position would combine with something
            # outside of the email address if concatenated, so they are not safe.
            # We also check if this occurs after the @-sign, which would not be
            # sensible.
            if i == 0:
                bad_chars.add(c)
        elif category == "Zs":
            # Spaces outside of the ASCII range are not specifically disallowed in
            # internationalized addresses as far as I can tell, but they violate
            # the spirit of the non-internationalized specification that email
            # addresses do not contain ASCII spaces when not quoted. Excluding
            # ASCII spaces when not quoted is handled directly by the atom regex.
            #
            # In quoted-string local parts, spaces are explicitly permitted, and
            # the ASCII space has category Zs, so we must allow it here, and we'll
            # allow all Unicode spaces to be consistent.
            if not allow_space:
                bad_chars.add(c)
        elif category[0] == "Z":
            # The two line and paragraph separator characters (in categories Zl and Zp)
            # are not specifically disallowed in internationalized addresses
            # as far as I can tell, but they violate the spirit of the non-internationalized
            # specification that email addresses do not contain line breaks when not quoted.
            bad_chars.add(c)
        elif category[0] in ("C", "Z"):
            # Control, format, surrogate, private use, and unassigned code points (C)
            # are all unsafe in various ways. Control and format characters can affect
            # text rendering if the email address is concatenated with other text.
            # Bidirectional format characters are unsafe, even if used properly, because
            # they cause an email address to render as a different email address.
            # Private use characters do not make sense for publicly deliverable
            # email addresses.
            bad_chars.add(c)
        else:
            # All categories should be handled above, but in case there is something new
            # to the Unicode specification in the future, reject all other categories.
            bad_chars.add(c)
    if bad_chars:
        raise EmailSyntaxError("The email address contains unsafe characters: "
                               + ", ".join(safe_character_display(c) for c in sorted(bad_chars)) + ".")


def check_dot_atom(label, start_descr, end_descr, is_hostname):
    # RFC 5322 3.2.3
    if label.endswith("."):
        raise EmailSyntaxError(end_descr.format("period"))
    if label.startswith("."):
        raise EmailSyntaxError(start_descr.format("period"))
    if ".." in label:
        raise EmailSyntaxError("An email address cannot have two periods in a row.")

    if is_hostname:
        # RFC 952
        if label.endswith("-"):
            raise EmailSyntaxError(end_descr.format("hyphen"))
        if label.startswith("-"):
            raise EmailSyntaxError(start_descr.format("hyphen"))
        if ".-" in label or "-." in label:
            raise EmailSyntaxError("An email address cannot have a period and a hyphen next to each other.")


def validate_email_domain_name(domain, test_environment=False, globally_deliverable=True):
    """Validates the syntax of the domain part of an email address."""

    # Check for invalid characters before normalization.
    # (RFC 952 plus RFC 6531 section 3.3 for internationalized addresses)
    bad_chars = set(
        safe_character_display(c)
        for c in domain
        if not ATEXT_HOSTNAME_INTL.match(c)
    )
    if bad_chars:
        raise EmailSyntaxError("The part after the @-sign contains invalid characters: " + ", ".join(sorted(bad_chars)) + ".")

    # Check for unsafe characters.
    # Some of this may be redundant with the range U+0080 to U+10FFFF that is checked
    # by DOT_ATOM_TEXT_INTL. Other characters may be permitted by the email specs, but
    # they may not be valid, safe, or sensible Unicode strings.
    check_unsafe_chars(domain)

    # Perform UTS-46 normalization, which includes casefolding, NFC normalization,
    # and converting all label separators (the period/full stop, fullwidth full stop,
    # ideographic full stop, and halfwidth ideographic full stop) to basic periods.
    # It will also raise an exception if there is an invalid character in the input,
    # such as "⒈" which is invalid because it would expand to include a period.
    try:
        domain = idna.uts46_remap(domain, std3_rules=False, transitional=False)
    except idna.IDNAError as e:
        raise EmailSyntaxError(f"The part after the @-sign contains invalid characters ({e}).")

    # The domain part is made up period-separated "labels." Each label must
    # have at least one character and cannot start or end with dashes, which
    # means there are some surprising restrictions on periods and dashes.
    # Check that before we do IDNA encoding because the IDNA library gives
    # unfriendly errors for these cases, but after UTS-46 normalization because
    # it can insert periods and hyphens (from fullwidth characters).
    # (RFC 952, RFC 1123 2.1, RFC 5322 3.2.3)
    check_dot_atom(domain, 'An email address cannot have a {} immediately after the @-sign.', 'An email address cannot end with a {}.', is_hostname=True)

    # Check for RFC 5890's invalid R-LDH labels, which are labels that start
    # with two characters other than "xn" and two dashes.
    for label in domain.split("."):
        if re.match(r"(?!xn)..--", label, re.I):
            raise EmailSyntaxError("An email address cannot have two letters followed by two dashes immediately after the @-sign or after a period, except Punycode.")

    if DOT_ATOM_TEXT_HOSTNAME.match(domain):
        # This is a valid non-internationalized domain.
        ascii_domain = domain
    else:
        # If international characters are present in the domain name, convert
        # the domain to IDNA ASCII. If internationalized characters are present,
        # the MTA must either support SMTPUTF8 or the mail client must convert the
        # domain name to IDNA before submission.
        #
        # Unfortunately this step incorrectly 'fixes' domain names with leading
        # periods by removing them, so we have to check for this above. It also gives
        # a funky error message ("No input") when there are two periods in a
        # row, also checked separately above.
        #
        # For ASCII-only domains, the transformation does nothing and is safe to
        # apply. However, to ensure we don't rely on the idna library for basic
        # syntax checks, we don't use it if it's not needed.
        try:
            ascii_domain = idna.encode(domain, uts46=False).decode("ascii")
        except idna.IDNAError as e:
            if "Domain too long" in str(e):
                # We can't really be more specific because UTS-46 normalization means
                # the length check is applied to a string that is different from the
                # one the user supplied. Also I'm not sure if the length check applies
                # to the internationalized form, the IDNA ASCII form, or even both!
                raise EmailSyntaxError("The email address is too long after the @-sign.")
            raise EmailSyntaxError(f"The part after the @-sign contains invalid characters ({e}).")

        # Check the syntax of the string returned by idna.encode.
        # It should never fail.
        if not DOT_ATOM_TEXT_HOSTNAME.match(ascii_domain):
            raise EmailSyntaxError("The email address contains invalid characters after the @-sign after IDNA encoding.")

    # Check the length of the domain name in bytes.
    # (RFC 1035 2.3.4 and RFC 5321 4.5.3.1.2)
    # We're checking the number of bytes ("octets") here, which can be much
    # higher than the number of characters in internationalized domains,
    # on the assumption that the domain may be transmitted without SMTPUTF8
    # as IDNA ASCII. (This is also checked by idna.encode, so this exception
    # is never reached for internationalized domains.)
    if len(ascii_domain) > DOMAIN_MAX_LENGTH:
        reason = get_length_reason(ascii_domain, limit=DOMAIN_MAX_LENGTH)
        raise EmailSyntaxError(f"The email address is too long after the @-sign {reason}.")

    # Also check the label length limit.
    # (RFC 1035 2.3.1)
    for label in ascii_domain.split("."):
        if len(label) > DNS_LABEL_LENGTH_LIMIT:
            reason = get_length_reason(label, limit=DNS_LABEL_LENGTH_LIMIT)
            raise EmailSyntaxError(f"After the @-sign, periods cannot be separated by so many characters {reason}.")

    if globally_deliverable:
        # All publicly deliverable addresses have domain names with at least
        # one period, at least for gTLDs created since 2013 (per the ICANN Board
        # New gTLD Program Committee, https://www.icann.org/en/announcements/details/new-gtld-dotless-domain-names-prohibited-30-8-2013-en).
        # We'll consider the lack of a period a syntax error
        # since that will match people's sense of what an email address looks
        # like. We'll skip this in test environments to allow '@test' email
        # addresses.
        if "." not in ascii_domain and not (ascii_domain == "test" and test_environment):
            raise EmailSyntaxError("The part after the @-sign is not valid. It should have a period.")

        # We also know that all TLDs currently end with a letter.
        if not DOMAIN_NAME_REGEX.search(ascii_domain):
            raise EmailSyntaxError("The part after the @-sign is not valid. It is not within a valid top-level domain.")

    # Check special-use and reserved domain names.
    # Some might fail DNS-based deliverability checks, but that
    # can be turned off, so we should fail them all sooner.
    # See the references in __init__.py.
    from . import SPECIAL_USE_DOMAIN_NAMES
    for d in SPECIAL_USE_DOMAIN_NAMES:
        # See the note near the definition of SPECIAL_USE_DOMAIN_NAMES.
        if d == "test" and test_environment:
            continue

        if ascii_domain == d or ascii_domain.endswith("." + d):
            raise EmailSyntaxError("The part after the @-sign is a special-use or reserved name that cannot be used with email.")

    # We may have been given an IDNA ASCII domain to begin with. Check
    # that the domain actually conforms to IDNA. It could look like IDNA
    # but not be actual IDNA. For ASCII-only domains, the conversion out
    # of IDNA just gives the same thing back.
    #
    # This gives us the canonical internationalized form of the domain.
    try:
        domain_i18n = idna.decode(ascii_domain.encode('ascii'))
    except idna.IDNAError as e:
        raise EmailSyntaxError(f"The part after the @-sign is not valid IDNA ({e}).")

    # Check for invalid characters after normalization. These
    # should never arise. See the similar checks above.
    bad_chars = set(
        safe_character_display(c)
        for c in domain
        if not ATEXT_HOSTNAME_INTL.match(c)
    )
    if bad_chars:
        raise EmailSyntaxError("The part after the @-sign contains invalid characters: " + ", ".join(sorted(bad_chars)) + ".")
    check_unsafe_chars(domain)

    # Return the IDNA ASCII-encoded form of the domain, which is how it
    # would be transmitted on the wire (except when used with SMTPUTF8
    # possibly), as well as the canonical Unicode form of the domain,
    # which is better for display purposes. This should also take care
    # of RFC 6532 section 3.1's suggestion to apply Unicode NFC
    # normalization to addresses.
    return {
        "ascii_domain": ascii_domain,
        "domain": domain_i18n,
    }


def validate_email_length(addrinfo):
    # If the email address has an ASCII representation, then we assume it may be
    # transmitted in ASCII (we can't assume SMTPUTF8 will be used on all hops to
    # the destination) and the length limit applies to ASCII characters (which is
    # the same as octets). The number of characters in the internationalized form
    # may be many fewer (because IDNA ASCII is verbose) and could be less than 254
    # Unicode characters, and of course the number of octets over the limit may
    # not be the number of characters over the limit, so if the email address is
    # internationalized, we can't give any simple information about why the address
    # is too long.
    if addrinfo.ascii_email and len(addrinfo.ascii_email) > EMAIL_MAX_LENGTH:
        if addrinfo.ascii_email == addrinfo.normalized:
            reason = get_length_reason(addrinfo.ascii_email)
        elif len(addrinfo.normalized) > EMAIL_MAX_LENGTH:
            # If there are more than 254 characters, then the ASCII
            # form is definitely going to be too long.
            reason = get_length_reason(addrinfo.normalized, utf8=True)
        else:
            reason = "(when converted to IDNA ASCII)"
        raise EmailSyntaxError(f"The email address is too long {reason}.")

    # In addition, check that the UTF-8 encoding (i.e. not IDNA ASCII and not
    # Unicode characters) is at most 254 octets. If the addres is transmitted using
    # SMTPUTF8, then the length limit probably applies to the UTF-8 encoded octets.
    # If the email address has an ASCII form that differs from its internationalized
    # form, I don't think the internationalized form can be longer, and so the ASCII
    # form length check would be sufficient. If there is no ASCII form, then we have
    # to check the UTF-8 encoding. The UTF-8 encoding could be up to about four times
    # longer than the number of characters.
    #
    # See the length checks on the local part and the domain.
    if len(addrinfo.normalized.encode("utf8")) > EMAIL_MAX_LENGTH:
        if len(addrinfo.normalized) > EMAIL_MAX_LENGTH:
            # If there are more than 254 characters, then the UTF-8
            # encoding is definitely going to be too long.
            reason = get_length_reason(addrinfo.normalized, utf8=True)
        else:
            reason = "(when encoded in bytes)"
        raise EmailSyntaxError(f"The email address is too long {reason}.")


def validate_email_domain_literal(domain_literal):
    # This is obscure domain-literal syntax. Parse it and return
    # a compressed/normalized address.
    # RFC 5321 4.1.3 and RFC 5322 3.4.1.

    # Try to parse the domain literal as an IPv4 address.
    # There is no tag for IPv4 addresses, so we can never
    # be sure if the user intends an IPv4 address.
    if re.match(r"^[0-9\.]+$", domain_literal):
        try:
            addr = ipaddress.IPv4Address(domain_literal)
        except ValueError as e:
            raise EmailSyntaxError(f"The address in brackets after the @-sign is not valid: It is not an IPv4 address ({e}) or is missing an address literal tag.")

        # Return the IPv4Address object and the domain back unchanged.
        return {
            "domain_address": addr,
            "domain": f"[{addr}]",
        }

    # If it begins with "IPv6:" it's an IPv6 address.
    if domain_literal.startswith("IPv6:"):
        try:
            addr = ipaddress.IPv6Address(domain_literal[5:])
        except ValueError as e:
            raise EmailSyntaxError(f"The IPv6 address in brackets after the @-sign is not valid ({e}).")

        # Return the IPv6Address object and construct a normalized
        # domain literal.
        return {
            "domain_address": addr,
            "domain": f"[IPv6:{addr.compressed}]",
        }

    # Nothing else is valid.

    if ":" not in domain_literal:
        raise EmailSyntaxError("The part after the @-sign in brackets is not an IPv4 address and has no address literal tag.")

    # The tag (the part before the colon) has character restrictions,
    # but since it must come from a registry of tags (in which only "IPv6" is defined),
    # there's no need to check the syntax of the tag. See RFC 5321 4.1.2.

    # Check for permitted ASCII characters. This actually doesn't matter
    # since there will be an exception after anyway.
    bad_chars = set(
        safe_character_display(c)
        for c in domain_literal
        if not DOMAIN_LITERAL_CHARS.match(c)
    )
    if bad_chars:
        raise EmailSyntaxError("The part after the @-sign contains invalid characters in brackets: " + ", ".join(sorted(bad_chars)) + ".")

    # There are no other domain literal tags.
    # https://www.iana.org/assignments/address-literal-tags/address-literal-tags.xhtml
    raise EmailSyntaxError("The part after the @-sign contains an invalid address literal tag in brackets.")
