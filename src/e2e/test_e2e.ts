import { AirPlayDevice } from '../lib/airplayDevice';

const homepodId = '123';
const logger = {
    info: (...args) => {console.log(args);},
    debug: (...args) => {console.log(args);},
    warn:(...args) => {console.log(args);},
    error: (...args) => {console.log(args);},
    log: (...args) => {console.log(args);},
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
  