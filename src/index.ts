import { API } from 'homebridge';

import { HomepodRadioPlatform } from './platform.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './platformConstants.js';

/*
 * Initializer function called when the plugin is loaded.
 */
export default (api: API) => {
    api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, HomepodRadioPlatform);
};
