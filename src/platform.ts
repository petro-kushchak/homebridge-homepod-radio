/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    IndependentPlatformPlugin,
    Logging,
    PlatformConfig,
    API,
    HAP,
    Characteristic,
    Service,
} from 'homebridge';

import { HomepodRadioPlatformAccessory } from './platformAccessory';
import { PlaybackController } from './lib/playbackController';

export const PLUGIN_NAME = 'HomepodRadioPlatform';

let hap: HAP;

export interface Radio {
  name: string;
  model: string;
  radioUrl: string;
  trackName: string;
  volume: number;
  autoResume: boolean;
}

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HomepodRadioPlatform implements IndependentPlatformPlugin {
  public readonly homepodId: string;
  public readonly serialNumber: string;
  public readonly verboseMode: boolean;
  public readonly volumeControl: boolean;
  private readonly radios: Radio[];
  private readonly playbacController: PlaybackController =
    new PlaybackController();

  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic =
    this.api.hap.Characteristic;

  constructor(
    public logger: Logging,
    private config: PlatformConfig,
    private api: API,
  ) {
      hap = api.hap;

      this.homepodId = config.homepodId;
      this.radios = [];
      this.loadRadios();

      this.serialNumber = config.serialNumber || `HPD${this.homepodId}`;
      this.verboseMode =
      !!config.verboseMode && config.verboseMode ? true : false;

      this.volumeControl =
      !!config.volumeControl && config.volumeControl ? true : false;

      this.api.on('didFinishLaunching', () => {
          this.logger.info('Finished initializing platform:', this.config.platform);
          this.radios.forEach((radio) => this.addAccessory(radio));
          this.playbacController.platformReady();
      });

      this.api.on('shutdown', () => {
          this.logger.info('Platform: shutdown...');
          this.playbacController.shutdown();
      });
  }

  private loadRadios() {
      //backward compatibility - single accessory mode
      if (!this.config.radios) {
          const radio = {
              name: this.config.name || 'HomePod Radio',
              model: this.config.model || 'Radio BBC',
              radioUrl: this.config.radioUrl,
              trackName: this.config.trackName || 'Radio BBC',
              serialNumber: this.serialNumber,
              volume:
          !!this.config.volume &&
          this.config.volume > 0 &&
          this.config.volume < 100
              ? this.config.volume
              : 0,
              autoResume: false,
          } as Radio;

          this.radios.push(radio);
      } else {
          this.config.radios.forEach((radioConfig) => {
              const radio = {
                  name: radioConfig.name,
                  model: radioConfig.model || 'HomePod Radio',
                  radioUrl: radioConfig.radioUrl,
                  trackName: radioConfig.trackName || 'HomePod Radio',
                  serialNumber: this.serialNumber,
                  volume:
            !!radioConfig.volume &&
            radioConfig.volume > 0 &&
            radioConfig.volume < 100
                ? radioConfig.volume
                : 0,
                  autoResume: radioConfig.autoResume || false,
              } as Radio;

              this.radios.push(radio);
          });
      }
      const loadedRadios = this.radios.map((r) => r.name);
      this.logger.info(`Loaded ${loadedRadios.length} radios: ${loadedRadios}`);
  }

  private addAccessory(radio: Radio) {
      const uuid = hap.uuid.generate('homebridge:homepod:radio:' + radio.name);
      const accessory = new this.api.platformAccessory(radio.name, uuid);

      // Adding 26 as the category is some special sauce that gets this to work properly.
      // @see https://github.com/homebridge/homebridge/issues/2553#issuecomment-623675893
      accessory.category = 26;

      new HomepodRadioPlatformAccessory(
          this,
          radio,
          accessory,
          this.playbacController,
      );

      // SmartSpeaker service must be added as an external accessory.
      // @see https://github.com/homebridge/homebridge/issues/2553#issuecomment-622961035
      // There a no collision issues when calling this multiple times on accessories that already exist.
      this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
  }
}
