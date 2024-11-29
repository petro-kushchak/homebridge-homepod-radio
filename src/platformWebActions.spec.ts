/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { PlatformConfig } from 'homebridge';
import { PlaybackController } from './lib/playbackController';
import { HomepodRadioPlatformConfig } from './platformConfig';
import {
    HomepodRadioPlatformWebActions,
    WebActionType,
} from './platformWebActions';

describe('HomepodRadioPlatformWebActions Tests', () => {
    describe('test action parsing', () => {
        let testConfig: HomepodRadioPlatformConfig;
        const logger = {
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
