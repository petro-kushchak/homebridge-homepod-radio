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
from pyatv.protocols.dmap import tags
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

_LOGGER = logging.getLogger(__name__)


def is_valid_url(url) -> bool:
    try:
        result = urlparse(url)
        return all([result.scheme, result.netloc])
    except:
        return False


class StreamMetadata:
    """Stream Metadata"""
    title: str
    album: str
    artist: str
    artwork_url: str
    ready: bool

    def __init__(self,
                 title: str,
                 album: str,
                 artist: str,
                 artwork_url: str,
                 ready: str) -> None:
        self.title = title
        self.album = album
        self.artist = artist
        self.artwork_url = artwork_url
        self.ready = ready


class StreamConfig:
    """Stream Configuration"""

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
    """Stream Reader with heartbeat"""
    def __init__(self, reader: BufferedReader, heartbeat) -> None:
        super().__init__(reader.raw, 2048)
        self.reader = reader
        self.heartbeat = heartbeat

    def peek(self, __size: int = ...) -> bytes:
        return self.reader.peek(__size)

    def read1(self, __size: int = ...) -> bytes:
        return self.reader.read1(__size)

    def read(self, __size: int = ...) -> bytes:
        self.heartbeat()
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

    def __init__(self, logger: logging.Logger) -> None:
        self.logger = logger

    def connection_lost(self, exception):
        """Call when unexpectedly being disconnected from device."""
        self.logger.error("Connection lost, stack trace below:")

    def connection_closed(self):
        """Call when connection was (intentionally) closed."""
        self.logger.info("Connection was closed properly")


class AtvWrapper:
    """Internal ATV API wrapper"""

    def __init__(self, atv_identifier: str, loop: asyncio.AbstractEventLoop, logger: logging.Logger) -> None:
        self.atv = None
        self.raop_stream = None
        self.atv_identifier = atv_identifier
        self.loop = loop
        self.logger = logger

    def close(self) -> None:
        if self.atv is not None:
            self.atv.close()

    async def connect(self) -> bool:
        """Find a device and print what is playing."""
        self.logger.debug("* Discovering device on network...")
        atvs = await pyatv.scan(self.loop, identifier=self.atv_identifier, timeout=5)

        if not atvs:
            self.logger.error("* No Device found")
            return False

        conf = atvs[0]

        self.logger.info(f"* Connecting to {conf.address}")
        self.atv = await pyatv.connect(conf, self.loop)

        push_listener = PushUpdatePrinter()
        device_listener = DeviceUpdatePrinter(self.logger)

        self.atv.listener = device_listener
        self.atv.push_updater.listener = push_listener
        self.atv.push_updater.start()
        return True

    async def set_volume(self, volume: int) -> None:
        await self.atv.audio.set_volume(volume)

    def update_raop_stream(self) -> RaopStream:
        self.raop_stream = None
        try:
            if not hasattr(self.atv.stream, "_interfaces"):
                return None
            interfaces = list(self.atv.stream._interfaces.keys())
            raop_interface = [
                interface for interface in interfaces if interface == Protocol.RAOP]
            if len(raop_interface) > 0:
                self.raop_stream = self.atv.stream._interfaces[raop_interface[0]]
        except Exception as ex:
            self.logger.error(f"ATV RAOP error: {ex}")

        return None

    async def rtsp_set_metadata(self, raop_client: RaopClient, metadata: MediaFile) -> bool:
        """Change metadata for what is playing."""
        try:
            self.logger.info(
                f"METADATA updating media title:'{media.title}' album:'{media.album}'")
            payload = b""
            if metadata.title:
                payload += tags.string_tag("minm", f"{metadata.album} - {metadata.title}")
            if metadata.album:
                payload += tags.string_tag("asal", metadata.album)
            if metadata.artist:
                payload += tags.string_tag("asar", metadata.album)
            payload += tags.uint32_tag("caps", 1)

            await raop_client.rtsp.exchange(
                "SET_PARAMETER",
                content_type="application/x-dmap-tagged",
                headers={
                    "Session": raop_client.context.rtsp_session,
                    "RTP-Info": f"seq={raop_client.context.rtpseq};rtptime={raop_client.context.rtptime}",
                },
                body=tags.container_tag("mlit", payload),
            )
            return True
        except Exception as ex:
            self.logger.error(f"METADATA ARTWORK SET_PARAMETER error: {ex}")
            return False

    async def ready(self) -> bool:
        return self.raop_stream is not None

    def get_raop_client(self) -> RaopClient:
        return self.raop_stream if isinstance(self.raop_stream, RaopClient) else self.raop_stream.playback_manager.raop

    async def update_playback_progress(self) -> None:
        if self.atv is None:
            self.logger.debug(f"PLAYBACK: UPDATE DURATION SKIPPED")
            return

        self.update_raop_stream()
        if self.ready() is None:
            self.logger.debug(
                f"PLAYBACK: UPDATE DURATION SKIPPED - stream is blocked")
            return

        raop_client = self.get_raop_client()
        if (raop_client is not None) and raop_client._is_playing:
            start = raop_client.context.start_ts
            now = raop_client.context.rtptime
            end = start + raop_client.context.sample_rate * 100
            self.logger.debug(
                f"PLAYBACK: UPDATING DURATION: {int(now / 2)}/{now}/{end}")
            try:
                await raop_client.rtsp.set_parameter("progress", f"{int(now / 2)}/{now}/{end}")
            except Exception as ex:
                self.logger.error(f"PLAYBACK: UPDATE DURATION error: {ex}")

    async def update_artwork(self, artwork, artwork_type: str) -> bool:
        try:
            raop_client = self.get_raop_client()
            if (raop_client is None):
                return False

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
            self.logger.error(f"METADATA ARTWORK SET_PARAMETER error: {ex}")
            return False

    async def stream_buffer(self, stream: io.BufferedReader) -> None:
        await self.atv.stream.stream_file(stream)

    async def stream_file(self, file: str) -> None:
        await self.atv.stream.stream_file(file)

    async def update_metadata(self, media: MediaFile) -> bool:
        raop_client: RaopClient = self.raop_stream if isinstance(
            self.raop_stream, RaopClient) else self.raop_stream.playback_manager.raop

        if raop_client is None:
            self.logger.info(
                f"METADATA not updated metadata: RAOP client not ready")
            await asyncio.sleep(15)
            return False

        if not raop_client._is_playing:
            self.logger.info(
                f"METADATA not updated metadata: client not playing")
            return False

        return await self.rtsp_set_metadata(raop_client, media)


