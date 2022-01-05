import {
    Service,
    PlatformAccessory,
    CharacteristicValue,
    CharacteristicGetCallback,
    CharacteristicEventTypes,
    CharacteristicValue,
} from 'homebridge';
import { AirPlayDevice } from './lib/airplayDevice';

import { HomepodRadioPlatform } from './platform';

/**
 * Homepod Radio Platform Accessory.
 */
export class HomepodRadioPlatformAccessory {
    private readonly device: AirPlayDevice;
    private service: Service;

    private currentMediaState: CharacteristicValue;

    private targetMediaState: CharacteristicValue;

    constructor(
        private readonly platform: HomepodRadioPlatform,
        private readonly accessory: PlatformAccessory,
    ) {
        this.currentMediaState = this.getMediaState();
        this.targetMediaState = this.platform.Characteristic.CurrentMediaState.PAUSE;
        this.device = new AirPlayDevice(this.platform.homepodIP);

        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Homepod Radio')
            .setCharacteristic(this.platform.Characteristic.Model, this.platform.model)
            .setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName);

        this.service =
            this.accessory.getService(this.platform.Service.SmartSpeaker)
            || this.accessory.addService(this.platform.Service.SmartSpeaker);

        // Allows name to show when adding speaker.
        // This has the added benefit of keeping the speaker name in sync with Roon and your config.
        this.service.setCharacteristic(this.platform.Characteristic.ConfiguredName, this.accessory.displayName);

        // Event handlers for CurrentMediaState and TargetMediaState Characteristics.
        this.service.getCharacteristic(this.platform.Characteristic.CurrentMediaState)
            .on(CharacteristicEventTypes.GET, this.getCurrentMediaState.bind(this));
        this.service.getCharacteristic(this.platform.Characteristic.TargetMediaState)
            .on(CharacteristicEventTypes.SET, this.setTargetMediaState.bind(this))
            .on(CharacteristicEventTypes.GET, this.getTargetMediaState.bind(this));

        // This will do its best to keep the actual outputs status up to date with Homekit.
        setInterval(() => {
            this.currentMediaState = this.getMediaState();
            this.service.getCharacteristic(this.platform.Characteristic.CurrentMediaState).updateValue(this.currentMediaState);
        }, 3000);
    }

    getMediaState() {
        if (this.device.isPlaying()) {
            return this.platform.Characteristic.CurrentMediaState.PLAY;
        }
        else {
            return this.platform.Characteristic.CurrentMediaState.STOP;
        }
    }

    /**
     * Get the currentMediaState.
     */
    getCurrentMediaState(callback: CharacteristicGetCallback) {
        this.currentMediaState = this.getMediaState();
        this.platform.logger.debug('Triggered GET CurrentMediaState:', this.currentMediaState);
        callback(undefined, this.currentMediaState);
    }

    /**
     * Set the targetMediaState.
     * We aren't allowing Homekit to set the value for us, instead we call the RoonApiTransport.control method
     * with 'playpause' which does a great job of stopping and starting the output.
     * Combined with the setInterval in the constructor the output status should generally be good.
     */
    setTargetMediaState(value: CharacteristicValue, callback: CharacteristicGetCallback) {
        this.targetMediaState = value;
        this.platform.logger.debug('Triggered SET TargetMediaState:', value);
        if (value === this.platform.Characteristic.CurrentMediaState.PAUSE ||
            value === this.platform.Characteristic.CurrentMediaState.STOP) {
            this.device.stop();
        } else {
            this.device.play(this.platform.radioUrl);
        }
        callback(null);
    }

    /**
     * Get the targetMediaState.
     * This doesn't seem to ever be called. Ever...
     */
    getTargetMediaState(callback: CharacteristicGetCallback) {
        const state = this.targetMediaState;
        this.platform.logger.debug('Triggered GET CurrentMediaState:', state);
        callback(undefined, state);
    }

}
