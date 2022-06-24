#!/usr/bin/python

from io import BufferedReader, BufferedReader
from datetime import datetime
import subprocess as sp
import urllib.request

import asyncio
import sys
import os
import logging
import json

import argparse
import pyatv

from pyatv.interface import PushListener, DeviceListener, AppleTV
from pyatv.const import Protocol
from pyatv.protocols.raop import RaopClient, RaopStream
from pyatv.scripts import (
    log_current_version,
)

from mediafile import MediaFile

media = MediaFile(os.path.dirname(__file__) + '/dummy.mp3')


old__open_file = pyatv.support.metadata._open_file


def new_open_file(file: BufferedReader) -> MediaFile:
    return media

pyatv.support.metadata._open_file = new_open_file

LOOP = asyncio.get_event_loop()
_LOGGER = logging.getLogger(__name__)
LAST_SEEN_STREAM = datetime.now()
STREAM_FINISHED = False


class BufferedReaderListener (BufferedReader):
    def __init__(self, reader: BufferedReader) -> None:
        super().__init__(reader.raw, 2048)
        self.reader = reader

    def peek(self, __size: int = ...) -> bytes:
        return self.reader.peek(__size)

    def read1(self, __size: int = ...) -> bytes:
        return self.reader.read1(__size)

    def read(self, __size: int = ...) -> bytes:
        global LAST_SEEN_STREAM
        LAST_SEEN_STREAM = datetime.now()
        data = self.reader.read(__size)
        return data


class PushUpdatePrinter(PushListener):
    """Internal listener for push updates."""

    @staticmethod
    def playstatus_update(_, playstatus):
        """Print what is currently playing when it changes."""
        _LOGGER.debug(f"PLAY_STATUS: {str(playstatus)}")

    @staticmethod
    def playstatus_error(_, exception):
        """Inform about an error and restart push updates."""
        _LOGGER.error(f"An error occurred (restarting): {exception}")


class DeviceUpdatePrinter(DeviceListener):
    """Internal listener for generic device updates."""

    def connection_lost(self, exception):
        """Call when unexpectedly being disconnected from device."""
        _LOGGER.error("Connection lost, stack trace below:")

    def connection_closed(self):
        """Call when connection was (intentionally) closed."""
        _LOGGER.info("Connection was closed properly")


async def stream_with_push_updates(
    id: str, stream_url: str, stream_metadata: str, stream_artwork, loop: asyncio.AbstractEventLoop
):
    """Find a device and print what is playing."""
    _LOGGER.debug("* Discovering device on network...")
    global STREAM_FINISHED
    atvs = await pyatv.scan(loop, identifier=id, timeout=5)

    if not atvs:
        _LOGGER.error("* No Device found")
        STREAM_FINISHED = True
        return

    conf = atvs[0]

    _LOGGER.info(f"* Connecting to {conf.address}")
    atv = await pyatv.connect(conf, loop)

    push_listener = PushUpdatePrinter()
    device_listener = DeviceUpdatePrinter()

    atv.listener = device_listener
    atv.push_updater.listener = push_listener
    atv.push_updater.start()

    ffmpeg_cmd = ['ffmpeg',
                  '-rtbufsize', '25M',
                  '-i', stream_url,
                  '-f', 'mp3',
                  '-']
    ffmpeg_proc = sp.Popen(ffmpeg_cmd, stdout=sp.PIPE)
    raop_stream = fetch_raop_from_atv(atv)

    try:
        _LOGGER.info("* Starting to stream stdin",)
        await asyncio.gather(
            update_stream_metadata(stream_metadata, stream_artwork, raop_stream),
            atv.stream.stream_file(BufferedReaderListener(ffmpeg_proc.stdout)))
        await asyncio.sleep(1)
    finally:
        STREAM_FINISHED = True
        atv.close()


def fetch_raop_from_atv(atv: AppleTV) -> RaopStream:
    if not hasattr(atv.stream, "_interfaces"):
        return None
    interfaces = list(atv.stream._interfaces.keys())
    raop_interface = [
        interface for interface in interfaces if interface == Protocol.RAOP]
    if len(raop_interface) > 0:
        return atv.stream._interfaces[raop_interface[0]]
    return None


async def monitor_stream(stream_timeout: int):
    global LAST_SEEN_STREAM, STREAM_FINISHED
    while True:
        if STREAM_FINISHED:
            _LOGGER.info(
                f"STREAM_FINISHED: {STREAM_FINISHED}")
            return

        last_seen_sec = (datetime.now() - LAST_SEEN_STREAM).seconds
        _LOGGER.debug(
            f"STREAM_LAST_SEEN: {last_seen_sec}sec time:{LAST_SEEN_STREAM}")
        if last_seen_sec > stream_timeout and not STREAM_FINISHED:
            raise "timeout"
        await asyncio.sleep(1)


