/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as child from 'child_process';
import { Logger } from 'homebridge';

/**
 * AirPlay device
 */

export class AirPlayDevice {
  private readonly lastSeenThresholdMs = 2000;
  private readonly heartbeatTimeout = 3000;
  private readonly defaultPlayingStreamName: string = 'Streaming with pyatv';

  private ffmpeg: child.ChildProcess = null;
  private atvremote: child.ChildProcess = null;
  private lastSeen: Record<string, number> = {};
  private heartbeat: NodeJS.Timeout;

  constructor(
    private readonly homepodId: string,
    private readonly logger: Logger,
  ) {}

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
              this.logger.info(
                  `Received from device: ${this.homepodId} title: ${title}`,
              );
              if (title === '') {
                  //need to restart streaming
                  this.startStreaming(
                      streamUrl,
                      streamName,
                      heartbeat,
                      heartbeatFailed,
                  );
              } else if (title === this.defaultPlayingStreamName) {
                  //not clear what happened
                  this.logger.info('Looks like still playing but no hearbeat...');
              } else {
                  //device is used to play something else, need to change state to "STOPPED"
                  this.endStreaming(() => {
                      this.logger.info('Streaming finished');
                  });
              }
          });
      };

      if (this.isPlaying()) {
          this.endStreaming(() => {
              this.logger.info('Streaming finished');
              this.startStreaming(streamUrl, streamName, heartbeat, heartbeatFailed);
          });
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
      this.logger.info(`Playing heartbeat, source: ${heatbeatType}`);
      if (!this.lastSeen[heatbeatType]) {
          this.lastSeen[heatbeatType] = Date.now();
          return;
      }
      const lastSeenByType = Object.values(this.lastSeen);
      const nearest = Math.max(...lastSeenByType);
      const diff = Date.now() - nearest;
      this.logger.info(
          `Playing heartbeat, source: ${heatbeatType} nearest: ${nearest} diff: ${diff}`,
      );
      if (diff > this.lastSeenThresholdMs) {
          this.logger.info(
              `Heartbeat, failed source: ${heatbeatType}, lastSeen: ${nearest} diff: ${diff}`,
          );
          heartbeatFailed();
      } else {
          this.lastSeen[heatbeatType] = Date.now();
          this.logger.info(`Playing heartbeat, source: ${heatbeatType} updated`);
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
          this.logger.info(`ffmpeg pipe error: ${error}`);
      });

      this.ffmpeg.stderr.on('data', (data) => {
          this.logger.info(`ffmpeg error: ${data}`);
          heartbeat('ffmpeg', heartbeatFailed);
      });

      this.ffmpeg.on('exit', (code, signal) => {
          this.logger.info(`ffmpeg exit: code ${code} signal ${signal}`);
      });

      this.atvremote.on('exit', (code, signal) => {
          this.logger.info(`atvremote exit: code ${code} signal ${signal}`);
      });

      this.atvremote.stderr.on('data', (data) => {
          this.logger.info(`atvremote error: ${data}`);
          heartbeat('atvremote', heartbeatFailed);
      });

      this.heartbeat = setInterval(() => {
          heartbeat('heartbeat', heartbeatFailed);
      }, this.heartbeatTimeout);

      this.logger.info(
          `spawn ffmpeg: ${this.ffmpeg.pid}  atvremote: ${this.atvremote.pid}`,
      );
  }

  private endStreaming(streamingFinished: () => void) {
      try {
          this.logger.info(
              `Killing process: ffmpeg: ${this.ffmpeg.pid}  atvremote: ${this.atvremote.pid}`,
          );
          this.ffmpeg.stdout.unpipe();
          clearInterval(this.heartbeat);

          setTimeout(() => {
              this.ffmpeg.kill();
              this.ffmpeg = null;
              setTimeout(() => {
                  this.atvremote.kill();
                  this.atvremote = null;
                  streamingFinished();
              }, 3000);
          }, 2000);
      } catch (err) {
          this.logger.info(`Error while trying to stop: ${err}`);
      }
  }

  public stop() {
      if (!this.isPlaying()) {
          this.logger.info('Trying to stop stopped process!');
          return;
      }

      this.endStreaming(() => {
          this.logger.info('Streaming finished');
      });
  }

  public isPlaying(): boolean {
      return !!this.ffmpeg && !!this.atvremote;
  }
}
