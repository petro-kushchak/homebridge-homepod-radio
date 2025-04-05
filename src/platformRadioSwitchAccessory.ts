import { AccessoryPlugin, Service, CharacteristicEventTypes, PlatformAccessory } from 'homebridge';
import { CharacteristicGetCallback, CharacteristicValue, CharacteristicSetCallback } from 'homebridge';

import { HomepodRadioPlatform } from './platform.js';
import { PLUGIN_MANUFACTURER, PLUGIN_MODEL } from './platformConstants.js';

import { PlaybackStreamer } from './lib/playbackController.js';

export class HomepodRadioSwitchAccessory implements AccessoryPlugin {
    private readonly service: Service;
    private readonly informationService: Service;

    constructor(
        private readonly platform: HomepodRadioPlatform,
        private readonly streamer: PlaybackStreamer,
        private readonly accessory: PlatformAccessory,
    ) {
        this.service =
            this.accessory.getService(this.platform.Service.Switch) ||
            this.accessory.addService(this.platform.Service.Switch);

        this.service
            .getCharacteristic(this.platform.Characteristic.On)
            .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
                this.platform.logger.info(`[${this.streamer.streamerName()} Switch] GET ON`);
                callback(undefined, this.streamer.isPlaying());
            })
            .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
                this.platform.logger.info(`[${this.streamer.streamerName()} Switch] SET ON: ${value}`);
                if (value) {
                    this.streamer.startPlaying();
                } else {
                    this.streamer.stopPlaying();
                }
                callback();
            });

        this.informationService =
            this.accessory.getService(this.platform.Service.AccessoryInformation) ||
            this.accessory.addService(this.platform.Service.AccessoryInformation);

        this.informationService
            .setCharacteristic(this.platform.Characteristic.Manufacturer, PLUGIN_MANUFACTURER)
            .setCharacteristic(this.platform.Characteristic.Model, PLUGIN_MODEL)
            .setCharacteristic(this.platform.Characteristic.SerialNumber, this.platform.platformConfig.serialNumber);

        // This will do its best to keep the actual outputs status up to date with Homekit.
        setInterval(async () => {
            this.service
                .getCharacteristic(this.platform.Characteristic.On)
                .updateValue(this.streamer.isPlaying());
        }, 3000);

        this.platform.logger.info(`[${this.streamer.streamerName()} Switch] finished initializing!`);
    }

    /*
     * This method is called directly after creation of this instance.
     * It should return all services which should be added to the accessory.
     */
    getServices(): Service[] {
        return [this.informationService, this.service];
    }
}
