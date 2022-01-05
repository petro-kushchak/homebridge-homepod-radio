/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicGetCallback,
  CharacteristicEventTypes,
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
    this.device = new AirPlayDevice(this.platform.homepodId, platform.logger);
    this.currentMediaState = this.getMediaState();

    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(
        this.platform.Characteristic.Manufacturer,
        'Homepod Radio',
      )
      .setCharacteristic(
        this.platform.Characteristic.Model,
        this.platform.model,
      )
      .setCharacteristic(
        this.platform.Characteristic.SerialNumber,
        this.platform.serialNumber,
      )
      .setCharacteristic(
        this.platform.Characteristic.Name,
        this.accessory.displayName,
      );

    this.service =
      this.accessory.getService(this.platform.Service.SmartSpeaker) ||
      this.accessory.addService(this.platform.Service.SmartSpeaker);

    // Allows name to show when adding speaker.
    // This has the added benefit of keeping the speaker name in sync with Roon and your config.
    this.service.setCharacteristic(
      this.platform.Characteristic.ConfiguredName,
      this.accessory.displayName,
    );

    // Event handlers for CurrentMediaState and TargetMediaState Characteristics.
    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentMediaState)
      .on(CharacteristicEventTypes.GET, this.getCurrentMediaState.bind(this));
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetMediaState)
      .on(CharacteristicEventTypes.SET, this.setTargetMediaState.bind(this));

    this.service.addCharacteristic(this.platform.Characteristic.CurrentTrack);

    this.service
      .getCharacteristic(this.platform.Characteristic.CurrentTrack)
      .updateValue(this.platform.trackName);

    // This will do its best to keep the actual outputs status up to date with Homekit.
    setInterval(() => {
      this.currentMediaState = this.getMediaState();
      this.service
        .getCharacteristic(this.platform.Characteristic.CurrentMediaState)
        .updateValue(this.currentMediaState);
    }, 3000);
  }

  getMediaState(): CharacteristicValue {
    if (this.device.isPlaying()) {
      return this.platform.Characteristic.CurrentMediaState.PLAY;
    } else {
      return this.platform.Characteristic.CurrentMediaState.STOP;
    }
  }

  /**
   * Get the currentMediaState.
   */
  getCurrentMediaState(callback: CharacteristicGetCallback) {
    this.currentMediaState = this.getMediaState();
    this.platform.logger.info(
      'Triggered GET CurrentMediaState:',
      this.currentMediaState,
    );
    callback(undefined, this.currentMediaState);
  }

  /**
   * Set the targetMediaState.
   */
  setTargetMediaState(
    value: CharacteristicValue,
    callback: CharacteristicGetCallback,
  ) {
    this.targetMediaState = value;
    this.platform.logger.info('Triggered SET TargetMediaState:', value);
    if (
      value === this.platform.Characteristic.CurrentMediaState.PAUSE ||
      value === this.platform.Characteristic.CurrentMediaState.STOP
    ) {
      this.device.stop();
    } else {
      this.device.play(this.platform.radioUrl, this.platform.trackName);
    }
    callback(null);
  }
}
