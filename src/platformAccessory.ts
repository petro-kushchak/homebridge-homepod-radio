/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    Service,
    PlatformAccessory,
    CharacteristicValue,
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
      this.device = new AirPlayDevice(
          this.platform.homepodId,
          platform.logger,
          platform.verboseMode,
      );
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
        .on(
            CharacteristicEventTypes.GET,
            callbackify(this.getCurrentMediaState.bind(this)),
        );
    this.service
        .getCharacteristic(this.platform.Characteristic.TargetMediaState)
        .on(
            CharacteristicEventTypes.SET,
            callbackify(this.setTargetMediaState.bind(this)),
        );

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
  async getCurrentMediaState(): Promise<CharacteristicValue> {
      this.currentMediaState = this.getMediaState();
      this.platform.logger.info(
          'Triggered GET CurrentMediaState:',
          this.currentMediaState,
      );
      return Promise.resolve(this.currentMediaState);
  }

  /**
   * Set the targetMediaState.
   */
  async setTargetMediaState(value: CharacteristicValue): Promise<void> {
      this.targetMediaState = value;
      this.platform.logger.info('Triggered SET TargetMediaState:', value);
      if (
          value === this.platform.Characteristic.CurrentMediaState.PAUSE ||
      value === this.platform.Characteristic.CurrentMediaState.STOP
      ) {
          await this.device.stop();
      } else {
          await this.device.play(
              this.platform.radioUrl,
              this.platform.trackName,
              this.platform.volume,
          );
      }
  }
}
