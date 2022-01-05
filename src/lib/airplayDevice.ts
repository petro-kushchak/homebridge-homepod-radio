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
    private readonly homepodId: string,
    private readonly logger: Logger,
  ) {}

  public play(streamUrl: string, streamName: string) {
    if (this.isPlaying()) {
      this.stop();
    }

    // create pipe for the command:
    //  ffmpeg -i ${streamUrl} -f mp3 - | atvremote --id ${this.homepodId} stream_file=-

    this.ffmpeg = child.spawn(
      'ffmpeg',
      ['-i', streamUrl, '-metadata', `title="${streamName}"`, '-f', 'mp3', '-'],
      { detached: true },
    );
    this.atvremote = child.spawn(
      'atvremote',
      ['--id', this.homepodId, 'stream_file=-'],
      { detached: true },
    );

    this.ffmpeg.stdout.pipe(this.atvremote.stdin);

    this.ffmpeg.stderr.on('data', (data) => {
      this.logger.info(`ffmpeg error: ${data}`);
    });

    this.ffmpeg.on('exit', (code, signal) => {
      this.logger.info(`ffmpeg exit: code ${code} signal ${signal}`);
    });

    this.atvremote.on('exit', (code, signal) => {
      this.logger.info(`atvremote exit: code ${code} signal ${signal}`);
    });

    this.atvremote.stderr.on('data', (data) => {
      this.logger.info(`atvremote error: ${data}`);
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
      this.ffmpeg.stdout.unpipe();
      setTimeout(() => {
        this.ffmpeg.kill();
        this.ffmpeg = null;
      }, 2000);

      setTimeout(() => {
        this.atvremote.kill();
        this.atvremote = null;
      }, 5000);
    } catch (err) {
      this.logger.info(`Error while trying to stop: ${err}`);
    }
  }

  public isPlaying(): boolean {
    return !!this.ffmpeg && !!this.atvremote;
  }
}
