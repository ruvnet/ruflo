from ._settings import WATCH_URL


class CouldNotRetrieveTranscript(Exception):
    """
    Raised if a transcript could not be retrieved.
    """
    ERROR_MESSAGE = '\nCould not retrieve a transcript for the video {video_url}!'
    CAUSE_MESSAGE_INTRO = ' This is most likely caused by:\n\n{cause}'
    CAUSE_MESSAGE = ''
    GITHUB_REFERRAL = (
        '\n\nIf you are sure that the described cause is not responsible for this error '
        'and that a transcript should be retrievable, please create an issue at '
        'https://github.com/jdepoix/youtube-transcript-api/issues. '
        'Please add which version of youtube_transcript_api you are using '
        'and provide the information needed to replicate the error. '
        'Also make sure that there are no open issues which already describe your problem!'
    )

    def __init__(self, video_id):
        self.video_id = video_id
        super(CouldNotRetrieveTranscript, self).__init__(self._build_error_message())

    def _build_error_message(self):
        cause = self.cause
        error_message = self.ERROR_MESSAGE.format(video_url=WATCH_URL.format(video_id=self.video_id))

        if cause:
            error_message += self.CAUSE_MESSAGE_INTRO.format(cause=cause) + self.GITHUB_REFERRAL

        return error_message

    @property
    def cause(self):
        return self.CAUSE_MESSAGE


class YouTubeRequestFailed(CouldNotRetrieveTranscript):
    CAUSE_MESSAGE = 'Request to YouTube failed: {reason}'

    def __init__(self, video_id, http_error):
        self.reason = str(http_error)
        super(YouTubeRequestFailed, self).__init__(video_id)

    @property
    def cause(self):
        return self.CAUSE_MESSAGE.format(
            reason=self.reason,
        )


class VideoUnavailable(CouldNotRetrieveTranscript):
    CAUSE_MESSAGE = 'The video is no longer available'


class InvalidVideoId(CouldNotRetrieveTranscript):
    CAUSE_MESSAGE = (
        'You provided an invalid video id. Make sure you are using the video id and NOT the url!\n\n'
        'Do NOT run: `YouTubeTranscriptApi.get_transcript("https://www.youtube.com/watch?v=1234")`\n'
        'Instead run: `YouTubeTranscriptApi.get_transcript("1234")`'
    )


class TooManyRequests(CouldNotRetrieveTranscript):
    CAUSE_MESSAGE = (
        'YouTube is receiving too many requests from this IP and now requires solving a captcha to continue. '
        'One of the following things can be done to work around this:\n\
        - Manually solve the captcha in a browser and export the cookie. '
        'Read here how to use that cookie with '
        'youtube-transcript-api: https://github.com/jdepoix/youtube-transcript-api#cookies\n\
        - Use a different IP address\n\
        - Wait until the ban on your IP has been lifted'
    )


class TranscriptsDisabled(CouldNotRetrieveTranscript):
    CAUSE_MESSAGE = 'Subtitles are disabled for this video'


class NoTranscriptAvailable(CouldNotRetrieveTranscript):
    CAUSE_MESSAGE = 'No transcripts are available for this video'


class NotTranslatable(CouldNotRetrieveTranscript):
    CAUSE_MESSAGE = 'The requested language is not translatable'


class TranslationLanguageNotAvailable(CouldNotRetrieveTranscript):
    CAUSE_MESSAGE = 'The requested translation language is not available'


class CookiePathInvalid(CouldNotRetrieveTranscript):
    CAUSE_MESSAGE = 'The provided cookie file was unable to be loaded'


class CookiesInvalid(CouldNotRetrieveTranscript):
    CAUSE_MESSAGE = 'The cookies provided are not valid (may have expired)'


class FailedToCreateConsentCookie(CouldNotRetrieveTranscript):
    CAUSE_MESSAGE = 'Failed to automatically give consent to saving cookies'


class NoTranscriptFound(CouldNotRetrieveTranscript):
    CAUSE_MESSAGE = (
        'No transcripts were found for any of the requested language codes: {requested_language_codes}\n\n'
        '{transcript_data}'
    )

    def __init__(self, video_id, requested_language_codes, transcript_data):
        self._requested_language_codes = requested_language_codes
        self._transcript_data = transcript_data
        super(NoTranscriptFound, self).__init__(video_id)

    @property
    def cause(self):
        return self.CAUSE_MESSAGE.format(
            requested_language_codes=self._requested_language_codes,
            transcript_data=str(self._transcript_data),
        )
