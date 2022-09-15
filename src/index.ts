import { API } from 'homebridge';
import { HomepodRadioPlatform } from './platform';
import { PLATFORM_NAME, PLUGIN_NAME } from './platformConstants';

/*
 * Initializer function called when the plugin is loaded.
 */
export = (api: API) => {
    api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, HomepodRadioPlatform);
};
