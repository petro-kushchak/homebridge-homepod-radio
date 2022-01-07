import { API } from 'homebridge';
import { HomepodRadioPlatform } from './platform';

const PLATFORM_NAME = 'HomepodRadioPlatform';

/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
    api.registerPlatform(PLATFORM_NAME, HomepodRadioPlatform);
};
