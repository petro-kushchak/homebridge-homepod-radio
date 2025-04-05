import { Logger, PlatformConfig } from 'homebridge';

import { HomepodRadioPlatformConfig } from './platformConfig.js';
import { HomepodRadioPlatformWebActions, WebActionType } from './platformWebActions.js';

import { PlaybackController } from './lib/playbackController.js';

describe('HomepodRadioPlatformWebActions Tests', () => {
    describe('test action parsing', () => {
        let testConfig: HomepodRadioPlatformConfig;
        const logger: Logger = {
            info: () => {},
            warn: () => {},
            debug: () => {},
            error: () => {},
            log: () => {},
            success: () => {},
        };
        const playbackController = new PlaybackController();

        beforeAll(async () => {
            const config: PlatformConfig = {
                platform: 'test',
                mediaPath: '/test',
                homepodId: '123',
            };
            testConfig = new HomepodRadioPlatformConfig(config);
            expect(testConfig).not.toBeNull();
        });

        it('calling /play/hello.wav', () => {
            const platformActions = new HomepodRadioPlatformWebActions(
                testConfig,
                playbackController,
                logger,
            );
            const fileName = 'hello.wav';
            const action = `/play/${fileName}`;
            const webAction = platformActions.parseAction(action);
            expect(webAction.action).toEqual(WebActionType.PlayFile);
            expect(webAction.data).toEqual(`${testConfig.mediaPath}/${fileName}`);
        });

        it('calling /play22/hello.wav', () => {
            const platformActions = new HomepodRadioPlatformWebActions(
                testConfig,
                playbackController,
                logger,
            );
            const fileName = 'hello.wav';
            const action = `/play22/${fileName}`;
            const webAction = platformActions.parseAction(action);
            expect(webAction.action).toEqual(WebActionType.Unsupported);
        });
    });
});
