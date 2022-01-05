/* eslint-disable @typescript-eslint/no-explicit-any */

import * as child from 'child_process';
import { Logger } from 'homebridge';

/**
 * AirPlay device
 */

export class AirPlayDevice {
  private ffmpeg: child.ChildProcess = null;
  private atvremote: child.ChildProcess = null;

  constructor(
    private readonly deviceIp: string,
    private readonly logger: Logger,
  ) {}

  public play(streamUrl: string) {
    if (this.isPlaying()) {
      this.stop();
    }

    // create pipe for the command:
    //  ffmpeg -i ${streamUrl} -f mp3 - | atvremote --id ${this.deviceIp} stream_file=-

    this.ffmpeg = child.spawn('ffmpeg', ['-i', streamUrl, '-f', 'mp3', '-']);
    this.atvremote = child.spawn('atvremote', [
      '--id',
      this.deviceIp,
      'stream_file=-',
    ]);
    this.ffmpeg.stdout.pipe(this.atvremote.stdin);

    this.ffmpeg.on('data', (data) => {
      this.logger.info(`ffmpeg data: ${data}`);
    });

    this.atvremote.on('data', (data) => {
      this.logger.info(`atvremote data: ${data}`);
    });

    this.logger.info(
      `spawn ffmpeg: ${this.ffmpeg.pid}  atvremote: ${this.atvremote.pid}`,
    );
  }

  public stop() {
    if (!this.isPlaying()) {
      this.logger.info('Trying to stop stopped process!');
      return;
    }
    try {
      this.logger.info(
        `Killing process: ffmpeg: ${this.ffmpeg.pid}  atvremote: ${this.atvremote.pid}`,
      );
      this.atvremote.kill();
      this.atvremote = null;
      this.ffmpeg.kill();
      this.ffmpeg = null;
    } catch (err) {
      this.logger.info(`Error while trying to stop: ${err}`);
    }
  }

  public isPlaying(): boolean {
    return !!this.ffmpeg && !!this.atvremote;
  }
}
