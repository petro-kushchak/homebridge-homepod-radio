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

import { HomepodRadioPlatformAccessory } from './platformRadioAccessory';
import { HomepodRadioPlatformConfig, Radio } from './platformConfig';
import { HomepodRadioPlatformWebActions } from './platformWebActions';
import { PlaybackController } from './lib/playbackController';
import { delay } from './lib/promices';
import { HttpService } from './lib/httpService';
import { HomepodRadioSwitch } from './platformSwitchAccessory';
import { PLUGIN_NAME } from './platformConstants';

let hap: HAP;

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HomepodRadioPlatform implements IndependentPlatformPlugin {
    private readonly playbackController: PlaybackController = new PlaybackController();

    private readonly httpService: HttpService;
    private readonly platformActions: HomepodRadioPlatformWebActions;

    public readonly Service: typeof Service = this.api.hap.Service;
    public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

    public readonly platformConfig: HomepodRadioPlatformConfig;

    constructor(public logger: Logging, private config: PlatformConfig, private api: API) {
        hap = api.hap;

        this.platformConfig = new HomepodRadioPlatformConfig(this.config);
        this.platformActions = new HomepodRadioPlatformWebActions(
            this.platformConfig,
            this.playbackController,
            this.logger,
        );
        this.httpService = new HttpService(this.platformConfig.httpPort, this.logger);

        const loadedRadios = this.platformConfig.getRadioNames();
        this.logger.info(`Loaded ${loadedRadios.length} radios: ${loadedRadios}`);

        this.api.on('didFinishLaunching', async () => {
            this.logger.info('Finished initializing platform:', this.config.platform);
            this.platformConfig.radios.forEach((radio) => this.addAccessory(radio));
            await delay(1000, 0);
            this.playbackController.platformReady();

            if (this.platformConfig.httpPort > 0) {
                this.httpService.start(async (action) => await this.platformActions.handleAction(action));
            }
        });

        this.api.on('shutdown', () => {
            this.logger.info('Platform: shutdown...');
            this.playbackController.shutdown();
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

        const radioAccessory = new HomepodRadioPlatformAccessory(this, radio, accessory, this.playbackController);

        // SmartSpeaker service must be added as an external accessory.
        // @see https://github.com/homebridge/homebridge/issues/2553#issuecomment-622961035
        // There a no collision issues when calling this multiple times on accessories that already exist.
        this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
        if (radio.onSwitch) {
            const switchUuid = hap.uuid.generate('homebridge:homepod:radio:switch:' + radio.name);
            const switchAccessory = new this.api.platformAccessory(`${radio.name} switch`, switchUuid);
            new HomepodRadioSwitch(this, radioAccessory, switchAccessory);
            this.api.publishExternalAccessories(PLUGIN_NAME, [switchAccessory]);
        }
    }
}