async def update_stream_metadata(metadata_url: str, stream_artwork: str, raop: RaopStream):
    if metadata_url is None:
        _LOGGER.warn(f"No metadata url provided")
        return

    if raop is None:
        _LOGGER.warn(f"No RAOP Stream available for device")
        return

    loop = asyncio.get_running_loop()
    metadata_updated = False
    while True:
        artwork_url = None
        if metadata_url:
            response = await loop.run_in_executor(None, urllib.request.urlopen, metadata_url)
            string = response.read().decode('utf-8')
            data = json.loads(string)
            _LOGGER.debug(f"METADATA: {data[0]}")
            current_song = data[0]
            if 'song' in current_song:
                if media.title != current_song['song']:
                    media.title = current_song['song']
                    metadata_updated = False
            if 'singer' in current_song:
                media.album = current_song['singer']

            if 'cover' in current_song:
                artwork_url = current_song['cover']

        if not metadata_updated:
            raop_client: RaopClient = raop if isinstance(
                raop, RaopClient) else raop.playback_manager.raop
            if  raop_client._is_playing:
                _LOGGER.debug(f"METADATA updated media: {media}")
                await raop_client.rtsp.set_metadata(
                    raop_client.context.rtsp_session,
                    raop_client.context.rtpseq,
                    raop_client.context.rtptime,
                    media,
                )
                artwork_url = stream_artwork if not artwork_url else artwork_url
                _LOGGER.debug(f"METADATA updated artwork: {artwork_url}")
                await update_stream_artwork(loop, artwork_url, raop_client)
                metadata_updated = True

        await asyncio.sleep(15)


async def update_stream_artwork(loop, artwork_url, raop_client):
    if not artwork_url:
        return

    artwork_response = await loop.run_in_executor(None, urllib.request.urlopen, artwork_url)
    artwork = artwork_response.read()
    artwork_type = None
    if artwork_url.endswith('.jpg') or artwork_url.endswith('.jpeg'):
        artwork_type = "image/jpeg"
    elif artwork_url.endswith('.png'):
        artwork_type = "image/png"

    if artwork_type is None:
        _LOGGER.info(f"UNSUPPORTED METADATA COVER: {artwork_url}")
        return

    try:
        await raop_client.rtsp.exchange(
            "SET_PARAMETER",
            content_type=artwork_type,
            headers={
                "Content-Length": len(artwork),
                "Session": raop_client.context.rtsp_session,
                "RTP-Info": f"seq={raop_client.context.rtpseq};rtptime={raop_client.context.rtptime}",
            },
            body=artwork
        )
    except Exception as ex:
        _LOGGER.error(f"METADATA COVER SET_PARAMETER error: {ex}")


async def cli_handler(loop):
    """Application starts here."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "-i",
        "--id",
        help="device identifier",
        dest="id",
        default=None,
        required=True
    )

    parser.add_argument(
        "-t",
        "--title",
        help="stream title",
        dest="title",
        default=None,
        required=True
    )

    parser.add_argument(
        "-a",
        "--album",
        help="stream album",
        dest="album",
        default=None,
        required=True
    )

    parser.add_argument(
        "-u",
        "--stream_url",
        help="stream url",
        dest="stream_url",
        default=None,
        required=True
    )

    parser.add_argument(
        "-o",
        "--stream_timeout",
        help="stream timeout",
        dest="stream_timeout",
        default=5,
        required=False
    )

    parser.add_argument(
        "-m",
        "--stream_metadata",
        help="stream metadata",
        dest="stream_metadata",
        default=5,
        required=False
    )

    parser.add_argument(
        "-w",
        "--stream_artwork",
        help="stream artwork",
        dest="stream_artwork",
        default=5,
        required=False
    )

    parser.add_argument(
        "-v",
        "--verbose",
        help="increase output verbosity",
        action="store_true",
        dest="verbose",
    )

    args = parser.parse_args()

    loglevel = logging.INFO
    if args.verbose:
        loglevel = logging.DEBUG

    logging.basicConfig(
        level=loglevel,
        stream=sys.stdout,
        datefmt="%Y-%m-%d %H:%M:%S",
        format="%(asctime)s %(levelname)s [%(name)s]: %(message)s",
    )
    logging.getLogger("requests").setLevel(logging.WARNING)

    log_current_version()

    media.title = args.title
    media.album = args.album
    await asyncio.gather(
        monitor_stream(int(args.stream_timeout)),
        stream_with_push_updates(args.id, args.stream_url, args.stream_metadata, args.stream_artwork, loop))


async def appstart(loop):
    """Start the asyncio event loop and runs the application."""
    # Helper method so that the coroutine exits cleanly if an exception
    # happens (which would leave resources dangling)
    async def _run_application(loop):
        try:
            return await cli_handler(loop)

        except KeyboardInterrupt:
            pass  # User pressed Ctrl+C, just ignore it

        except SystemExit:
            pass  # sys.exit() was used - do nothing

        # except Exception:  # pylint: disable=broad-except  # noqa
        #     sys.stderr.writelines("\n>>> An error occurred, full stack trace above\n")

        return 1

    try:
        return await _run_application(loop)
    except KeyboardInterrupt:
        pass

    return 1


def main():
    """Application start here."""
    loop = asyncio.get_event_loop()
    return loop.run_until_complete(appstart(loop))


if __name__ == "__main__":
    sys.exit(main())
