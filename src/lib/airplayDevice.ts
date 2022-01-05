/* eslint-disable @typescript-eslint/no-empty-function */

import * as child from 'child_process';
import { Logger } from 'homebridge';

/**
 * AirPlay device
 */

export class AirPlayDevice {
  private process: child.ChildProcess = null;

  constructor(
    private readonly deviceIp: string,
    private readonly logger: Logger,
  ) {}

  public play(streamUrl: string) {
    if (this.isPlaying()) {
      this.stop();
    }
    const cmd = `ffmpeg -i ${streamUrl} -f mp3 - | atvremote --id ${this.deviceIp} stream_file=-`;
    this.process = child.exec(cmd, (error, stdout, stderr) => {
      this.logger.info(stdout);
    });
  }

  public stop() {
    this.process.kill();
    this.process = null;
  }

  public isPlaying(): boolean {
    return !!this.process;
  }
}
