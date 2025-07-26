from jmespath.compat import with_str_method


class JMESPathError(ValueError):
    pass


@with_str_method
class ParseError(JMESPathError):
    _ERROR_MESSAGE = 'Invalid jmespath expression'
    def __init__(self, lex_position, token_value, token_type,
                 msg=_ERROR_MESSAGE):
        super(ParseError, self).__init__(lex_position, token_value, token_type)
        self.lex_position = lex_position
        self.token_value = token_value
        self.token_type = token_type.upper()
        self.msg = msg
        # Whatever catches the ParseError can fill in the full expression
        self.expression = None

    def __str__(self):
        # self.lex_position +1 to account for the starting double quote char.
        underline = ' ' * (self.lex_position + 1) + '^'
        return (
            '%s: Parse error at column %s, '
            'token "%s" (%s), for expression:\n"%s"\n%s' % (
                self.msg, self.lex_position, self.token_value, self.token_type,
                self.expression, underline))


@with_str_method
class IncompleteExpressionError(ParseError):
    def set_expression(self, expression):
        self.expression = expression
        self.lex_position = len(expression)
        self.token_type = None
        self.token_value = None

    def __str__(self):
        # self.lex_position +1 to account for the starting double quote char.
        underline = ' ' * (self.lex_position + 1) + '^'
        return (
            'Invalid jmespath expression: Incomplete expression:\n'
            '"%s"\n%s' % (self.expression, underline))


@with_str_method
class LexerError(ParseError):
    def __init__(self, lexer_position, lexer_value, message, expression=None):
        self.lexer_position = lexer_position
        self.lexer_value = lexer_value
        self.message = message
        super(LexerError, self).__init__(lexer_position,
                                         lexer_value,
                                         message)
        # Whatever catches LexerError can set this.
        self.expression = expression

    def __str__(self):
        underline = ' ' * self.lexer_position + '^'
        return 'Bad jmespath expression: %s:\n%s\n%s' % (
            self.message, self.expression, underline)


@with_str_method
class ArityError(ParseError):
    def __init__(self, expected, actual, name):
        self.expected_arity = expected
        self.actual_arity = actual
        self.function_name = name
        self.expression = None

    def __str__(self):
        return ("Expected %s %s for function %s(), "
                "received %s" % (
                    self.expected_arity,
                    self._pluralize('argument', self.expected_arity),
                    self.function_name,
                    self.actual_arity))

    def _pluralize(self, word, count):
        if count == 1:
            return word
        else:
            return word + 's'


@with_str_method
class VariadictArityError(ArityError):
    def __str__(self):
        return ("Expected at least %s %s for function %s(), "
                "received %s" % (
                    self.expected_arity,
                    self._pluralize('argument', self.expected_arity),
                    self.function_name,
                    self.actual_arity))


@with_str_method
class JMESPathTypeError(JMESPathError):
    def __init__(self, function_name, current_value, actual_type,
                 expected_types):
        self.function_name = function_name
        self.current_value = current_value
        self.actual_type = actual_type
        self.expected_types = expected_types

    def __str__(self):
        return ('In function %s(), invalid type for value: %s, '
                'expected one of: %s, received: "%s"' % (
                    self.function_name, self.current_value,
                    self.expected_types, self.actual_type))


class EmptyExpressionError(JMESPathError):
    def __init__(self):
        super(EmptyExpressionError, self).__init__(
            "Invalid JMESPath expression: cannot be empty.")


class UnknownFunctionError(JMESPathError):
    pass
