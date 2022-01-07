import { API } from 'homebridge';

export = (api: API) => {
    const Characteristic = api.hap.Characteristic;

    return class CurrentTrack extends Characteristic {
    static readonly UUID: string = '00000045-0000-1000-8000-656261617577';

    constructor() {
        super('Current Track', CurrentTrack.UUID, {
            format: Characteristic.Formats.STRING,
            perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
        });
        this.value = this.getDefaultValue();
    }
    };
};
