#!/usr/bin/env python3
"""Exercise the built CLI in a real PTY and capture synthetic demo screenshots.

Requires Python, pyte and Pillow on macOS/Linux. Run after the Codex package build.
No real session files or model calls are used.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time

import pyte
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', type=Path, default=ROOT / 'v3/@claude-flow/codex/docs/images')
parser.add_argument('--font', default='/System/Library/Fonts/Menlo.ttc' if os.uname().sysname == 'Darwin'
                    else '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf')
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)


def row(kind, payload):
    return json.dumps({'type': kind, 'timestamp': '2026-10-09T12:00:00Z', 'payload': payload}) + '\n'


def message(text, role='assistant'):
    return row('response_item', {'type': 'message', 'role': role, 'phase': 'commentary', 'content': text})


def capture(screen, name):
    font = ImageFont.truetype(args.font, 18)
    cell = round(font.getlength('M'))
    image = Image.new('RGB', (100 * cell + 48, 36 * 25 + 75), '#111827')
    draw = ImageDraw.Draw(image)
    draw.text((24, 16), 'Ruflo / Codex activity — synthetic demo', font=font, fill='#7dd3fc')
    for index, line in enumerate(screen.display):
        draw.text((24, 58 + index * 25), line.rstrip(), font=font, fill='#e5e7eb')
    image.save(args.out / name)


with tempfile.TemporaryDirectory(prefix='ruflo-activity-pty-') as temp:
    directory = Path(temp).resolve()
    parent = directory / 'parent.jsonl'
    helper = directory / 'helper.jsonl'
    parent.write_text(row('session_meta', {'id': 'demo-parent', 'source': 'cli'}))
    helper.write_text(''.join([
        row('session_meta', {'id': 'demo-parser-review', 'agent_path': '/root/parser-review',
                            'agent_nickname': 'Parser review', 'source': {'subagent': {
                                'thread_spawn': {'parent_thread_id': 'demo-parent'}}}}),
        message('PRIVATE_PARENT_SENTINEL', 'user'),
        row('event_msg', {'type': 'thread_settings_applied', 'thread_id': 'demo-parser-review'}),
        message('Check that copied parent history stays out of the activity view.', 'user'),
        message('I found a missing own-thread marker in one fixture. Adding a regression test.'),
        row('response_item', {'type': 'function_call', 'name': 'exec_command', 'call_id': 'demo-check',
                             'arguments': json.dumps({'cmd': 'npm test -- activity-parser.test.ts --run'})}),
        row('response_item', {'type': 'function_call_output', 'call_id': 'demo-check',
                             'output': {'exit_code': 0, 'output': 'Synthetic result: parser checks passed.'}}),
    ]))
    original_parent = parent.read_bytes()
    expected_helper = helper.read_bytes()
    master, slave = pty.openpty()
    original_tty = termios.tcgetattr(slave)
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 36, 100, 0, 0))
    screen = pyte.Screen(100, 36)
    stream = pyte.ByteStream(screen)
    process = subprocess.Popen(['node', str(ROOT / 'v3/@claude-flow/codex/dist/cli.js'), 'activity',
                                '--session-file', str(parent), '--sessions-dir', str(directory),
                                '--interval', '0.2'], stdin=slave, stdout=slave, stderr=slave)
    transcript = bytearray()

    def pump(seconds=0.5):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            if select.select([master], [], [], min(0.05, max(0, until - time.monotonic())))[0]:
                data = os.read(master, 65536)
                transcript.extend(data)
                stream.feed(data)

    def visible():
        return '\n'.join(screen.display)

    try:
        pump(1)
        assert 'AGENTS - choose one' in visible(), visible()
        capture(screen, 'activity-picker.png')
        os.write(master, b'\r')
        pump()
        assert 'ASSIGNMENT' in visible() and 'parser checks passed' in visible(), visible()
        addition = message('Review complete: the inherited-history fixture now passes.')
        with helper.open('a') as log:
            log.write(addition)
        expected_helper += addition.encode()
        pump()
        assert 'inherited-history fixture now passes' in visible(), visible()
        capture(screen, 'activity-detail.png')
        os.write(master, b'G')
        pump()
        os.write(master, b'b')
        pump()
        assert 'AGENTS - choose one' in visible()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 20, 65, 0, 0))
        process.send_signal(signal.SIGWINCH)
        pump()
        os.write(master, b'q')
        pump()
        assert process.wait(timeout=3) == 0
        assert termios.tcgetattr(slave) == original_tty, 'Terminal settings were not restored'
        assert b'\x1b[?25h\x1b[?1049l' in transcript, 'Alternate screen/cursor cleanup missing'
        assert b'PRIVATE_PARENT_SENTINEL' not in transcript
        assert parent.read_bytes() == original_parent
        assert helper.read_bytes() == expected_helper
        print('PTY checks passed: picker, details, live append, back, resize, quit, terminal cleanup, read-only.')
        print(f'Screenshots: {args.out}')
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)
        os.close(slave)
