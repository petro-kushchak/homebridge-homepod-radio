import { AccessoryPlugin, Service, PlatformAccessory, CharacteristicEventTypes, CharacteristicValue } from 'homebridge';
import { AirPlayDevice } from './lib/airplayDevice';
import { callbackify } from './lib/homebridgeCallbacks';
import { HomepodRadioPlatform } from './platform';
import { PLUGIN_MANUFACTURER, PLUGIN_MODEL } from './platformConstants';

export class HomepodVolumeAccessory implements AccessoryPlugin {
      private readonly device: AirPlayDevice;
      private readonly service: Service;
      private readonly informationService: Service;

      constructor(private readonly platform: HomepodRadioPlatform, private readonly accessory: PlatformAccessory) {
          this.device = new AirPlayDevice(
              this.platform.platformConfig.homepodId,
              platform.logger,
              platform.platformConfig.verboseMode,
              this.streamerName(),
              '',
              '',
          );

          this.service =
                  this.accessory.getService(this.platform.Service.Speaker) ||
                  this.accessory.addService(this.platform.Service.Speaker);

          this.service
              .getCharacteristic(this.platform.Characteristic.Volume)
              .on(CharacteristicEventTypes.GET, callbackify(this.getCurrentVolume.bind(this)));
          this.service
              .getCharacteristic(this.platform.Characteristic.Volume)
              .on(CharacteristicEventTypes.SET, callbackify(this.setCurrentVolume.bind(this)));

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
              //   this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.isPlaying());
          }, 3000);

          this.platform.logger.info(`[${this.streamerName()}] finished initializing!`);
      }

      /**
       * Get the current volume.
       */
      async getCurrentVolume(): Promise<CharacteristicValue> {
          this.platform.logger.info(`[${this.streamerName()}] Triggered GET CurrentVolume:`);
          return Promise.resolve(50);
      }

      /**
       * Set the current volume.
       */
      async setCurrentVolume(value: CharacteristicValue): Promise<void> {
          this.platform.logger.info(`[${this.streamerName()}] Triggered SET CurrentVolume: ${value}`);
      }

      streamerName(): string {
          return `Homepod Volume ${this.platform.platformConfig.homepodId}`;
      }

      /*
       * This method is called directly after creation of this instance.
       * It should return all services which should be added to the accessory.
       */
      getServices(): Service[] {
          return [this.informationService, this.service];
      }
}
