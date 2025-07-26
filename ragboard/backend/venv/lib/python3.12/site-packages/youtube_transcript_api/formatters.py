import json

import pprint


class Formatter(object):
    """Formatter should be used as an abstract base class.

    Formatter classes should inherit from this class and implement
    their own .format() method which should return a string. A
    transcript is represented by a List of Dictionary items.
    """

    def format_transcript(self, transcript, **kwargs):
        raise NotImplementedError('A subclass of Formatter must implement ' \
            'their own .format_transcript() method.')

    def format_transcripts(self, transcripts, **kwargs):
        raise NotImplementedError('A subclass of Formatter must implement ' \
                                  'their own .format_transcripts() method.')


class PrettyPrintFormatter(Formatter):
    def format_transcript(self, transcript, **kwargs):
        """Pretty prints a transcript.

        :param transcript:
        :return: A pretty printed string representation of the transcript.'
        :rtype str
        """
        return pprint.pformat(transcript, **kwargs)

    def format_transcripts(self, transcripts, **kwargs):
        """Pretty prints a list of transcripts.

        :param transcripts:
        :return: A pretty printed string representation of the transcripts.'
        :rtype str
        """
        return self.format_transcript(transcripts, **kwargs)


class JSONFormatter(Formatter):
    def format_transcript(self, transcript, **kwargs):
        """Converts a transcript into a JSON string.

        :param transcript:
        :return: A JSON string representation of the transcript.'
        :rtype str
        """
        return json.dumps(transcript, **kwargs)

    def format_transcripts(self, transcripts, **kwargs):
        """Converts a list of transcripts into a JSON string.

        :param transcripts:
        :return: A JSON string representation of the transcript.'
        :rtype str
        """
        return self.format_transcript(transcripts, **kwargs)


class TextFormatter(Formatter):
    def format_transcript(self, transcript, **kwargs):
        """Converts a transcript into plain text with no timestamps.

        :param transcript:
        :return: all transcript text lines separated by newline breaks.'
        :rtype str
        """
        return '\n'.join(line['text'] for line in transcript)

    def format_transcripts(self, transcripts, **kwargs):
        """Converts a list of transcripts into plain text with no timestamps.

        :param transcripts:
        :return: all transcript text lines separated by newline breaks.'
        :rtype str
        """
        return '\n\n\n'.join([self.format_transcript(transcript, **kwargs) for transcript in transcripts])

class _TextBasedFormatter(TextFormatter):
    def _format_timestamp(self, hours, mins, secs, ms):
        raise NotImplementedError('A subclass of _TextBasedFormatter must implement ' \
            'their own .format_timestamp() method.')

    def _format_transcript_header(self, lines):
        raise NotImplementedError('A subclass of _TextBasedFormatter must implement ' \
            'their own _format_transcript_header method.')

    def _format_transcript_helper(self, i, time_text, line):
        raise NotImplementedError('A subclass of _TextBasedFormatter must implement ' \
            'their own _format_transcript_helper method.')    
            
    def _seconds_to_timestamp(self, time):
        """Helper that converts `time` into a transcript cue timestamp.

        :reference: https://www.w3.org/TR/webvtt1/#webvtt-timestamp

        :param time: a float representing time in seconds.
        :type time: float
        :return: a string formatted as a cue timestamp, 'HH:MM:SS.MS'
        :rtype str
        :example:
        >>> self._seconds_to_timestamp(6.93)
        '00:00:06.930'
        """
        time = float(time)
        hours_float, remainder = divmod(time, 3600)
        mins_float, secs_float = divmod(remainder, 60)
        hours, mins, secs = int(hours_float), int(mins_float), int(secs_float)
        ms = int(round((time - int(time))*1000, 2))
        return self._format_timestamp(hours, mins, secs, ms)

    def format_transcript(self, transcript, **kwargs):
        """A basic implementation of WEBVTT/SRT formatting.

        :param transcript:
        :reference: 
        https://www.w3.org/TR/webvtt1/#introduction-caption
        https://www.3playmedia.com/blog/create-srt-file/
        """
        lines = []
        for i, line in enumerate(transcript):
            end = line['start'] + line['duration']
            time_text = "{} --> {}".format(
                self._seconds_to_timestamp(line['start']),
                self._seconds_to_timestamp(
                    transcript[i + 1]['start'] 
                    if i < len(transcript) - 1 and transcript[i + 1]['start'] < end else end
                )
            )
            lines.append(self._format_transcript_helper(i, time_text, line))

        return self._format_transcript_header(lines)


class SRTFormatter(_TextBasedFormatter):
    def _format_timestamp(self, hours, mins, secs, ms):
        return "{:02d}:{:02d}:{:02d},{:03d}".format(hours, mins, secs, ms)
    
    def _format_transcript_header(self, lines):
        return "\n\n".join(lines) + "\n"

    def _format_transcript_helper(self, i, time_text, line):
        return "{}\n{}\n{}".format(i + 1, time_text, line['text'])


class WebVTTFormatter(_TextBasedFormatter):
    def _format_timestamp(self, hours, mins, secs, ms):
        return "{:02d}:{:02d}:{:02d}.{:03d}".format(hours, mins, secs, ms)

    def _format_transcript_header(self, lines):
        return "WEBVTT\n\n" + "\n\n".join(lines) + "\n"

    def _format_transcript_helper(self, i, time_text, line):
        return "{}\n{}".format(time_text, line['text'])


class FormatterLoader(object):
    TYPES = {
        'json': JSONFormatter,
        'pretty': PrettyPrintFormatter,
        'text': TextFormatter,
        'webvtt': WebVTTFormatter,
        'srt' : SRTFormatter,
    }

    class UnknownFormatterType(Exception):
        def __init__(self, formatter_type):
            super(FormatterLoader.UnknownFormatterType, self).__init__(
                'The format \'{formatter_type}\' is not supported. '
                'Choose one of the following formats: {supported_formatter_types}'.format(
                    formatter_type=formatter_type,
                    supported_formatter_types=', '.join(FormatterLoader.TYPES.keys()),
                )
            )

    def load(self, formatter_type='pretty'):
        """
        Loads the Formatter for the given formatter type.

        :param formatter_type:
        :return: Formatter object
        """
        if formatter_type not in FormatterLoader.TYPES.keys():
            raise FormatterLoader.UnknownFormatterType(formatter_type)
        return FormatterLoader.TYPES[formatter_type]()
