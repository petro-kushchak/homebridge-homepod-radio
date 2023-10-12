# !/usr/bin/python3

import io
import urllib.request
import traceback
import sys
import logging
import json
import asyncio
import asyncio.subprocess as asp
from asyncio.streams import StreamReader
from io import BufferedReader, BufferedReader
from datetime import datetime

from pyatv.interface import MediaMetadata

import argparse
from urllib.parse import urlparse


import pyatv
from pyatv.interface import PushListener, DeviceListener, AppleTV
from pyatv.scripts import (
    log_current_version,
)

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
    telegram_update_token: str
    telegram_update_chat_id: str
    stream_timeout: int
    volume: int

    def __init__(self,
                 title: str,
                 album: str,
                 stream_url: str,
                 metadata_url: str,
                 artwork_url: str,
                 telegram_update_token: str,
                 telegram_update_chat_id: str,
                 stream_timeout: int,
                 volume: int
                 ) -> None:
        self.title = title
        self.album = album
        self.stream_url = stream_url
        self.metadata_url = metadata_url
        self.artwork_url = artwork_url
        self.telegram_update_token = telegram_update_token
        self.telegram_update_chat_id = telegram_update_chat_id
        self.stream_timeout = stream_timeout
        self.volume = volume

    def toJSON(self) -> str:
        return json.dumps(self.__dict__)

class StreamReaderListener (StreamReader):
    """Stream Reader with heartbeat"""

    def __init__(self, reader: StreamReader, heartbeat) -> None:
        super().__init__(2048)
        self.reader = reader
        self.heartbeat = heartbeat

    async def read(self, n: int = -1) -> bytes:
        self.heartbeat()
        data = await self.reader.read(n)
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

    async def set_volume(self, volume: int, retry_count = 0) -> None:
        try:
            await self.atv.audio.set_volume(volume)
        except Exception as ex:
            if retry_count < 3:
                self.logger.error(
                    f"failed to set volume, retrying: {retry_count}")
                await self.set_volume(volume, retry_count + 1)
            else:
                self.logger.error(
                    f"failed to set volume, error: {ex}")

    async def update_artwork(self, artwork, artwork_type: str) -> bool:
        pass

    async def stream_buffer(self, stream: io.BufferedReader, metadata: MediaMetadata) -> None:
        await self.atv.stream.stream_file(stream, metadata)

    async def stream_file(self, file: str, metadata: MediaMetadata) -> None:
        await self.atv.stream.stream_file(file, metadata)