class AtvStreamer:

    def __init__(self, atv_identifier: str, loop: asyncio.AbstractEventLoop, logger: logging.Logger) -> None:
        self.atv = AtvWrapper(atv_identifier, loop, logger)
        self.loop = loop
        self.logger = logger
        self.streaming_finished = False
        self.last_seen_stream = datetime.now()

    def stream_heartbeat(self) -> None:
        self.last_seen_stream = datetime.now()

    async def stream_url(self, stream_config: StreamConfig) -> None:
        await self.atv.connect()

        ffmpeg_cmd = ['ffmpeg',
                      '-rtbufsize', '25M',
                      '-i', stream_config.stream_url,
                      '-f', 'mp3',
                      '-']
        ffmpeg_proc = sp.Popen(ffmpeg_cmd, stdout=sp.PIPE)

        try:
            self.logger.info(
                f"* Starting to stream url: {stream_config.stream_url}")
            if stream_config.stream_volume > 0:
                await self.atv.set_volume(stream_config.stream_volume)

            await asyncio.gather(
                self.stream_monitor(int(stream_config.stream_timeout)),
                self.refresh_metadata(stream_config),
                self.internal_stream_url(BufferedReaderListener(ffmpeg_proc.stdout, self.stream_heartbeat), 0))
            await asyncio.sleep(1)
        finally:
            self.streaming_finished = True
            self.atv.close()

    async def stream_monitor(self, stream_timeout: int):
        while True:
            if self.streaming_finished:
                self.logger.info(
                    f"STREAM_FINISHED: {self.streaming_finished}")
                return

            last_seen_sec = (datetime.now() - self.last_seen_stream).seconds
            self.logger.debug(
                f"STREAM_LAST_SEEN: {last_seen_sec}sec time:{self.last_seen_stream} timeout:{stream_timeout}")
            if last_seen_sec > stream_timeout and not self.streaming_finished:
                raise "timeout"

            # update playback progress
            await self.atv.update_playback_progress()

            await asyncio.sleep(2)

    async def update_artwork(self, artwork_url: str) -> bool:
        if not artwork_url:
            self.logger.info(f"METADATA update artwork skipped: empty artwork")
            artwork_url = self.default_artwork_url

        artwork = None
        try:
            artwork_response = await self.loop.run_in_executor(None, urllib.request.urlopen, artwork_url)
            artwork = artwork_response.read()
        except Exception as ex:
            self.logger.error(f"METADATA READ ARTWORK error: {ex}")
            return False

        artwork_type = None
        if artwork_url.endswith('.jpg') or artwork_url.endswith('.jpeg'):
            artwork_type = "image/jpeg"
        elif artwork_url.endswith('.png'):
            artwork_type = "image/png"

        if artwork_type is None:
            self.logger.info(f"METADATA unsupported artwork type: {artwork_url}")
            return False

        self.logger.info(f"METADATA updated artwork from url: {artwork_url}")
        return await self.atv.update_artwork(artwork, artwork_type)


    async def refresh_metadata(self, stream_config: StreamConfig) -> None:
        self.logger.info(f"METADATA update: {stream_config.toJSON()}")
        if not is_valid_url(stream_config.metadata_url):
            self.logger.warning(f"METADATA invalid metadata url provided")

        if not self.atv.ready():
            self.logger.warning(f"No RAOP Stream available for device")
            return

        self.default_artwork_url = stream_config.artwork_url
        artwork_url = stream_config.artwork_url
        media.title = stream_config.title
        media.title = stream_config.album
        metadata_updated = False
        while True:
            stream_metadata = await fetch_stream_metadata(self.loop, stream_config)

            self.logger.info(
                f"METADATA fetch: ({stream_metadata.title}, {stream_metadata.album}, {stream_metadata.artwork_url}, {stream_metadata.ready})")
            if stream_metadata.ready:
                if stream_metadata.title != media.title:
                    media.title = stream_metadata.title
                    metadata_updated = False
                if stream_metadata.album != media.album:
                    media.album = stream_metadata.album
                    metadata_updated = False
                artwork_url = stream_metadata.artwork_url

            if not metadata_updated:
                self.logger.info(f"METADATA need to update metadata")
                metadata_updated = await self.atv.update_metadata(media)

                self.logger.info(f"METADATA updating artwork: {artwork_url}")
                metadata_updated = metadata_updated and await self.update_artwork(artwork_url)
            else:
                self.logger.info(f"METADATA update skipped: no changes")

            await asyncio.sleep(5)

    async def internal_stream_url(self, reader: BufferedReader, retry_count: int):
        try:
            await self.atv.stream_buffer(reader)
        except Exception as ex:
            self.logger.error(
                f"ATV url streaming error: {ex} attempt: {retry_count}")
            if retry_count < 3:
                await self.internal_stream_url(reader, retry_count + 1)

    async def stream_file(self, file_path: str, volume: int) -> None:
        await self.atv.connect()
        try:
            self.logger.info(f"* Starting to stream {file_path} ",)
            if volume > 0:
                await self.atv.set_volume(volume)

            await self.internal_stream_file(file_path, 0)
        finally:
            self.atv.close()

    async def internal_stream_file(self, file_path: str, retry_count: int):
        try:
            await self.atv.stream_file(file_path)
            await asyncio.sleep(1)
        except Exception as ex:
            self.logger.error(
                f"ATV file streaming error: {ex} attempt: {retry_count}")
            if retry_count < 3:
                await self.internal_stream_file(file_path, retry_count + 1)


