/* eslint-disable @typescript-eslint/no-unused-vars */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import { Logger } from 'homebridge';
import { AirPlayDevice } from './lib/airplayDevice';
import { AutomationReturn } from './lib/httpService';
import { PlaybackController, PlaybackStreamer } from './lib/playbackController';
import { HomepodRadioPlatformConfig } from './platformConfig';

const fileExists = async (path) =>
    !!(await fs.promises.stat(path).catch((e) => false));

export enum WebActionType {
  PlayFile,
  PlayUrl,
  Unsupported,
}

export interface WebAction {
  data: string;
  action: WebActionType;
}

export class HomepodRadioPlatformWebActions implements PlaybackStreamer {
  private readonly device: AirPlayDevice;
  constructor(
    private readonly config: HomepodRadioPlatformConfig,
    private readonly playbackController: PlaybackController,
    private readonly logger: Logger,
  ) {
      this.playbackController.addStreamer(this);
      this.device = new AirPlayDevice(
          this.config.homepodId,
          this.logger,
          this.config.verboseMode,
          this.streamerName(),
      );
  }

  async stopRequested(source: PlaybackStreamer): Promise<void> {
      return Promise.resolve();
  }

  async shutdownRequested(): Promise<void> {
      return Promise.resolve();
  }

  async platformLaunched(): Promise<void> {
      return Promise.resolve();
  }

  streamerName(): string {
      return 'PlatformWebActions';
  }

  public parseAction(actionUri: string): WebAction {
      const parts = actionUri.split('/');

      if (parts.length < 2) {
          return {
              action: WebActionType.Unsupported,
              data: 'Unsupported request',
          };
      }

      if (parts[1] === 'play') {
      // play mp3/wav from mediaPath by name
      // uri example: /play/<mp3/wav-file>
          const fileName = parts[2];

          const mediaPath = this.config.mediaPath || os.homedir();
          const filePath = path.join(mediaPath, fileName);

          return {
              action: WebActionType.PlayFile,
              data: filePath,
          };
      } else if (parts[1] === 'playUrl') {
      // play url
      // uri example: /playUrl/<base64url>
          return {
              action: WebActionType.PlayUrl,
              data: Buffer.from(parts[2], 'base64').toString('binary'),
          };
      }
      return {
          action: WebActionType.Unsupported,
          data: 'Unsupported request',
      };
  }

  public async handleAction(actionUrl: string): Promise<AutomationReturn> {
      this.logger.info('Received request: %s', actionUrl);
      const webAction = this.parseAction(actionUrl);

      switch (webAction.action) {
          case WebActionType.PlayFile: {
              const filePath = webAction.data;
              const correctFile = await fileExists(filePath);

              if (!correctFile) {
                  return {
                      error: false,
                      message: `File does not exist: ${filePath}`,
                  };
              }

              const message = `Started playing file: ${filePath}`;
              this.logger.info(message);
              await this.playbackController.requestStop(this);
              await this.device.playFile(filePath);
              return {
                  error: false,
                  message: message,
              };
          }

          case WebActionType.PlayUrl: {
              const url = webAction.data;
              const message = `Started playing url: ${url}`;
              await this.playbackController.requestStop(this);
              await this.device.playUrl(url);
              return {
                  error: false,
                  message: message,
              };
          }
          case WebActionType.Unsupported:
          default:
              return {
                  error: true,
                  message: webAction.data,
              };
      }
  }
}
