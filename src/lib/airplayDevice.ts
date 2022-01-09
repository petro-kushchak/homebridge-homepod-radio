/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as child from 'child_process';
import { Logger } from 'homebridge';

import { promisify } from 'util';

const execAsync = promisify(child.exec);

/**
 * AirPlay device
 */

export class AirPlayDevice {
  private readonly lastSeenThresholdMs = 3000;
  private readonly heartbeatTimeout = 5000;
  private readonly defaultPlayingStreamName: string = 'Streaming with pyatv';

  private ffmpeg: child.ChildProcess = null;
  private atvremote: child.ChildProcess = null;
  private lastSeen: number;
  private heartbeat: NodeJS.Timeout;

  constructor(
    private readonly homepodId: string,
    private readonly logger: Logger,
    private readonly verboseMode: boolean,
  ) {
  }

  public async setVolume(volume: number): Promise<boolean> {
      const setVolumeCmd = `atvremote --id ${this.homepodId} set_volume=${volume}`;
      await execAsync(setVolumeCmd);
      return true;
  }

  public async getVolume(): Promise<number> {
      const getVolumeCmd = `atvremote --id ${this.homepodId} volume`;
      const result = await execAsync(getVolumeCmd);
      try {
          return Number.parseFloat(result.stdout);
      } catch (error) {
          this.logger.info(`GetVolume error: ${error}`);
          return 0;
      }
  }

  public getPlayingTitle(callback: (title: string) => void): void {
      const currentTitleCmd = `atvremote --id ${this.homepodId} title`;
      child.exec(currentTitleCmd, (_error, stdout, _stderr) => {
          callback(stdout);
      });
  }

  public play(streamUrl: string, streamName: string) {
      const heartbeat = this.handleHearbeat.bind(this);
      const heartbeatFailed = () => {
      //identify readon and restart streaming...
          this.getPlayingTitle((title) => {
              this.debug(
                  `Received from device: ${this.homepodId} title: ${title}`,
              );
              if (title === '' || title.startsWith(this.defaultPlayingStreamName)) {
                  this.logger.info(
                      'Restarting playback...',
                  );
                  //need to restart streaming
                  this.startStreaming(
                      streamUrl,
                      streamName,
                      heartbeat,
                      heartbeatFailed,
                  );
              } else {
                  //device is used to play something else, need to change state to "STOPPED"
                  this.endStreaming();
                  this.logger.info('Streaming finished');
              }
          });
      };

      if (this.isPlaying()) {
          this.endStreaming();
          this.logger.info('Streaming finished');
          this.startStreaming(streamUrl, streamName, heartbeat, heartbeatFailed);
      } else {
          this.startStreaming(streamUrl, streamName, heartbeat, heartbeatFailed);
      }
  }

  /**
   * Streaming crash monitoring/prevention
   */
  private handleHearbeat(
      heatbeatType: string,
      heartbeatFailed: () => void,
  ): void {
      this.debug(`Playback heartbeat, source: ${heatbeatType}`);
      if (heatbeatType !== 'heartbeat') {
          this.lastSeen = Date.now();
      } else {
          const diffMs = Date.now() - this.lastSeen;
          this.debug(
              `Playback heartbeat, diff: ${diffMs}ms`,
          );
          if (diffMs > this.lastSeenThresholdMs) {
              this.debug(
                  'Playback heartbeat failed',
              );
              heartbeatFailed();
          }
      }
  }

  private startStreaming(
      streamUrl: string,
      streamName: string,
      heartbeat: (source: string, heartbeatFailed: () => void) => void,
      heartbeatFailed: () => void,
  ) {
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

      this.ffmpeg.stdout.pipe(this.atvremote.stdin).on('error', (error) => {
          this.debug(`ffmpeg pipe error: ${error}`);
      });

      this.ffmpeg.stderr.on('data', (data) => {
          this.debug(`ffmpeg error: ${data}`);
          heartbeat('ffmpeg', heartbeatFailed);
      });

      this.ffmpeg.on('exit', (code, signal) => {
          this.debug(`ffmpeg exit: code ${code} signal ${signal}`);
      });

      this.atvremote.on('exit', (code, signal) => {
          this.debug(`atvremote exit: code ${code} signal ${signal}`);
      });

      this.atvremote.stderr.on('data', (data) => {
          this.debug(`atvremote error: ${data}`);
          heartbeat('atvremote', heartbeatFailed);
      });

      this.heartbeat = setInterval(() => {
          heartbeat('heartbeat', heartbeatFailed);
      }, this.heartbeatTimeout);

      this.debug(
          `spawn ffmpeg: ${this.ffmpeg.pid}  atvremote: ${this.atvremote.pid}`,
      );
  }

  private endStreaming() {
      try {
          if (!this.ffmpeg || !this.atvremote) {
              this.debug(
                  `End streaming: ffmpeg: ${this.ffmpeg}  atvremote: ${this.atvremote}`,
              );
              return;
          }
          this.debug(
              `Killing process: ffmpeg: ${this.ffmpeg.pid}  atvremote: ${this.atvremote.pid}`,
          );
          this.ffmpeg.stdout.unpipe();
          clearInterval(this.heartbeat);

          this.ffmpeg.kill();
          this.ffmpeg = null;
          this.atvremote.kill();
          this.atvremote = null;
      } catch (err) {
          this.debug(`Error while trying to stop: ${err}`);
      }
  }

  public stop() {
      if (!this.isPlaying()) {
          this.debug('Trying to stop stopped process!');
          return;
      }

      this.endStreaming();
      this.logger.info('Streaming finished');
  }

  public isPlaying(): boolean {
      return !!this.ffmpeg && !!this.atvremote;
  }

  private debug(message: string, ...parameters:any[]) {
      if(this.verboseMode) {
          this.logger.info(message, parameters);
      } else {
          this.logger.debug(message, parameters);
      }
  }

}
