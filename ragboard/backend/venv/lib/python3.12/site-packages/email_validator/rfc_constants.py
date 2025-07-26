# These constants are defined by the email specifications.

import re

# Based on RFC 5322 3.2.3, these characters are permitted in email
# addresses (not taking into account internationalization) separated by dots:
ATEXT = r'a-zA-Z0-9_!#\$%&\'\*\+\-/=\?\^`\{\|\}~'
ATEXT_RE = re.compile('[.' + ATEXT + ']')  # ATEXT plus dots
DOT_ATOM_TEXT = re.compile('[' + ATEXT + ']+(?:\\.[' + ATEXT + r']+)*\Z')

# RFC 6531 3.3 extends the allowed characters in internationalized
# addresses to also include three specific ranges of UTF8 defined in
# RFC 3629 section 4, which appear to be the Unicode code points from
# U+0080 to U+10FFFF.
ATEXT_INTL = ATEXT + u"\u0080-\U0010FFFF"
ATEXT_INTL_RE = re.compile('[.' + ATEXT_INTL + ']')  # ATEXT_INTL plus dots
DOT_ATOM_TEXT_INTL = re.compile('[' + ATEXT_INTL + ']+(?:\\.[' + ATEXT_INTL + r']+)*\Z')

# The domain part of the email address, after IDNA (ASCII) encoding,
# must also satisfy the requirements of RFC 952/RFC 1123 2.1 which
# restrict the allowed characters of hostnames further.
ATEXT_HOSTNAME_INTL = re.compile(r"[a-zA-Z0-9\-\." + "\u0080-\U0010FFFF" + "]")
HOSTNAME_LABEL = r'(?:(?:[a-zA-Z0-9][a-zA-Z0-9\-]*)?[a-zA-Z0-9])'
DOT_ATOM_TEXT_HOSTNAME = re.compile(HOSTNAME_LABEL + r'(?:\.' + HOSTNAME_LABEL + r')*\Z')
DOMAIN_NAME_REGEX = re.compile(r"[A-Za-z]\Z")  # all TLDs currently end with a letter

# Domain literal (RFC 5322 3.4.1)
DOMAIN_LITERAL_CHARS = re.compile(r"[\u0021-\u00FA\u005E-\u007E]")

# Quoted-string local part (RFC 5321 4.1.2, internationalized by RFC 6531 3.3)
# The permitted characters in a quoted string are the characters in the range
# 32-126, except that quotes and (literal) backslashes can only appear when escaped
# by a backslash. When internationalized, UTF8 strings are also permitted except
# the ASCII characters that are not previously permitted (see above).
# QUOTED_LOCAL_PART_ADDR = re.compile(r"^\"((?:[\u0020-\u0021\u0023-\u005B\u005D-\u007E]|\\[\u0020-\u007E])*)\"@(.*)")
QUOTED_LOCAL_PART_ADDR = re.compile(r"^\"((?:[^\"\\]|\\.)*)\"@(.*)")
QTEXT_INTL = re.compile(r"[\u0020-\u007E\u0080-\U0010FFFF]")

# Length constants
# RFC 3696 + errata 1003 + errata 1690 (https://www.rfc-editor.org/errata_search.php?rfc=3696&eid=1690)
# explains the maximum length of an email address is 254 octets.
EMAIL_MAX_LENGTH = 254
LOCAL_PART_MAX_LENGTH = 64
DNS_LABEL_LENGTH_LIMIT = 63  # in "octets", RFC 1035 2.3.1
DOMAIN_MAX_LENGTH = 255  # in "octets", RFC 1035 2.3.4 and RFC 5321 4.5.3.1.2

# RFC 2142
CASE_INSENSITIVE_MAILBOX_NAMES = [
    'info', 'marking', 'sales', 'support',  # section 3
    'abuse', 'noc', 'security',  # section 4
    'postmaster', 'hostmaster', 'usenet', 'news', 'webmaster', 'www', 'uucp', 'ftp',  # section 5
]