class AtvStreamer:

    def __init__(self, atv_identifier: str, loop: asyncio.AbstractEventLoop, logger: logging.Logger) -> None:
        self.atv = AtvWrapper(atv_identifier, loop, logger)
        self.loop = loop
        self.logger = logger
        self.streaming_finished = False
        self.last_seen_stream = datetime.now()

    def stream_heartbeat(self) -> None:
        self.last_seen_stream = datetime.now()

    async def set_volume(self, volume: int, connect_atv: bool = False) -> None:
        if connect_atv:
            await self.atv.connect()
        try:
            await self.atv.set_volume(volume)
        finally:
            if connect_atv:
                self.atv.close()

    async def stream_url(self, stream_config: StreamConfig) -> None:
        atv_connected = await self.atv.connect()

        if not atv_connected:
            self.logger.error(
                f"* Could not connect to ATV id: {self.atv.atv_identifier}")
            return

        ffmpeg_proc = await asp.create_subprocess_exec(
            'ffmpeg',
            '-rtbufsize', '25M',
            '-i', stream_config.stream_url,
            '-f', 'mp3',
            '-',
            stdin=None, stdout=asp.PIPE, stderr=None,
        )

        try:
            self.logger.info(
                f"* Starting to stream url: {stream_config.stream_url}")
            if stream_config.volume > 0:
                await self.set_volume(stream_config.volume)

            metadata = await self.prepare_metadata(stream_config)
            await asyncio.gather(
                self.stream_monitor(int(stream_config.stream_timeout)),
                self.refresh_metadata(stream_config),
                self.internal_stream_url(metadata, StreamReaderListener(ffmpeg_proc.stdout, self.stream_heartbeat), 0))
            await asyncio.sleep(1)
        except Exception as ex:
            self.logger.error(
                f"streaming error: {ex}")
            traceback.print_exc()
        finally:
            self.streaming_finished = True
            self.atv.close()

    async def prepare_metadata(self, stream_config: StreamConfig) -> MediaMetadata:
        artwork = await self.get_artwork(stream_config.artwork_url)
        return MediaMetadata(title=stream_config.title,
                             album=stream_config.album,
                             artist=None,
                             artwork=artwork)

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
                raise TimeoutError("stream timeout")

            # update playback progress
            # await self.atv.update_playback_progress()

            await asyncio.sleep(2)

    async def get_artwork(self, artwork_url: str) -> bytes:
        if not artwork_url:
            self.logger.info(f"METADATA get artwork skipped: empty artwork")
            return None

        artwork = None
        try:
            artwork_response = await self.loop.run_in_executor(None, urllib.request.urlopen, artwork_url)
            artwork = artwork_response.read()
            return artwork
        except Exception as ex:
            self.logger.error(f"METADATA GET ARTWORK error: {ex}")
            return artwork

    async def update_artwork(self, artwork_url: str) -> bool:
        artwork = await self.get_artwork(artwork_url)
        if artwork is None:
            return False

        artwork_type = None
        if artwork_url.endswith('.jpg') or artwork_url.endswith('.jpeg'):
            artwork_type = "image/jpeg"
        elif artwork_url.endswith('.png'):
            artwork_type = "image/png"

        if artwork_type is None:
            self.logger.info(
                f"METADATA unsupported artwork type: {artwork_url}")
            return False

        self.logger.info(f"METADATA updated artwork from url: {artwork_url}")
        return await self.atv.update_artwork(artwork, artwork_type)

    async def refresh_metadata(self, stream_config: StreamConfig) -> None:
        self.logger.info(f"METADATA update: {stream_config.toJSON()}")
        if not is_valid_url(stream_config.metadata_url):
            self.logger.warning(f"METADATA invalid metadata url provided")

        metadata_updated = False
        metadata_title = None
        while True:
            stream_metadata = await fetch_stream_metadata(self.loop, stream_config)
            self.logger.info(
                f"METADATA fetch: ({stream_metadata.title}, {stream_metadata.album}, {stream_metadata.artwork_url}, {stream_metadata.ready})")
            if stream_metadata.ready:
                if metadata_title != stream_metadata.title:
                    metadata_title = stream_metadata.title
                    metadata_updated = True
                else:
                    metadata_updated = False
            
            if metadata_updated and (stream_config.telegram_update_token is not None):
                await self.notify_stream_metadata_changed(stream_config, stream_metadata)

            await asyncio.sleep(5)

    async def notify_stream_metadata_changed(self, stream_config: StreamConfig, metadata: StreamMetadata) -> None:
        escape_telegram_content = lambda txt: [txt := txt.replace(c, f"\{c}") for c in list("-[]_.!()")][-1]
        try:
            # notificaiton content:
            # \[*Radio%1*\][*The%20Beatles*%20\-%20Ob\-La\-Di,%20Ob\-La\-D](https://www.radio.com/static/img/content/cover/2/19/500x500.jpg)

            # escape reserved characters
            stream_title = escape_telegram_content(stream_config.title)
            metadata_artist = escape_telegram_content(metadata.artist)
            metadata_title = escape_telegram_content(metadata.title)
            
            #if stream artwork_url empty - use default one
            artwork_url = metadata.artwork_url if metadata.artwork_url != '' else stream_config.artwork_url

            telegram_api_url = f"https://api.telegram.org/bot{stream_config.telegram_update_token}/sendMessage?"
            notification_content = f"\[*{stream_title}*\] [*{metadata_artist}* \- {metadata_title}]({artwork_url})"
            params = {
                'chat_id': stream_config.telegram_update_chat_id,
                'parse_mode': 'MarkdownV2',
                'text': notification_content
            }
            notification_url = f"{telegram_api_url}{urllib.parse.urlencode(params)}"
            self.logger.info(
                f"NOTIFY stream Metadata: ({stream_title}, {metadata_artist}, {metadata_title}, {artwork_url})")
            await self.loop.run_in_executor(None, urllib.request.urlopen, notification_url)
        except Exception as ex:
            _LOGGER.error(f"NOTIFY stream Metadata error: {ex}, url: {notification_url}")
            traceback.print_exception(*sys.exc_info())
        
    async def internal_stream_url(self, metadata: MediaMetadata, reader: BufferedReader, retry_count: int):
        try:
            await self.atv.stream_buffer(reader, metadata)
        except TimeoutError as ex:
            if len(ex.args) > 0 and ("TEARDOWN" in ex.args[0]):
                self.logger.error(f"ATV streaming canceled, reason: {ex}")
                raise ex
        except Exception as ex:
            self.logger.error(
                f"ATV url streaming error: {ex} attempt: {retry_count}")
            if retry_count < 3:
                await self.internal_stream_url(metadata, reader, retry_count + 1)
            else:
                raise ex

    async def stream_file(self, file_path: str, stream_config: StreamConfig) -> None:
        await self.atv.connect()
        try:
            self.logger.info(f"* Starting to stream {file_path} ",)
            if stream_config.volume > 0:
                await self.set_volume(stream_config.volume)
            metadata = await self.prepare_metadata(stream_config)
            await self.internal_stream_file(file_path, metadata, 0)
        finally:
            self.atv.close()

    async def internal_stream_file(self, file_path: str, metadata: MediaMetadata, retry_count: int):
        try:
            await self.atv.stream_file(file_path, metadata)
            await asyncio.sleep(1)
        except Exception as ex:
            self.logger.error(
                f"ATV file streaming error: {ex} attempt: {retry_count}")
            if retry_count < 3:
                await self.internal_stream_file(file_path, retry_count + 1)


async def fetch_stream_metadata(loop, stream_config: StreamConfig) -> MediaMetadata:
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
        required=False
    )

    parser.add_argument(
        "-a",
        "--album",
        help="stream album",
        dest="album",
        default=None,
        required=False
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
        "--stream_artwork",
        help="stream artwork",
        dest="stream_artwork",
        default=None,
        required=False
    )

    parser.add_argument(
        "--telegram_update_token",
        help="telegram update token",
        dest="telegram_update_token",
        default=None,
        required=False
    )
    
    parser.add_argument(
        "--telegram_update_chat_id",
        help="telegram update chat id",
        dest="telegram_update_chat_id",
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
                                 args.telegram_update_token,
                                 args.telegram_update_chat_id,
                                 args.stream_timeout,
                                 int(args.volume) if args.volume else 0)

    atvStreamer = AtvStreamer(args.id, loop, _LOGGER)

    if args.file_path is not None:
        await atvStreamer.stream_file(args.file_path, stream_config)
    elif stream_config.stream_url is not None:
        await atvStreamer.stream_url(stream_config)
    elif stream_config.volume > 0: 
        await atvStreamer.set_volume(stream_config.volume, True)
    else:
        _LOGGER.error("Nothing to do")



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