async def fetch_stream_metadata(loop, stream_config: StreamConfig) -> StreamMetadata:
    title = stream_config.title
    album = stream_config.album
    artwork_url = stream_config.artwork_url
    success = False

    if not is_valid_url(stream_config.metadata_url):
        return StreamMetadata(title, album, album, artwork_url, success)

    try:
        response = await loop.run_in_executor(None, urllib.request.urlopen, stream_config.metadata_url)
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

        return StreamMetadata(title, album, album, artwork_url, success)
    except Exception as ex:
        _LOGGER.error(f"METADATA error: {ex}")
        traceback.print_exception(*sys.exc_info())
        return StreamMetadata(title, album, album, artwork_url, success)


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
        default=None,
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
        default=None,
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

    stream_config = StreamConfig(args.title,
                                     args.album,
                                     args.stream_url,
                                     args.stream_metadata,
                                     args.stream_artwork,
                                     args.stream_timeout,
                                     int(args.volume) if args.volume else 0)

    media.title = args.title
    media.album = args.album

    atvStreamer = AtvStreamer(args.id, loop, _LOGGER)

    if args.file_path is None:
        if stream_config.stream_url is None:
            _LOGGER.error("STREAM_URL is required when streaming with URL")
            return
        await atvStreamer.stream_url(stream_config)
    else:
        await atvStreamer.stream_file(args.file_path, int(args.volume) if args.volume else 0)


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
