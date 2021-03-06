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
import { HomepodRadioPlatformConfig, Radio } from './platformConfig';
import { HomepodRadioPlatformWebActions } from './platformWebActions';
import { PlaybackController } from './lib/playbackController';
import { delay } from './lib/promices';
import { HttpService } from './lib/httpService';

export const PLUGIN_NAME = 'HomepodRadioPlatform';

let hap: HAP;

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HomepodRadioPlatform implements IndependentPlatformPlugin {
  private readonly playbacController: PlaybackController =
    new PlaybackController();

  private readonly httpService: HttpService;
  private readonly platformActions: HomepodRadioPlatformWebActions;

  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic =
    this.api.hap.Characteristic;

  public readonly platformConfig: HomepodRadioPlatformConfig;

  constructor(
    public logger: Logging,
    private config: PlatformConfig,
    private api: API,
  ) {
      hap = api.hap;

      this.platformConfig = new HomepodRadioPlatformConfig(this.config);
      this.platformActions = new HomepodRadioPlatformWebActions(
          this.platformConfig,
          this.playbacController,
          this.logger,
      );
      this.httpService = new HttpService(
          this.platformConfig.httpPort,
          this.logger,
      );

      const loadedRadios = this.platformConfig.getRadioNames();
      this.logger.info(`Loaded ${loadedRadios.length} radios: ${loadedRadios}`);

      this.api.on('didFinishLaunching', async () => {
          this.logger.info('Finished initializing platform:', this.config.platform);
          this.platformConfig.radios.forEach((radio) => this.addAccessory(radio));
          await delay(1000, 0);
          this.playbacController.platformReady();
          if (this.platformConfig.httpPort > 0) {
              this.httpService.start(
                  async (action) => await this.platformActions.handleAction(action),
              );
          }
      });

      this.api.on('shutdown', () => {
          this.logger.info('Platform: shutdown...');
          this.playbacController.shutdown();
          if (this.platformConfig.httpPort > 0) {
              this.httpService.stop();
          }
      });
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
      this.api.publishExternalAccessories(uuid, [accessory]);
  }
}
