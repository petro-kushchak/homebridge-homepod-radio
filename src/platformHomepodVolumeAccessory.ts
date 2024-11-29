import { AccessoryPlugin, Service, PlatformAccessory, CharacteristicEventTypes, CharacteristicValue } from 'homebridge';
import { AirPlayDevice } from './lib/airplayDevice';
import { callbackify } from './lib/homebridgeCallbacks';
import { HomepodRadioPlatform } from './platform';
import { PLUGIN_MANUFACTURER, PLUGIN_MODEL } from './platformConstants';
import { PlaybackStreamer } from './lib/playbackController';

export class HomepodVolumeAccessory implements AccessoryPlugin, PlaybackStreamer {
    private readonly device: AirPlayDevice;
    private readonly service: Service;
    private readonly informationService: Service;

    private currentVolume: number;

    constructor(private readonly platform: HomepodRadioPlatform, private readonly accessory: PlatformAccessory) {
        this.device = new AirPlayDevice(
            this.platform.platformConfig.homepodId,
            platform.logger,
            platform.platformConfig.verboseMode,
            this.streamerName(),
            '',
            '',
        );

        this.currentVolume = 25;

        this.service =
            this.accessory.getService(this.platform.Service.Lightbulb) ||
            this.accessory.addService(this.platform.Service.Lightbulb);

        this.service
            .getCharacteristic(this.platform.Characteristic.On)
            .on(CharacteristicEventTypes.GET, callbackify(this.getOn.bind(this)))
            .on(CharacteristicEventTypes.SET, callbackify(this.setOn.bind(this)));

        this.service
            .getCharacteristic(this.platform.Characteristic.Brightness)
            .on(CharacteristicEventTypes.GET, callbackify(this.getCurrentVolume.bind(this)));
        this.service
            .getCharacteristic(this.platform.Characteristic.Brightness)
            .on(CharacteristicEventTypes.SET, callbackify(this.setCurrentVolume.bind(this)));

        this.informationService =
            this.accessory.getService(this.platform.Service.AccessoryInformation) ||
            this.accessory.addService(this.platform.Service.AccessoryInformation);

        this.informationService
            .setCharacteristic(this.platform.Characteristic.Manufacturer, PLUGIN_MANUFACTURER)
            .setCharacteristic(this.platform.Characteristic.Model, PLUGIN_MODEL)
            .setCharacteristic(
                this.platform.Characteristic.SerialNumber,
                this.platform.platformConfig.serialNumber,
            );

        // This will do its best to keep the actual outputs status up to date with Homekit.
        setInterval(async () => {
            // this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.isPlaying());
        }, 3000);

        this.platform.logger.info(`[${this.streamerName()}] finished initializing!`);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async stopRequested(source: PlaybackStreamer): Promise<void> {
        return await Promise.resolve();
    }

    async shutdownRequested(): Promise<void> {
        return await Promise.resolve();
    }

    async platformLaunched(): Promise<void> {
        return await Promise.resolve();
    }

    async volumeUpdated(homepodId: string, volume: number): Promise<void> {
        if (homepodId === this.platform.platformConfig.homepodId) {
            await this.setCurrentVolume(volume);
        }
    }

    isPlaying(): boolean {
        return this.device.isPlaying();
    }

    async startPlaying(): Promise<void> {
        return await Promise.resolve();
    }

    async stopPlaying(): Promise<void> {
        return await Promise.resolve();
    }

    /**
     * Get On/Off
     */
    async getOn(): Promise<CharacteristicValue> {
        this.platform.logger.info(`[${this.streamerName()}] Triggered GET On/Off`);
        return Promise.resolve(true);
    }

    /**
     * Set On/Off
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async setOn(value: CharacteristicValue): Promise<void> {
        this.platform.logger.info(`[${this.streamerName()}] Triggered SET On/Off`);
        return await Promise.resolve();
    }

    /**
     * Get the current volume.
     */
    async getCurrentVolume(): Promise<CharacteristicValue> {
        this.platform.logger.info(`[${this.streamerName()}] Triggered GET CurrentVolume:`);
        return Promise.resolve(this.currentVolume);
    }

    /**
     * Set the current volume.
     */
    async setCurrentVolume(value: CharacteristicValue): Promise<void> {
        this.platform.logger.info(`[${this.streamerName()}] Triggered SET CurrentVolume: ${value}`);
        this.currentVolume = parseInt('' + value);
        await this.device.setVolume(this.currentVolume);
    }

    streamerName(): string {
        return `Homepod Volume ${this.platform.platformConfig.homepodId}`;
    }

    /*
    * This method is called directly after creation of this instance.
    * It should return all services which should be added to the accessory.
    */
    getServices(): Service[] {
        return [this.informationService, this.service];
    }
}
