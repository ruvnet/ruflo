from unittest import TestCase
from mock import MagicMock

import json

from youtube_transcript_api import YouTubeTranscriptApi, VideoUnavailable
from youtube_transcript_api._cli import YouTubeTranscriptCli


class TestYouTubeTranscriptCli(TestCase):
    def setUp(self):
        self.transcript_mock = MagicMock()
        self.transcript_mock.fetch = MagicMock(return_value=[
            {'text': 'Hey, this is just a test', 'start': 0.0, 'duration': 1.54},
            {'text': 'this is <i>not</i> the original transcript', 'start': 1.54, 'duration': 4.16},
            {'text': 'just something shorter, I made up for testing', 'start': 5.7, 'duration': 3.239}
        ])
        self.transcript_mock.translate = MagicMock(return_value=self.transcript_mock)

        self.transcript_list_mock = MagicMock()
        self.transcript_list_mock.find_generated_transcript = MagicMock(return_value=self.transcript_mock)
        self.transcript_list_mock.find_manually_created_transcript = MagicMock(return_value=self.transcript_mock)
        self.transcript_list_mock.find_transcript = MagicMock(return_value=self.transcript_mock)

        YouTubeTranscriptApi.list_transcripts = MagicMock(return_value=self.transcript_list_mock)

    def test_argument_parsing(self):
        parsed_args = YouTubeTranscriptCli('v1 v2 --format json --languages de en'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertEqual(parsed_args.format, 'json')
        self.assertEqual(parsed_args.languages, ['de', 'en'])
        self.assertEqual(parsed_args.http_proxy, '')
        self.assertEqual(parsed_args.https_proxy, '')

        parsed_args = YouTubeTranscriptCli('v1 v2 --languages de en --format json'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertEqual(parsed_args.format, 'json')
        self.assertEqual(parsed_args.languages, ['de', 'en'])
        self.assertEqual(parsed_args.http_proxy, '')
        self.assertEqual(parsed_args.https_proxy, '')

        parsed_args = YouTubeTranscriptCli(' --format json v1 v2 --languages de en'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertEqual(parsed_args.format, 'json')
        self.assertEqual(parsed_args.languages, ['de', 'en'])
        self.assertEqual(parsed_args.http_proxy, '')
        self.assertEqual(parsed_args.https_proxy, '')

        parsed_args = YouTubeTranscriptCli(
            'v1 v2 --languages de en --format json '
            '--http-proxy http://user:pass@domain:port '
            '--https-proxy https://user:pass@domain:port'.split()
        )._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertEqual(parsed_args.format, 'json')
        self.assertEqual(parsed_args.languages, ['de', 'en'])
        self.assertEqual(parsed_args.http_proxy, 'http://user:pass@domain:port')
        self.assertEqual(parsed_args.https_proxy, 'https://user:pass@domain:port')

        parsed_args = YouTubeTranscriptCli(
            'v1 v2 --languages de en --format json --http-proxy http://user:pass@domain:port'.split()
        )._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertEqual(parsed_args.format, 'json')
        self.assertEqual(parsed_args.languages, ['de', 'en'])
        self.assertEqual(parsed_args.http_proxy, 'http://user:pass@domain:port')
        self.assertEqual(parsed_args.https_proxy, '')

        parsed_args = YouTubeTranscriptCli(
            'v1 v2 --languages de en --format json --https-proxy https://user:pass@domain:port'.split()
        )._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertEqual(parsed_args.format, 'json')
        self.assertEqual(parsed_args.languages, ['de', 'en'])
        self.assertEqual(parsed_args.https_proxy, 'https://user:pass@domain:port')
        self.assertEqual(parsed_args.http_proxy, '')

    def test_argument_parsing__only_video_ids(self):
        parsed_args = YouTubeTranscriptCli('v1 v2'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertEqual(parsed_args.format, 'pretty')
        self.assertEqual(parsed_args.languages, ['en'])

    def test_argument_parsing__video_ids_starting_with_dash(self):
        parsed_args = YouTubeTranscriptCli('\-v1 \-\-v2 \--v3'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['-v1', '--v2', '--v3'])
        self.assertEqual(parsed_args.format, 'pretty')
        self.assertEqual(parsed_args.languages, ['en'])

    def test_argument_parsing__fail_without_video_ids(self):
        with self.assertRaises(SystemExit):
            YouTubeTranscriptCli('--format json'.split())._parse_args()

    def test_argument_parsing__json(self):
        parsed_args = YouTubeTranscriptCli('v1 v2 --format json'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertEqual(parsed_args.format, 'json')
        self.assertEqual(parsed_args.languages, ['en'])

        parsed_args = YouTubeTranscriptCli('--format json v1 v2'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertEqual(parsed_args.format, 'json')
        self.assertEqual(parsed_args.languages, ['en'])

    def test_argument_parsing__languages(self):
        parsed_args = YouTubeTranscriptCli('v1 v2 --languages de en'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertEqual(parsed_args.format, 'pretty')
        self.assertEqual(parsed_args.languages, ['de', 'en'])

    def test_argument_parsing__proxies(self):
        parsed_args = YouTubeTranscriptCli(
            'v1 v2 --http-proxy http://user:pass@domain:port'.split()
        )._parse_args()
        self.assertEqual(parsed_args.http_proxy, 'http://user:pass@domain:port')

        parsed_args = YouTubeTranscriptCli(
            'v1 v2 --https-proxy https://user:pass@domain:port'.split()
        )._parse_args()
        self.assertEqual(parsed_args.https_proxy, 'https://user:pass@domain:port')

        parsed_args = YouTubeTranscriptCli(
            'v1 v2 --http-proxy http://user:pass@domain:port --https-proxy https://user:pass@domain:port'.split()
        )._parse_args()
        self.assertEqual(parsed_args.http_proxy, 'http://user:pass@domain:port')
        self.assertEqual(parsed_args.https_proxy, 'https://user:pass@domain:port')

        parsed_args = YouTubeTranscriptCli(
            'v1 v2'.split()
        )._parse_args()
        self.assertEqual(parsed_args.http_proxy, '')
        self.assertEqual(parsed_args.https_proxy, '')

    def test_argument_parsing__list_transcripts(self):
        parsed_args = YouTubeTranscriptCli('--list-transcripts v1 v2'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertTrue(parsed_args.list_transcripts)

        parsed_args = YouTubeTranscriptCli('v1 v2 --list-transcripts'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertTrue(parsed_args.list_transcripts)

    def test_argument_parsing__translate(self):
        parsed_args = YouTubeTranscriptCli('v1 v2 --languages de en --translate cz'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertEqual(parsed_args.format, 'pretty')
        self.assertEqual(parsed_args.languages, ['de', 'en'])
        self.assertEqual(parsed_args.translate, 'cz')

        parsed_args = YouTubeTranscriptCli('v1 v2 --translate cz --languages de en'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertEqual(parsed_args.format, 'pretty')
        self.assertEqual(parsed_args.languages, ['de', 'en'])
        self.assertEqual(parsed_args.translate, 'cz')

    def test_argument_parsing__manually_or_generated(self):
        parsed_args = YouTubeTranscriptCli('v1 v2 --exclude-manually-created'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertTrue(parsed_args.exclude_manually_created)
        self.assertFalse(parsed_args.exclude_generated)

        parsed_args = YouTubeTranscriptCli('v1 v2 --exclude-generated'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertFalse(parsed_args.exclude_manually_created)
        self.assertTrue(parsed_args.exclude_generated)

        parsed_args = YouTubeTranscriptCli('v1 v2 --exclude-manually-created --exclude-generated'.split())._parse_args()
        self.assertEqual(parsed_args.video_ids, ['v1', 'v2'])
        self.assertTrue(parsed_args.exclude_manually_created)
        self.assertTrue(parsed_args.exclude_generated)

    def test_run(self):
        YouTubeTranscriptCli('v1 v2 --languages de en'.split()).run()

        YouTubeTranscriptApi.list_transcripts.assert_any_call('v1', proxies=None, cookies=None)
        YouTubeTranscriptApi.list_transcripts.assert_any_call('v2', proxies=None, cookies=None)

        self.transcript_list_mock.find_transcript.assert_any_call(['de', 'en'])

    def test_run__failing_transcripts(self):
        YouTubeTranscriptApi.list_transcripts = MagicMock(side_effect=VideoUnavailable('video_id'))

        output = YouTubeTranscriptCli('v1 --languages de en'.split()).run()

        self.assertEqual(output, str(VideoUnavailable('video_id')))

    def test_run__exclude_generated(self):
        YouTubeTranscriptCli('v1 v2 --languages de en --exclude-generated'.split()).run()

        self.transcript_list_mock.find_manually_created_transcript.assert_any_call(['de', 'en'])

    def test_run__exclude_manually_created(self):
        YouTubeTranscriptCli('v1 v2 --languages de en --exclude-manually-created'.split()).run()

        self.transcript_list_mock.find_generated_transcript.assert_any_call(['de', 'en'])

    def test_run__exclude_manually_created_and_generated(self):
        self.assertEqual(
            YouTubeTranscriptCli(
                'v1 v2 --languages de en --exclude-manually-created --exclude-generated'.split()
            ).run(),
            ''
        )

    def test_run__translate(self):
        YouTubeTranscriptCli('v1 v2 --languages de en --translate cz'.split()).run(),

        self.transcript_mock.translate.assert_any_call('cz')

    def test_run__list_transcripts(self):
        YouTubeTranscriptCli('--list-transcripts v1 v2'.split()).run()

        YouTubeTranscriptApi.list_transcripts.assert_any_call('v1', proxies=None, cookies=None)
        YouTubeTranscriptApi.list_transcripts.assert_any_call('v2', proxies=None, cookies=None)

    def test_run__json_output(self):
        output = YouTubeTranscriptCli('v1 v2 --languages de en --format json'.split()).run()

        # will fail if output is not valid json
        json.loads(output)

    def test_run__proxies(self):
        YouTubeTranscriptCli(
            (
                'v1 v2 --languages de en '
                '--http-proxy http://user:pass@domain:port '
                '--https-proxy https://user:pass@domain:port'
            ).split()
        ).run()

        YouTubeTranscriptApi.list_transcripts.assert_any_call(
            'v1',
            proxies={'http': 'http://user:pass@domain:port', 'https': 'https://user:pass@domain:port'},
            cookies= None
        )

        YouTubeTranscriptApi.list_transcripts.assert_any_call(
            'v2',
            proxies={'http': 'http://user:pass@domain:port', 'https': 'https://user:pass@domain:port'},
            cookies=None
        )

    def test_run__cookies(self):
        YouTubeTranscriptCli(
            (
                'v1 v2 --languages de en '
                '--cookies blahblah.txt'
            ).split()
        ).run()
        YouTubeTranscriptApi.list_transcripts.assert_any_call('v1', proxies=None, cookies='blahblah.txt')
        YouTubeTranscriptApi.list_transcripts.assert_any_call('v2', proxies=None, cookies='blahblah.txt')

