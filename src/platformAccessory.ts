/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    Service,
    PlatformAccessory,
    CharacteristicValue,
    CharacteristicGetCallback,
    CharacteristicEventTypes,
} from 'homebridge';
import { callbackify } from './lib/homebridge-callbacks';
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

    // this.service.addOptionalCharacteristic(
    //     this.platform.Characteristic.CurrentTrack,
    // );
    // this.service
    //     .getCharacteristic(this.platform.Characteristic.CurrentTrack)
    //     .on(CharacteristicEventTypes.GET, this.getCurrentTrack.bind(this))
    //     .updateValue(this.platform.trackName);

    // this.service.addOptionalCharacteristic(
    //     this.platform.Characteristic.ChangeTrack,
    // );
    // this.service
    //     .getCharacteristic(this.platform.Characteristic.ChangeTrack)
    //     .on(CharacteristicEventTypes.SET, this.setChangeTrack.bind(this))
    //     .updateValue(0);

    if (
        this.service.getCharacteristic(this.platform.Characteristic.Volume) ===
      undefined
    ) {
        this.service.addCharacteristic(new this.platform.Characteristic.Volume());
    }
    this.service
        .getCharacteristic(this.platform.Characteristic.Volume)
        .on(CharacteristicEventTypes.GET, callbackify(this.getVolume.bind(this)))
        .on(CharacteristicEventTypes.SET, callbackify(this.setVolume.bind(this)));

    // This will do its best to keep the actual outputs status up to date with Homekit.
    setInterval(() => {
        this.currentMediaState = this.getMediaState();
        this.service
            .getCharacteristic(this.platform.Characteristic.CurrentMediaState)
            .updateValue(this.currentMediaState);
    }, 3000);
  }

  public async getVolume(): Promise<number> {
      this.platform.logger.info('Triggered GET getVolume');
      const volume = await this.device.getVolume();
      this.platform.logger.info(`Current volume ${volume}`);
      return volume;
  }

  public async setVolume(
      volume: number,
      updateCharacteristic?: boolean,
  ): Promise<boolean> {
      const volumeCharacteristic = this.service.getCharacteristic(
          this.platform.Characteristic.Volume,
      );

      this.platform.logger.info('Triggered SET setVolume');
      const maxValue = volumeCharacteristic.props.maxValue * 0.75;
      volume = volume > maxValue ? maxValue : volume;
      this.platform.logger.info(`Volume change to ${volume}`);

      if (updateCharacteristic === true) {
          volumeCharacteristic.updateValue(volume);
      }
      return await this.device.setVolume(volume);
  }

  //   setChangeTrack(
  //       value: CharacteristicValue,
  //       callback: CharacteristicSetCallback,
  //   ): void {
  //       this.platform.logger.info('Triggered SET setChangeTrack:', value);
  //       this.service.updateCharacteristic(
  //           this.platform.Characteristic.CurrentTrack,
  //           this.platform.trackName,
  //       );
  //       callback(null);
  //   }

  //   getCurrentTrack(callback: CharacteristicGetCallback) {
  //       this.platform.logger.info('Triggered GET CurrentTrack');
  //       callback(undefined, this.platform.trackName);
  //   }

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
