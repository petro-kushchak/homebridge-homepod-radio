import * as os from 'os';
import * as path from 'path';

import { AccessoryPlugin, Service, CharacteristicEventTypes, PlatformAccessory } from 'homebridge';
import { CharacteristicGetCallback, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';
import { AirPlayDevice } from './lib/airplayDevice';
import { PlaybackController, PlaybackStreamer } from './lib/playbackController';
import { HomepodRadioPlatform } from './platform';
import { FileSwitch } from './platformConfig';
import { PLUGIN_MANUFACTURER, PLUGIN_MODEL } from './platformConstants';

export class HomepodFileSwitch implements AccessoryPlugin, PlaybackStreamer {
      private readonly device: AirPlayDevice;
      private readonly service: Service;
      private readonly informationService: Service;

      constructor(
            private readonly platform: HomepodRadioPlatform,
            private readonly fileConfig: FileSwitch,
            private readonly playbackController: PlaybackController,
            private readonly accessory: PlatformAccessory,
      ) {
          this.device = new AirPlayDevice(
              this.platform.platformConfig.homepodId,
              platform.logger,
              platform.platformConfig.verboseMode,
              this.streamerName(),
              '',
              fileConfig.artworkUrl,
          );

          this.service =
                  this.accessory.getService(this.platform.Service.Switch) ||
                  this.accessory.addService(this.platform.Service.Switch);

          this.service
              .getCharacteristic(this.platform.Characteristic.On)
              .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
                  this.platform.logger.info(`[${this.streamerName()} Switch] GET ON`);
                  callback(undefined, this.isPlaying());
              })
              .on(
                  CharacteristicEventTypes.SET,
                  (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                      this.platform.logger.info(`[${this.streamerName()} Switch] SET ON: ${value}`);
                      if (value) {
                          this.startPlaying();
                      } else {
                          this.stopPlaying();
                      }
                      callback();
                  },
              );

          this.informationService =
                  this.accessory.getService(this.platform.Service.AccessoryInformation) ||
                  this.accessory.addService(this.platform.Service.AccessoryInformation);

          this.informationService
              .setCharacteristic(this.platform.Characteristic.Manufacturer, PLUGIN_MANUFACTURER)
              .setCharacteristic(this.platform.Characteristic.Model, PLUGIN_MODEL)
              .setCharacteristic(
                  this.platform.Characteristic.SerialNumber,
                  this.platform.platformConfig.serialNumber,
              );

          // This will do its best to keep the actual outputs status up to date with Homekit.
          setInterval(async () => {
              this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.isPlaying());
          }, 3000);

          this.playbackController.addStreamer(this);

          this.platform.logger.info(`[${this.streamerName()} Switch] finished initializing!`);
      }

      async stopRequested(source: PlaybackStreamer): Promise<void> {
          this.platform.logger.info(
              `[${this.streamerName()}] Stopping playback - received stop request from ${source.streamerName()} `,
          );
          await this.device.stop();
      }

      async shutdownRequested(): Promise<void> {
          return await Promise.resolve();
      }

      async platformLaunched(): Promise<void> {
          return await Promise.resolve();
      }

      streamerName(): string {
          return this.fileConfig.name;
      }

      isPlaying(): boolean {
          return this.device.isPlaying();
      }

      async startPlaying(): Promise<void> {
          await this.playbackController.requestStop(this);
          const mediaPath = this.platform.platformConfig.mediaPath || os.homedir();
          const filePath = path.join(mediaPath, this.fileConfig.fileName);
          await this.device.playFile2(filePath, this.fileConfig.volume);
      }

      async stopPlaying(): Promise<void> {
          await this.device.stop();
      }

      /*
       * This method is called directly after creation of this instance.
       * It should return all services which should be added to the accessory.
       */
      getServices(): Service[] {
          return [this.informationService, this.service];
      }
}
