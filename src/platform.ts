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

import CurrentTrackCharacteristic = require('./currentTrackCharacteristic');
import ChangeTrackCharacteristic = require('./changeTrackCharacteristic');
const PLUGIN_NAME = 'homebridge-homepod-radio-platform';

let hap: HAP;
let CurrentTrackCharacteristicType;
let ChangeTrackCharacteristicType;

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HomepodRadioPlatform implements IndependentPlatformPlugin {
  private readonly name: string;
  public readonly model: string;
  public readonly homepodId: string;
  public readonly radioUrl: string;
  public readonly trackName: string;
  public readonly serialNumber: string;

  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic &
    typeof CurrentTrackCharacteristicType &
    typeof ChangeTrackCharacteristicType = this.api.hap.Characteristic;

  public readonly CurrentTrack;
  public readonly ChangeTrack;

  constructor(
    public logger: Logging,
    private config: PlatformConfig,
    private api: API,
  ) {
    hap = api.hap;

    this.homepodId = config.homepodId;
    this.CurrentTrack = CurrentTrackCharacteristic(api);
    CurrentTrackCharacteristicType = this.CurrentTrack;

    this.ChangeTrack = ChangeTrackCharacteristic(api);
    ChangeTrackCharacteristicType = this.ChangeTrack;

    this.Characteristic = Object.defineProperty(
      this.api.hap.Characteristic,
      'CurrentTrack',
      { value: this.CurrentTrack },
    );

    this.Characteristic = Object.defineProperty(
      this.api.hap.Characteristic,
      'ChangeTrack',
      { value: this.ChangeTrack },
    );

    // extract name from config
    this.name = config.name;
    this.model = config.model || 'Radio BBC';

    this.radioUrl = config.radioUrl;
    this.trackName = config.trackName || 'Radio BBC';
    this.serialNumber = config.serialNumber || '1.0.0.1';

    // this.setupCustomCharacteristics();

    this.api.on('didFinishLaunching', () => {
      this.logger.info('Finished initializing platform:', this.config.platform);
      this.addAccessories();
    });
  }

  private addAccessories() {
    // Use Roons output_id to create the UUID. This will ensure the accessory is always in sync.
    const uuid = hap.uuid.generate('homebridge:homepod:radio:' + this.name);
    const accessory = new this.api.platformAccessory(this.name, uuid);

    // Adding 26 as the category is some special sauce that gets this to work properly.
    // @see https://github.com/homebridge/homebridge/issues/2553#issuecomment-623675893
    accessory.category = 26;

    new HomepodRadioPlatformAccessory(this, accessory);

    // SmartSpeaker service must be added as an external accessory.
    // @see https://github.com/homebridge/homebridge/issues/2553#issuecomment-622961035
    // There a no collision issues when calling this multiple times on accessories that already exist.
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
  }
}
