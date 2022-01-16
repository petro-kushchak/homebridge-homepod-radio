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
  private readonly defaultPlaybackStreamName: string = 'Streaming with pyatv';

  private ffmpeg: child.ChildProcess = null;
  private atvremote: child.ChildProcess = null;
  private lastSeen: number;
  private heartbeat: NodeJS.Timeout;

  private readonly debug: (message: string, ...parameters: any[]) => void;

  constructor(
    private readonly homepodId: string,
    private readonly logger: Logger,
    private readonly verboseMode: boolean,
  ) {
      this.debug = this.verboseMode
          ? this.logger.info.bind(this.logger)
          : this.logger.debug.bind(this.logger);
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

  public async getPlaybackTitle(): Promise<string> {
      const currentTitleCmd = `atvremote --id ${this.homepodId} title`;
      const result = await execAsync(currentTitleCmd);
      return result.stdout;
  }

  public async play(
      streamUrl: string,
      streamName: string,
      volume: number,
  ): Promise<boolean> {
      const heartbeat = this.handleHearbeat.bind(this);
      const heartbeatFailed = async (): Promise<void> => {
          //identify reason and restart streaming...
          const title = await this.getPlaybackTitle();
          this.debug(`Received from device: ${this.homepodId} title: ${title}`);
          if (title === '' || title.startsWith(this.defaultPlaybackStreamName)) {
              this.logger.info('Restarting playback...');
              //need to restart streaming
              await this.startStreaming(
                  streamUrl,
                  streamName,
                  volume,
                  heartbeat,
                  heartbeatFailed,
              );
          } else {
              //device is used to play something else, need to change state to "STOPPED"
              await this.endStreaming();
              this.logger.info('Streaming finished');
          }
      };

      if (this.isPlaying()) {
          await this.endStreaming();
          this.logger.info('Streaming finished');
          return await this.startStreaming(
              streamUrl,
              streamName,
              volume,
              heartbeat,
              heartbeatFailed,
          );
      } else {
          return await this.startStreaming(
              streamUrl,
              streamName,
              volume,
              heartbeat,
              heartbeatFailed,
          );
      }
  }

  /**
   * Streaming crash monitoring/prevention
   */
  private async handleHearbeat(
      heatbeatType: string,
      heartbeatFailed: () => Promise<void>,
  ): Promise<void> {
      this.debug(`Playback heartbeat, source: ${heatbeatType}`);
      if (!this.isPlaying()) {
          this.logger.info('Playback heartbeat ignored - streaming stopped');
          clearInterval(this.heartbeat);
          return;
      }
      if (heatbeatType !== 'heartbeat') {
          this.lastSeen = Date.now();
      } else {
          const diffMs = Date.now() - this.lastSeen;
          this.debug(`Playback heartbeat, diff: ${diffMs}ms`);
          if (diffMs > this.lastSeenThresholdMs) {
              this.debug('Playback heartbeat failed');
              await heartbeatFailed();
          }
      }
  }

  private async startStreaming(
      streamUrl: string,
      streamName: string,
      volume: number,
      heartbeat: (
      source: string,
      heartbeatFailed: () => Promise<void>
    ) => Promise<void>,
      heartbeatFailed: () => Promise<void>,
  ): Promise<boolean> {
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
          this.debug(`ffmpeg data: ${data}`);
          heartbeat('ffmpeg', heartbeatFailed);
      });

      this.ffmpeg.on('exit', (code, signal) => {
          this.debug(`ffmpeg exit: code ${code} signal ${signal}`);
      });

      this.atvremote.on('exit', (code, signal) => {
          this.debug(`atvremote exit: code ${code} signal ${signal}`);
      });

      this.atvremote.stderr.on('data', (data) => {
          this.debug(`atvremote data: ${data}`);
          heartbeat('atvremote', heartbeatFailed);
      });

      this.heartbeat = setInterval(() => {
          heartbeat('heartbeat', heartbeatFailed);
      }, this.heartbeatTimeout);

      this.debug(
          `spawn ffmpeg: ${this.ffmpeg.pid}  atvremote: ${this.atvremote.pid}`,
      );
      this.logger.info(`Started streaming ${streamUrl}`);
      if (volume > 0) {
          this.logger.info(`Setting volume to ${volume}`);
          return await this.setVolume(volume);
      }
      return true;
  }

  private async endStreaming(): Promise<boolean> {
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
      return Promise.resolve(true);
  }

  public async stop(): Promise<boolean> {
      if (!this.isPlaying()) {
          this.debug('Trying to stop stopped process!');
          return true;
      }

      await this.endStreaming();
      this.logger.info('Streaming finished');
      return true;
  }

  public isPlaying(): boolean {
      return !!this.ffmpeg && !!this.atvremote;
  }
}
