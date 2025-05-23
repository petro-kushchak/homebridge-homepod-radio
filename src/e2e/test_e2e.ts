import { Logger } from 'homebridge';

import { AirPlayDevice } from '../lib/airplayDevice.js';
import { delay } from '../lib/promises.js';

class TestLogger implements Logger {

    constructor() {}

    info (...args): void {
        console.log(args.join(' '));
    }
    debug (...args): void {
        console.log(args.join(' '));
    }
    warn (...args): void {
        console.log(args.join(' '));
    }
    error (...args): void {
        console.log(args.join(' '));
    }
    log (...args): void {
        console.log(args.join(' '));
    }
    success (...args): void {
        console.log(args.join(' '));
    }
}

const homepodId = 'F434F0108877';
const logger: Logger = new TestLogger();

const deviceE2E = async () => {
    const device = new AirPlayDevice(
        homepodId,
        logger,
        true,
        'E2E',
        'https://o.tavrmedia.ua/jazz3cover',
        'https://www.apple.com/v/apple-music/q/images/shared/og__ckjrh2mu8b2a_image.png',
    );

    await device.playStream('https://online.radiojazz.ua/RadioJazz_Cover', 'E2E', 0);
    await delay(5000, 0);
    console.log(`IS_PLAYING: ${device.isPlaying()}`);
    await device.stop();
    console.log(`IS_PLAYING: ${device.isPlaying()}`);

};

// Create a new async function (a new scope) and immediately call it!
(async () => {
    await deviceE2E();
})();
