# !/usr/bin/python3

from io import BufferedReader, BufferedReader
from typing import Union
from datetime import datetime
import io
import subprocess as sp
import urllib.request
import traceback
import asyncio
import sys
import os
import logging
import json

import argparse

from urllib.parse import urlparse

import pyatv

from pyatv.interface import PushListener, DeviceListener, AppleTV
from pyatv.const import Protocol
from pyatv.protocols.raop import RaopClient, RaopStream
from pyatv.scripts import (
    log_current_version,
)

# fake media file for title/album
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


def is_valid_url(url) -> bool:
    try:
        result = urlparse(url)
        return all([result.scheme, result.netloc])
    except:
        return False


class StreamMetadata:
    title: str
    album: str
    stream_url:  str
    metadata_url: str
    artwork_url: str
    stream_timeout: int
    stream_volume: int

    def __init__(self,
                 title: str,
                 album: str,
                 stream_url: str,
                 metadata_url: str,
                 artwork_url: str,
                 stream_timeout: int,
                 volume: int
                 ) -> None:
        self.title = title
        self.album = album
        self.stream_url = stream_url
        self.metadata_url = metadata_url
        self.artwork_url = artwork_url
        self.stream_timeout = stream_timeout
        self.stream_volume = volume

    def toJSON(self) -> str:
        return json.dumps(self.__dict__)


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


def fetch_raop_from_atv(atv: AppleTV) -> RaopStream:
    try:
        if not hasattr(atv.stream, "_interfaces"):
            return None
        interfaces = list(atv.stream._interfaces.keys())
        raop_interface = [
            interface for interface in interfaces if interface == Protocol.RAOP]
        if len(raop_interface) > 0:
            return atv.stream._interfaces[raop_interface[0]]
    except Exception as ex:
        _LOGGER.error(f"ATV RAOP error: {ex}")

    return None


async def monitor_stream(atv: AppleTV, stream_timeout: int):
    global LAST_SEEN_STREAM, STREAM_FINISHED
    while True:
        if STREAM_FINISHED:
            _LOGGER.info(
                f"STREAM_FINISHED: {STREAM_FINISHED}")
            return

        last_seen_sec = (datetime.now() - LAST_SEEN_STREAM).seconds
        _LOGGER.debug(
            f"STREAM_LAST_SEEN: {last_seen_sec}sec time:{LAST_SEEN_STREAM} timeout:{stream_timeout}")
        if last_seen_sec > stream_timeout and not STREAM_FINISHED:
            raise "timeout"

        # update playback progress
        await update_playback_progress(atv)

        await asyncio.sleep(2)


async def update_playback_progress(atv: AppleTV):
    if atv is None:
        _LOGGER.debug(f"PLAYBACK: UPDATE DURATION SKIPPED")
        return

    raop = fetch_raop_from_atv(atv)
    if raop is None:
        _LOGGER.debug(f"PLAYBACK: UPDATE DURATION SKIPPED - stream is blocked")
        return
    raop_client: RaopClient = raop if isinstance(
        raop, RaopClient) else raop.playback_manager.raop
    if (raop_client is not None) and raop_client._is_playing:
        start = raop_client.context.start_ts
        now = raop_client.context.rtptime
        end = start + raop_client.context.sample_rate * 100
        _LOGGER.debug(
            f"PLAYBACK: UPDATING DURATION: {int(now / 2)}/{now}/{end}")
        try:
            await raop_client.rtsp.set_parameter("progress", f"{int(now / 2)}/{now}/{end}")
        except Exception as ex:
            _LOGGER.error(f"PLAYBACK: UPDATE DURATION error: {ex}")


async def update_stream_metadata(metadata: StreamMetadata, raop: RaopStream) -> None:
    _LOGGER.info(f"METADATA update : {metadata.toJSON()}")
    if not is_valid_url(metadata.metadata_url):
        _LOGGER.warning(f"METADATA invalid metadata url provided")

    if raop is None:
        _LOGGER.warning(f"No RAOP Stream available for device")
        return

    loop = asyncio.get_running_loop()
    artwork_url = metadata.artwork_url
    media.title = metadata.title
    media.title = metadata.album
    metadata_updated = False
    while True:
        (title, album, artwork_url, success) = await fetch_stream_metadata(loop, metadata)

        _LOGGER.info(
            f"METADATA fetch: ({title}, {album}, {artwork_url}, {success})")
        if success:
            if title != media.title:
                media.title = title
                metadata_updated = False
            if album != media.album:
                media.album = album
                metadata_updated = False

        if not metadata_updated:
            _LOGGER.info(f"METADATA need to update metadata")
            raop_client: RaopClient = raop if isinstance(
                raop, RaopClient) else raop.playback_manager.raop

            if raop_client is None:
                _LOGGER.info(
                    f"METADATA not updated metadata: RAOP client not ready")
                await asyncio.sleep(15)
                continue

            if not raop_client._is_playing:
                _LOGGER.info(
                    f"METADATA not updated metadata: client not playing")
                continue

            metadata_updated = await update_stream_media(raop_client)

            _LOGGER.info(f"METADATA updating artwork: {artwork_url}")
            metadata_updated = metadata_updated and await update_stream_artwork(loop, artwork_url, raop_client)
        else:
            _LOGGER.info(f"METADATA update skipped: no changes")

        await asyncio.sleep(15)


