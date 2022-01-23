/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as child from 'child_process';
import { Logger } from 'homebridge';

import { promisify } from 'util';
import { delay } from './promices';

const execAsync = promisify(child.exec);

/**
 * AirPlay device
 */

export class AirPlayDevice {
  private readonly MAX_STREAMING_RETRIES = 5;
  private readonly STREAMING_RESTART_TIMEOUT = 500;
  private readonly HEARTBEAT_TIMEOUT = 5000;
  private readonly LAST_SEEN_THRESHOLD_MS = 3000;
  private readonly DEFAULT_PLAYBACK_STREAM_NAME: string =
    'Streaming with pyatv';

  private ffmpeg: child.ChildProcess = null;
  private atvremote: child.ChildProcess = null;
  private lastSeen: number;
  private heartbeat: NodeJS.Timeout;
  private streamingRetries = 0;

  private readonly debug: (message: string, ...parameters: any[]) => void;

  constructor(
    private readonly homepodId: string,
    private readonly logger: Logger,
    private readonly verboseMode: boolean,
    private readonly streamerName: string,
  ) {
      this.debug = this.verboseMode
          ? this.logger.info.bind(this.logger)
          : this.logger.debug.bind(this.logger);
  }

  public async setVolume(volume: number): Promise<boolean> {
      const setVolumeCmd = `atvremote --id ${this.homepodId} set_volume=${volume}`;
      this.debug(`[${this.streamerName}] Executing "${setVolumeCmd}"`);
      await execAsync(setVolumeCmd);
      return true;
  }

  public async getVolume(): Promise<number> {
      const getVolumeCmd = `atvremote --id ${this.homepodId} volume`;
      this.debug(`[${this.streamerName}] Executing "${getVolumeCmd}"`);
      const result = await execAsync(getVolumeCmd);
      try {
          return Number.parseFloat(result.stdout);
      } catch (error) {
          this.logger.info(`[${this.streamerName}] GetVolume error: ${error}`);
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
      this.streamingRetries = 0;
      const heartbeat = this.handleHearbeat.bind(this);
      const heartbeatFailed = async (): Promise<void> => {
      //identify reason and restart streaming...
          const title = await this.getPlaybackTitle();
          this.debug(`[${this.streamerName}] Received from device: ${this.homepodId} title: ${title}`);
          let restartStreaming = false;
          if (title === '' || title.startsWith(this.DEFAULT_PLAYBACK_STREAM_NAME)) {
              this.logger.info(`[${this.streamerName}] Restarting playback... total attempts: ${this.streamingRetries}`);
              if (this.streamingRetries < this.MAX_STREAMING_RETRIES) {
                  this.streamingRetries = this.streamingRetries + 1;
                  restartStreaming = true;
              } else {
                  this.logger.info(`[${this.streamerName}] Restarting playback - too many attempts`);
              }
          } else {
              this.logger.info(`[${this.streamerName}] Device is playing "${title}" - will cancel streaming`);
          }

          if (restartStreaming) {
              //need to restart streaming, after some delay
              await delay(this.STREAMING_RESTART_TIMEOUT * this.streamingRetries, 0);
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
              this.logger.info(`[${this.streamerName}] Streaming finished - restart canceled`);
          }
      };

      if (this.isPlaying()) {
          await this.endStreaming();
          this.logger.info(`[${this.streamerName}] Previous streaming finished`);
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
      this.debug(`[${this.streamerName}] Playback heartbeat, source: ${heatbeatType}`);
      if (!this.isPlaying()) {
          this.logger.info(`[${this.streamerName}] Playback heartbeat ignored (${heatbeatType}) - streaming stopped`);
          clearInterval(this.heartbeat);
          return;
      }
      if (heatbeatType !== 'heartbeat') {
          this.lastSeen = Date.now();
          this.streamingRetries = 0;
      } else {
          const diffMs = Date.now() - this.lastSeen;
          this.debug(`[${this.streamerName}] Playback heartbeat, diff: ${diffMs}ms`);
          if (diffMs > this.LAST_SEEN_THRESHOLD_MS) {
              this.debug(`[${this.streamerName}] Playback heartbeat failed`);
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
          ['-rtbufsize', ' 15M', '-i', streamUrl, '-metadata', `title="${streamName}"`, '-f', 'mp3', '-'],
      );
      this.atvremote = child.spawn(
          'atvremote',
          ['--id', this.homepodId, 'stream_file=-'],
      );

      this.ffmpeg.stdout.pipe(this.atvremote.stdin).on('error', (error) => {
          this.logger.info(`[${this.streamerName}] ffmpeg pipe error: ${error}`);
      });

      this.ffmpeg.stderr.on('data', (data) => {
          this.debug(`[${this.streamerName}] ffmpeg data: ${data}`);
          heartbeat('ffmpeg', heartbeatFailed);
      });

      this.ffmpeg.on('exit', (code, signal) => {
          this.debug(`ffmpeg exit: code ${code} signal ${signal}`);
      });

      this.atvremote.on('exit', (code, signal) => {
          this.debug(`[${this.streamerName}] atvremote exit: code ${code} signal ${signal}`);
      });

      this.atvremote.stderr.on('data', (data) => {
          this.debug(`[${this.streamerName}] atvremote data: ${data}`);
          heartbeat('atvremote', heartbeatFailed);
      });

      this.heartbeat = setInterval(() => {
          heartbeat('heartbeat', heartbeatFailed);
      }, this.HEARTBEAT_TIMEOUT);

      this.debug(
          `[${this.streamerName}] spawn ffmpeg: ${this.ffmpeg.pid}  atvremote: ${this.atvremote.pid}`,
      );
      this.logger.info(`[${this.streamerName}] Started streaming ${streamUrl}`);
      if (volume > 0) {
          this.logger.info(`[${this.streamerName}] Setting volume to ${volume}`);
          return await this.setVolume(volume);
      }
      return true;
  }

  private async endStreaming(): Promise<boolean> {
      try {
          if (!this.ffmpeg || !this.atvremote) {
              this.debug(
                  `[${this.streamerName}] End streaming: ffmpeg: ${this.ffmpeg}  atvremote: ${this.atvremote}`,
              );
              return;
          }
          this.debug(
              `[${this.streamerName}] Killing process: ffmpeg: ${this.ffmpeg.pid}  atvremote: ${this.atvremote.pid}`,
          );
          this.ffmpeg.stdout.unpipe();
          clearInterval(this.heartbeat);

          process.kill(this.ffmpeg.pid);
          //this.ffmpeg.kill();
          this.ffmpeg = null;

          process.kill(this.atvremote.pid);
          //   this.atvremote.kill();
          this.atvremote = null;
      } catch (err) {
          this.debug(`[${this.streamerName}] Error while trying to stop: ${err}`);
      }
      return Promise.resolve(true);
  }

  public async stop(): Promise<boolean> {
      if (!this.isPlaying()) {
          this.debug(`[${this.streamerName}] Trying to stop stopped process!`);
          return true;
      }

      await this.endStreaming();
      this.logger.info(`[${this.streamerName}] Streaming finished - stop requested`);
      return true;
  }

  public isPlaying(): boolean {
      return !!this.ffmpeg && !!this.atvremote;
  }
}
