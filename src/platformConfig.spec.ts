import { PlatformConfig } from 'homebridge';
import { HomepodRadioPlatformConfig } from './platformConfig';
import { Storage } from './lib/storage';

describe('HomepodRadioPlatformConfig Tests', () => {
    describe('basic flow: config loading', () => {
        let testConfig: PlatformConfig;

        beforeAll(async () => {
            const exampleConfigPath = 'example.config.json';
            const storage: Storage = new Storage(exampleConfigPath);
            testConfig = {
                platform: 'test',
                ...(await storage.read()),
            };
            expect(testConfig).not.toBeNull();
        });

        it('proper loading from example.config.json', async () => {
            const platformConfig = new HomepodRadioPlatformConfig(testConfig);
            expect(platformConfig.homepodId).toEqual(testConfig.homepodId);
            expect(platformConfig.serialNumber).toEqual(testConfig.serialNumber);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(platformConfig.verboseMode).toBeFalsy;
            expect(platformConfig.radios.length).toEqual(1);
            expect(platformConfig.radios[0].name).toEqual(testConfig.radios[0].name);
        });

        it('loading from exmpty config', async () => {
            const test = () => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const platformConfig = new HomepodRadioPlatformConfig({
                    platform: 'test',
                });
            };
            expect(test).toThrow('Missing "homepodId" setting!');
        });

        it('proper loading from single radio config', async () => {
            testConfig = {
                platform: 'test',
                homepodId: '<homepod id>',
                name: 'BBC - Radio 1',
                radioUrl: 'http://stream.live.vc.bbcmedia.co.uk/bbc_radio_one',
            };

            const platformConfig = new HomepodRadioPlatformConfig(testConfig);
            expect(platformConfig.homepodId).toEqual(testConfig.homepodId);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            expect(platformConfig.verboseMode).toBeFalsy;
            expect(platformConfig.radios.length).toEqual(1);
            expect(platformConfig.radios[0].name).toEqual(testConfig.name);
            expect(platformConfig.radios[0].radioUrl).toEqual(testConfig.radioUrl);
        });
    });
});
