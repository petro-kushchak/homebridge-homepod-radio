#!/usr/bin/python3
# -*- coding: utf-8 -*-
from curses import meta
from io import BufferedReader, BufferedReader

import asyncio
import sys
import os
import logging
import signal

import argparse
import pyatv

from pyatv.interface import PushListener, DeviceListener
from pyatv.scripts import (
    log_current_version,
)

from mediafile import MediaFile

media = MediaFile(os.path.dirname(__file__) + '/dummy.mp3')

old__open_file = pyatv.support.metadata._open_file
def new_open_file(file: BufferedReader) -> MediaFile:
    return media
pyatv.support.metadata._open_file=new_open_file

LOOP = asyncio.get_event_loop()
_LOGGER = logging.getLogger(__name__)


class GracefulTermination:
  def __init__(self):
    signal.signal(signal.SIGINT, self.exit_gracefully)
    signal.signal(signal.SIGTERM, self.exit_gracefully)

  def exit_gracefully(self, *args):
    _LOGGER.info("Terminating process...")
    sys.exit()


class PushUpdatePrinter(PushListener):
    """Internal listener for push updates."""

    @staticmethod
    def playstatus_update(_, playstatus):
        """Print what is currently playing when it changes."""
        _LOGGER.info(str(playstatus))
        _LOGGER.info(20 * "-")

    @staticmethod
    def playstatus_error(_, exception):
        """Inform about an error and restart push updates."""
        _LOGGER.info(f"An error occurred (restarting): {exception}")


class DeviceUpdatePrinter(DeviceListener):
    """Internal listener for generic device updates."""

    def connection_lost(self, exception):
        """Call when unexpectedly being disconnected from device."""
        _LOGGER.info("Connection lost, stack trace below:")

    def connection_closed(self):
        """Call when connection was (intentionally) closed."""
        _LOGGER.info("Connection was closed properly")



async def stream_with_push_updates(
    id: str, loop: asyncio.AbstractEventLoop
):
    """Find a device and print what is playing."""
    _LOGGER.info("* Discovering device on network...")
    atvs = await pyatv.scan(loop, identifier=id, timeout=5)

    if not atvs:
        _LOGGER.info("* No Device found")
        return

    conf = atvs[0]

    _LOGGER.info(f"* Connecting to {conf.address}")
    atv = await pyatv.connect(conf, loop)

    push_listener = PushUpdatePrinter()
    device_listener = DeviceUpdatePrinter()
    
    atv.listener = device_listener
    atv.push_updater.listener = push_listener
    atv.push_updater.start()
    
    try:
        _LOGGER.info("* Starting to stream stdin",)
        term = GracefulTermination()
        await atv.stream.stream_file(sys.stdin.buffer)
        await asyncio.sleep(1)
    finally:
        atv.close()


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
    await stream_with_push_updates(args.id, loop)


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