async def fetch_stream_metadata(loop, metadata: StreamMetadata) -> (str, str, str, bool):
    title = metadata.title
    album = metadata.album
    artwork_url = metadata.artwork_url
    success = False

    if not is_valid_url(metadata.metadata_url):
        return (title, album, artwork_url, success)

    try:
        response = await loop.run_in_executor(None, urllib.request.urlopen, metadata.metadata_url)
        if response.getcode() >= 400:
            _LOGGER.warning(
                f"METADATA: error getting metadata, code: {response.getcode()}")
            return (title, album, artwork_url, success)
        string = response.read().decode('utf-8')
        data = json.loads(string)
        _LOGGER.debug(f"METADATA: {data[0]}")

        current_song = data[0]

        if 'song' in current_song:
            title = current_song['song']
            success = True

        if 'singer' in current_song:
            album = current_song['singer']
            success = True

        if 'cover' in current_song:
            artwork_url = current_song['cover']
            success = True

        return (title, album, artwork_url, success)
    except Exception as ex:
        _LOGGER.error(f"METADATA error: {ex}")
        traceback.print_exception(*sys.exc_info())
        return (title, album, artwork_url, success)


async def update_stream_media(raop_client: RaopClient) -> bool:
    try:
        _LOGGER.info(
            f"METADATA updating media title:'{media.title}' album:'{media.album}'")
        await raop_client.rtsp.set_metadata(
            raop_client.context.rtsp_session,
            raop_client.context.rtpseq,
            raop_client.context.rtptime,
            media,
        )
        return True
    except Exception as ex:
        _LOGGER.error(f"METADATA COVER SET_PARAMETER error: {ex}")
        return False


async def update_stream_artwork(loop, artwork_url: str, raop_client: RaopClient) -> bool:
    if not artwork_url:
        _LOGGER.info(f"METADATA update artwork skipped: empty artwork")
        return False

    artwork = None
    try:
        artwork_response = await loop.run_in_executor(None, urllib.request.urlopen, artwork_url)
        artwork = artwork_response.read()
    except Exception as ex:
        _LOGGER.error(f"METADATA READ ARTWORK error: {ex}")
        return False

    artwork_type = None
    if artwork_url.endswith('.jpg') or artwork_url.endswith('.jpeg'):
        artwork_type = "image/jpeg"
    elif artwork_url.endswith('.png'):
        artwork_type = "image/png"

    if artwork_type is None:
        _LOGGER.info(f"METADATA unsupported cover type: {artwork_url}")
        return False

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
        _LOGGER.info(f"METADATA updated artwork from url: {artwork_url}")
        return True
    except Exception as ex:
        _LOGGER.error(f"METADATA COVER SET_PARAMETER error: {ex}")
        return False


async def cli_handler(loop) -> None:
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
        required=False
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
        "-f",
        "--file",
        help="file to stream",
        dest="file_path",
        default=None,
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
        "-l",
        "--volume",
        help="stream volume",
        dest="volume",
        default=None,
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

    stream_metadata = StreamMetadata(args.title,
                                     args.album,
                                     args.stream_url,
                                     args.stream_metadata,
                                     args.stream_artwork,
                                     args.stream_timeout,
                                     int(args.volume) if args.volume else 0)

    media.title = args.title
    media.album = args.album
    if args.file_path is None:
        await start_streaming_url(args.id, stream_metadata, loop)
    else:
        await start_streaming_file(args.id, args.file_path, int(args.volume) if args.volume else 0, loop)


async def prepare_atv(id: str, loop: asyncio.AbstractEventLoop) -> AppleTV:
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
    return atv


async def do_streaming_file(
        atv: AppleTV,
        file_path: str,
        volume: int,
        retry_count: int):
    try:
        if volume > 0:
            await atv.audio.set_volume(volume)
        await atv.stream.stream_file(file_path)
        await asyncio.sleep(1)
    except Exception as ex:
        _LOGGER.error(f"ATV file streaming error: {ex}")
        if retry_count < 3:
            await do_streaming_file(atv, file_path, volume, retry_count + 1)


async def start_streaming_file(
    id: str, file_path: str, volume: int, loop: asyncio.AbstractEventLoop
):

    atv = await prepare_atv(id, loop)
    try:
        _LOGGER.info(f"* Starting to stream {file_path} ",)
        await do_streaming_file(atv, file_path, volume, 0)
    finally:
        atv.close()


async def start_streaming_url(
    id: str, metadata: StreamMetadata, loop: asyncio.AbstractEventLoop
):
    atv = await prepare_atv(id, loop)

    ffmpeg_cmd = ['ffmpeg',
                  '-rtbufsize', '25M',
                  '-i', metadata.stream_url,
                  '-f', 'mp3',
                  '-']
    ffmpeg_proc = sp.Popen(ffmpeg_cmd, stdout=sp.PIPE)
    raop_stream = fetch_raop_from_atv(atv)

    try:
        _LOGGER.info("* Starting to stream stdin",)
        if metadata.stream_volume > 0:
            await atv.audio.set_volume(metadata.stream_volume)

        await asyncio.gather(
            monitor_stream(atv, int(metadata.stream_timeout)),
            update_stream_metadata(metadata, raop_stream),
            atv.stream.stream_file(BufferedReaderListener(ffmpeg_proc.stdout)))
        await asyncio.sleep(1)
    finally:
        STREAM_FINISHED = True
        atv.close()


async def appstart(loop) -> None:
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


def main() -> None:
    """Application start here."""
    loop = asyncio.get_event_loop()
    return loop.run_until_complete(appstart(loop))


if __name__ == "__main__":
    sys.exit(main())
