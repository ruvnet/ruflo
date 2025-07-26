import unittest
from unittest.mock import patch

from posthog.scopes import (
    clear_tags,
    get_tags,
    new_context,
    scoped,
    tag,
    identify_context,
    set_context_session,
    get_context_session_id,
    get_context_distinct_id,
)


class TestScopes(unittest.TestCase):
    def setUp(self):
        # Reset any context between tests
        clear_tags()

    def test_tag_and_get_tags(self):
        with new_context(fresh=True):
            tag("key1", "value1")
            tag("key2", 2)

            tags = get_tags()
            assert tags["key1"] == "value1"
            assert tags["key2"] == 2

    def test_clear_tags(self):
        with new_context(fresh=True):
            tag("key1", "value1")
            assert get_tags()["key1"] == "value1"

            clear_tags()
            assert get_tags() == {}

    def test_new_context_isolation(self):
        with new_context(fresh=True):
            # Set tag in outer context
            tag("outer", "value")

            with new_context(fresh=True):
                # Inner context should start empty
                assert get_tags() == {}

                # Set tag in inner context
                tag("inner", "value")
                assert get_tags()["inner"] == "value"

                # Outer tag should not be visible
                self.assertNotIn("outer", get_tags())

            with new_context(fresh=False):
                # Inner context should inherit outer tag
                assert get_tags() == {"outer": "value"}

            # After exiting context, inner tag should be gone
            self.assertNotIn("inner", get_tags())

            # Outer tag should still be there
            assert get_tags()["outer"] == "value"

    def test_nested_contexts(self):
        with new_context(fresh=True):
            tag("level1", "value1")

            with new_context(fresh=True):
                tag("level2", "value2")

                with new_context(fresh=True):
                    tag("level3", "value3")
                    assert get_tags() == {"level3": "value3"}

                # Back to level 2
                assert get_tags() == {"level2": "value2"}

            # Back to level 1
            assert get_tags() == {"level1": "value1"}

    @patch("posthog.capture_exception")
    def test_scoped_decorator_success(self, mock_capture):
        @scoped()
        def successful_function(x, y):
            tag("x", x)
            tag("y", y)
            return x + y

        result = successful_function(1, 2)

        # Function should execute normally
        assert result == 3

        # No exception should be captured
        mock_capture.assert_not_called()

        # Context should be cleared after function execution
        assert get_tags() == {}

    @patch("posthog.capture_exception")
    def test_scoped_decorator_exception(self, mock_capture):
        test_exception = ValueError("Test exception")

        def check_context_on_capture(exception, **kwargs):
            # Assert tags are available when capture_exception is called
            current_tags = get_tags()
            assert current_tags.get("important_context") == "value"

        mock_capture.side_effect = check_context_on_capture

        @scoped()
        def failing_function():
            tag("important_context", "value")
            raise test_exception

        # Function should raise the exception
        with self.assertRaises(ValueError):
            failing_function()

        # Verify capture_exception was called
        mock_capture.assert_called_once_with(test_exception)

        # Context should be cleared after function execution
        assert get_tags() == {}

    @patch("posthog.capture_exception")
    def test_new_context_exception_handling(self, mock_capture):
        test_exception = RuntimeError("Context exception")

        def check_context_on_capture(exception, **kwargs):
            # Assert inner context tags are available when capture_exception is called
            current_tags = get_tags()
            assert current_tags.get("inner_context") == "inner_value"

        mock_capture.side_effect = check_context_on_capture

        # Set up outer context
        with new_context():
            tag("outer_context", "outer_value")

            try:
                with new_context():
                    tag("inner_context", "inner_value")
                    raise test_exception
            except RuntimeError:
                pass  # Expected exception

            # Outer context should still be intact
            assert get_tags()["outer_context"] == "outer_value"

        # Verify capture_exception was called
        mock_capture.assert_called_once_with(test_exception)

    def test_identify_context(self):
        with new_context(fresh=True):
            # Initially no distinct ID
            assert get_context_distinct_id() is None

            # Set distinct ID
            identify_context("user123")
            assert get_context_distinct_id() == "user123"

    def test_set_context_session(self):
        with new_context(fresh=True):
            # Initially no session ID
            assert get_context_session_id() is None

            # Set session ID
            set_context_session("session456")
            assert get_context_session_id() == "session456"

    def test_context_inheritance_fresh_context(self):
        with new_context(fresh=True):
            identify_context("user123")
            set_context_session("session456")

            with new_context(fresh=True):
                # Fresh context should not inherit
                assert get_context_distinct_id() is None
                assert get_context_session_id() is None

            # Original context should still have values
            assert get_context_distinct_id() == "user123"
            assert get_context_session_id() == "session456"

    def test_context_inheritance_non_fresh_context(self):
        with new_context(fresh=True):
            identify_context("user123")
            set_context_session("session456")

            with new_context(fresh=False):
                # Non-fresh context should inherit
                assert get_context_distinct_id() == "user123"
                assert get_context_session_id() == "session456"

                # Override in child context
                identify_context("user789")
                set_context_session("session999")
                assert get_context_distinct_id() == "user789"
                assert get_context_session_id() == "session999"

            # Original context should still have original values
            assert get_context_distinct_id() == "user123"
            assert get_context_session_id() == "session456"

    def test_scoped_decorator_with_context_ids(self):
        @scoped()
        def function_with_context():
            identify_context("user456")
            set_context_session("session789")
            return get_context_distinct_id(), get_context_session_id()

        distinct_id, session_id = function_with_context()
        assert distinct_id == "user456"
        assert session_id == "session789"

        # Context should be cleared after function execution
        assert get_context_distinct_id() is None
        assert get_context_session_id() is None
