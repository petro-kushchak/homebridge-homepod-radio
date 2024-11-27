/* eslint-disable @typescript-eslint/no-explicit-any */
import * as path from 'path';
import * as os from 'os';

import { https } from 'follow-redirects';

import { Service, PlatformAccessory, CharacteristicValue, CharacteristicEventTypes } from 'homebridge';

import { callbackify } from './lib/homebridgeCallbacks';
import { AirPlayDevice } from './lib/airplayDevice';
import { PlaybackController, PlaybackStreamer } from './lib/playbackController';
import { Storage } from './lib/storage';

import { HomepodRadioPlatform } from './platform';
import { RadioConfig } from './platformConfig';
import { PLUGIN_MANUFACTURER, PLUGIN_NAME } from './platformConstants';

interface AccessoryState extends Record<string, number> {
      playbackState: number;
}

/**
 * Homepod Radio Platform Accessory.
 */
export class HomepodRadioPlatformAccessory implements PlaybackStreamer {
      private readonly device: AirPlayDevice;
      private readonly storage: Storage;
      private service: Service;

      private currentMediaState: CharacteristicValue;
      private targetMediaState: CharacteristicValue;

      constructor(
            private readonly platform: HomepodRadioPlatform,
            private readonly radio: RadioConfig,
            private readonly accessory: PlatformAccessory,
            private readonly playbackController: PlaybackController,
      ) {
          this.device = new AirPlayDevice(
              this.platform.platformConfig.homepodId,
              platform.logger,
              platform.platformConfig.verboseMode,
              this.streamerName(),
              radio.metadataUrl,
              radio.artworkUrl,
          );
          const accessoryFileName = `${PLUGIN_NAME}-${this.accessory.UUID}.status.json`;
          const accessoryPath = path.join(os.homedir(), '.homebridge', accessoryFileName);
          this.platform.logger.info(`[${this.streamerName()}] Storage path: ${accessoryPath}`);
          this.storage = new Storage(accessoryPath);
          this.currentMediaState = this.getMediaState();
          this.playbackController.addStreamer(this);

            this.accessory
                .getService(this.platform.Service.AccessoryInformation)!
                .setCharacteristic(this.platform.Characteristic.Manufacturer, PLUGIN_MANUFACTURER)
                .setCharacteristic(this.platform.Characteristic.Model, this.radio.model)
                .setCharacteristic(
                    this.platform.Characteristic.SerialNumber,
                    this.platform.platformConfig.serialNumber,
                )
                .setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName);

            this.service =
                  this.accessory.getService(this.platform.Service.SmartSpeaker) ||
                  this.accessory.addService(this.platform.Service.SmartSpeaker);

            // Allows name to show when adding speaker.
            // This has the added benefit of keeping the speaker name in sync with Roon and your config.
            this.service.setCharacteristic(this.platform.Characteristic.ConfiguredName, this.accessory.displayName);

            // Event handlers for CurrentMediaState and TargetMediaState Characteristics.
            this.service
                .getCharacteristic(this.platform.Characteristic.CurrentMediaState)
                .on(CharacteristicEventTypes.GET, callbackify(this.getCurrentMediaState.bind(this)));
            this.service
                .getCharacteristic(this.platform.Characteristic.TargetMediaState)
                .on(CharacteristicEventTypes.SET, callbackify(this.setTargetMediaState.bind(this)));

            this.service
                .getCharacteristic(this.platform.Characteristic.TargetMediaState)
                .on(CharacteristicEventTypes.SET, callbackify(this.setSpeakerOn.bind(this)));

