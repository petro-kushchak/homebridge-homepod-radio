import { AirPlayDevice } from '../lib/airplayDevice';

const homepodId = 'F434F0108877';
const logger = {
    info: (...args) => {
        console.log(args.join(' '));
    },
    debug: (...args) => {
        console.log(args.join(' '));
    },
    warn: (...args) => {
        console.log(args.join(' '));
    },
    error: (...args) => {
        console.log(args.join(' '));
    },
    log: (...args) => {
        console.log(args.join(' '));
    },
};

const deviceE2E = async () => {
    const device = new AirPlayDevice(
        homepodId,
        logger,
        true,
        'E2E',
        'https://o.tavrmedia.ua/jazz3cover',
        'https://play.tavr.media/static/image/header_menu/RadioJAZZ_COVER_228x228.png',
    );

    await device.playStream('https://online.radiojazz.ua/RadioJazz_Cover', 'E2E', 0);
};

// Create a new async function (a new scope) and immediately call it!
(async () => {
    await deviceE2E();
})();
