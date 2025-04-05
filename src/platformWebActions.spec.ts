/* eslint-disable @typescript-eslint/no-unused-vars */

import { Logger, PlatformConfig } from 'homebridge';

import { HomepodRadioPlatformConfig } from './platformConfig.js';
import { HomepodRadioPlatformWebActions, WebActionType } from './platformWebActions.js';

import { PlaybackController } from './lib/playbackController.js';

class TestLogger implements Logger {

    constructor() {}

    info (...args): void {}
    debug (...args): void {}
    warn (...args): void {}
    error (...args): void {}
    log (...args): void {}
    success (...args): void {}
}

describe('HomepodRadioPlatformWebActions Tests', () => {
    describe('test action parsing', () => {
        let testConfig: HomepodRadioPlatformConfig;
        const logger: Logger = new TestLogger();
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