            // This will do its best to keep the actual outputs status up to date with Homekit.
            setInterval(async () => {
                this.currentMediaState = this.getMediaState();
                this.service
                    .getCharacteristic(this.platform.Characteristic.CurrentMediaState)
                    .updateValue(this.currentMediaState);
            }, 3000);
      }

      async platformLaunched(): Promise<void> {
          if (!this.radio.autoResume) {
              this.platform.logger.info(`[${this.streamerName()}] Skipped reading state`);
              return;
          }
          const state = (await this.storage.read()) as AccessoryState;
          this.platform.logger.info(`[${this.streamerName()}] state: ${JSON.stringify(state)}`);
          if (state) {
              await this.setTargetMediaState(state.playbackState);
          }
      }

      async shutdownRequested(): Promise<void> {
          await this.storeState();
      }

      private async storeState() {
          if (!this.radio.autoResume) {
              this.platform.logger.info(`[${this.streamerName()}] Skipped storing state`);
              return;
          }
          const state = {
              playbackState: this.currentMediaState,
          };
          await this.storage.write(state);
          this.platform.logger.info(`[${this.streamerName()}] stored state: ${JSON.stringify(state)}`);
      }

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async volumeUpdated(homepodId: string, volume: number): Promise<void> {
          return await Promise.resolve();
      }

      async stopRequested(source: PlaybackStreamer): Promise<void> {
          this.platform.logger.info(
              `[${this.streamerName()}] Stopping playback - received stop request from ${source.streamerName()} `,
          );
          await this.device.stop();
          await this.storeState();
      }

      streamerName(): string {
          return this.radio.name;
      }

      isPlaying(): boolean {
          return this.device.isPlaying();
      }

      async startPlaying(): Promise<void> {
          await this.playbackController.requestStop(this);
          //validate request if needed
          if (this.radio.validateRadioUrl) {
              this.platform.logger.info(`[${this.streamerName()}] Starting validating radio url`);
              const request = https
                  .request(this.radio.radioUrl, async (response) => {
                      await this.device.playStream(
                          {
                              streamUrl: response.responseUrl,
                              streamName: this.radio.trackName,
                              volume: this.radio.volume,
                              telegramUpdateToken: this.platform.platformConfig.telegramUpdateToken,
                              telegramUpdateChatId: this.platform.platformConfig.telegramUpdateChatId,
                          },
                      );
                  })
                  .on('error', (err) => {
                      this.platform.logger.info(`[${this.streamerName()}] Failed to start playing: ${err}`);
                  });
              request.end();
          } else {
              await this.device.playStream(
                  {
                      streamUrl: this.radio.radioUrl,
                      streamName: this.radio.trackName,
                      volume: this.radio.volume,
                      telegramUpdateToken: this.platform.platformConfig.telegramUpdateToken,
                      telegramUpdateChatId: this.platform.platformConfig.telegramUpdateChatId,
                  },
              );
          }
      }

      async stopPlaying(): Promise<void> {
          await this.device.stop();
      }

      getMediaState(): CharacteristicValue {
          if (this.device.isPlaying()) {
              return this.platform.Characteristic.CurrentMediaState.PLAY;
          } else {
              return this.platform.Characteristic.CurrentMediaState.STOP;
          }
      }

      /**
       * Set the setSpeakerOn.
       */
      async setSpeakerOn(value: CharacteristicValue): Promise<void> {
          this.platform.logger.info(`[${this.streamerName()}] Triggered SET Speaker ON: ${value}`);
          if (!value) {
              await this.device.stop();
          } else {
              await this.startPlaying();
          }
      }

      /**
       * Get the currentMediaState.
       */
      async getCurrentMediaState(): Promise<CharacteristicValue> {
          this.currentMediaState = this.getMediaState();
          this.platform.logger.info(
              `[${this.streamerName()}] Triggered GET CurrentMediaState:`,
              this.currentMediaState,
          );
          return Promise.resolve(this.currentMediaState);
      }

      /**
       * Set the targetMediaState.
       */
      async setTargetMediaState(value: CharacteristicValue): Promise<void> {
          this.targetMediaState = value;
          this.platform.logger.info(`[${this.streamerName()}] Triggered SET TargetMediaState: ${value}`);
          if (
              value === this.platform.Characteristic.CurrentMediaState.PAUSE ||
                  value === this.platform.Characteristic.CurrentMediaState.STOP
          ) {
              await this.stopPlaying();
          } else {
              await this.startPlaying();
          }
      }
}
