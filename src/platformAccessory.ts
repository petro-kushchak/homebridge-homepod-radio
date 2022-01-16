/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    Service,
    PlatformAccessory,
    CharacteristicValue,
    CharacteristicEventTypes,
} from 'homebridge';
import { callbackify } from './lib/homebridge-callbacks';
import { AirPlayDevice } from './lib/airplayDevice';
import { timeout } from './lib/promices';

import {
    HomepodRadioPlatform,
    PlaybackController,
    PlaybackStreamer,
    Radio,
} from './platform';

/**
 * Homepod Radio Platform Accessory.
 */
export class HomepodRadioPlatformAccessory implements PlaybackStreamer {
  private readonly device: AirPlayDevice;
  private service: Service;

  private currentMediaState: CharacteristicValue;
  private targetMediaState: CharacteristicValue;

  constructor(
    private readonly platform: HomepodRadioPlatform,
    private readonly radio: Radio,
    private readonly accessory: PlatformAccessory,
    private readonly playbackController: PlaybackController,
  ) {
      this.device = new AirPlayDevice(
          this.platform.homepodId,
          platform.logger,
          platform.verboseMode,
      );
      this.currentMediaState = this.getMediaState();
      this.playbackController.addStreamer(this);

    this.accessory
        .getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(
            this.platform.Characteristic.Manufacturer,
            'Homepod Radio',
        )
        .setCharacteristic(this.platform.Characteristic.Model, this.radio.model)
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async stopRequested(source: PlaybackStreamer): Promise<void> {
      this.platform.logger.info(
          `[${this.streamerName()}] Stopping playback - received stop request from ${source.streamerName()} `,
      );
      await this.device.stop();
  }

  streamerName(): string {
      return this.radio.name;
  }

  public async getVolume(): Promise<CharacteristicValue> {
      this.platform.logger.info(
          `[${this.streamerName()}] Triggered GET getVolume`,
      );

      const volumeCharacteristic = this.service.getCharacteristic(
          this.platform.Characteristic.Volume,
      );

      const volume = await Promise.race([
          timeout(3000, volumeCharacteristic.value),
          this.device.getVolume(),
      ]);

      this.platform.logger.info(
          `[${this.streamerName()}] Current volume ${volume}`,
      );
      return volume;
  }

  public async setVolume(
      volume: number,
      updateCharacteristic?: boolean,
  ): Promise<boolean> {
      const volumeCharacteristic = this.service.getCharacteristic(
          this.platform.Characteristic.Volume,
      );

      this.platform.logger.info(
          `[${this.streamerName()}] Triggered SET setVolume`,
      );
      const maxValue = volumeCharacteristic.props.maxValue * 0.75;
      volume = volume > maxValue ? maxValue : volume;
      this.platform.logger.info(
          `[${this.streamerName()}] Volume change to ${volume}`,
      );

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
      this.platform.logger.info(
          `[${this.streamerName()}] Triggered SET TargetMediaState: ${value}`,
      );
      if (
          value === this.platform.Characteristic.CurrentMediaState.PAUSE ||
      value === this.platform.Characteristic.CurrentMediaState.STOP
      ) {
          await this.device.stop();
      } else {
          await this.playbackController.requestStop(this);
          await this.device.play(
              this.radio.radioUrl,
              this.radio.trackName,
              this.radio.volume,
          );
      }
  }
}
