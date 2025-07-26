from unittest import TestCase

import json

import pprint

from youtube_transcript_api.formatters import (
    Formatter,
    JSONFormatter,
    TextFormatter,
    SRTFormatter,
    WebVTTFormatter,
    PrettyPrintFormatter, FormatterLoader
)


class TestFormatters(TestCase):
    def setUp(self):
        self.transcript = [
            {'text': 'Test line 1', 'start': 0.0, 'duration': 1.50},
            {'text': 'line between', 'start': 1.5, 'duration': 2.0},
            {'text': 'testing the end line', 'start': 2.5, 'duration': 3.25}
        ]
        self.transcripts = [self.transcript, self.transcript]

    def test_base_formatter_format_call(self):
        with self.assertRaises(NotImplementedError):
            Formatter().format_transcript(self.transcript)
        with self.assertRaises(NotImplementedError):
            Formatter().format_transcripts([self.transcript])

    def test_srt_formatter_starting(self):
        content = SRTFormatter().format_transcript(self.transcript)
        lines = content.split('\n')

        # test starting lines
        self.assertEqual(lines[0], "1")
        self.assertEqual(lines[1], "00:00:00,000 --> 00:00:01,500")
        
    def test_srt_formatter_middle(self):
        content = SRTFormatter().format_transcript(self.transcript)
        lines = content.split('\n')

        # test middle lines
        self.assertEqual(lines[4], "2")
        self.assertEqual(lines[5], "00:00:01,500 --> 00:00:02,500")
        self.assertEqual(lines[6], self.transcript[1]['text'])

    def test_srt_formatter_ending(self):
        content = SRTFormatter().format_transcript(self.transcript)
        lines = content.split('\n')

        # test ending lines
        self.assertEqual(lines[-2], self.transcript[-1]['text'])
        self.assertEqual(lines[-1], "")

    def test_srt_formatter_many(self):
        formatter = SRTFormatter()
        content = formatter.format_transcripts(self.transcripts)
        formatted_single_transcript = formatter.format_transcript(self.transcript)

        self.assertEqual(content, formatted_single_transcript + '\n\n\n' + formatted_single_transcript)

    def test_webvtt_formatter_starting(self):
        content = WebVTTFormatter().format_transcript(self.transcript)
        lines = content.split('\n')

        # test starting lines
        self.assertEqual(lines[0], "WEBVTT")
        self.assertEqual(lines[1], "")
    
    def test_webvtt_formatter_ending(self):
        content = WebVTTFormatter().format_transcript(self.transcript)
        lines = content.split('\n')

        # test ending lines
        self.assertEqual(lines[-2], self.transcript[-1]['text'])
        self.assertEqual(lines[-1], "")

    def test_webvtt_formatter_many(self):
        formatter = WebVTTFormatter()
        content = formatter.format_transcripts(self.transcripts)
        formatted_single_transcript = formatter.format_transcript(self.transcript)

        self.assertEqual(content, formatted_single_transcript + '\n\n\n' + formatted_single_transcript)

    def test_pretty_print_formatter(self):
        content = PrettyPrintFormatter().format_transcript(self.transcript)

        self.assertEqual(content, pprint.pformat(self.transcript))

    def test_pretty_print_formatter_many(self):
        content = PrettyPrintFormatter().format_transcripts(self.transcripts)

        self.assertEqual(content, pprint.pformat(self.transcripts))

    def test_json_formatter(self):
        content = JSONFormatter().format_transcript(self.transcript)

        self.assertEqual(json.loads(content), self.transcript)

    def test_json_formatter_many(self):
        content = JSONFormatter().format_transcripts(self.transcripts)

        self.assertEqual(json.loads(content), self.transcripts)

    def test_text_formatter(self):
        content = TextFormatter().format_transcript(self.transcript)
        lines = content.split('\n')

        self.assertEqual(lines[0], self.transcript[0]["text"])
        self.assertEqual(lines[-1], self.transcript[-1]["text"])

    def test_text_formatter_many(self):
        formatter = TextFormatter()
        content = formatter.format_transcripts(self.transcripts)
        formatted_single_transcript = formatter.format_transcript(self.transcript)

        self.assertEqual(content, formatted_single_transcript + '\n\n\n' + formatted_single_transcript)

    def test_formatter_loader(self):
        loader = FormatterLoader()
        formatter = loader.load('json')

        self.assertTrue(isinstance(formatter, JSONFormatter))

    def test_formatter_loader__default_formatter(self):
        loader = FormatterLoader()
        formatter = loader.load()

        self.assertTrue(isinstance(formatter, PrettyPrintFormatter))

    def test_formatter_loader__unknown_format(self):
        with self.assertRaises(FormatterLoader.UnknownFormatterType):
            FormatterLoader().load('png')
