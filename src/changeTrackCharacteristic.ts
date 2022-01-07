import { API } from 'homebridge';

export = (api: API) => {
    const Characteristic = api.hap.Characteristic;

    return class ChangeTrack extends Characteristic {
    static readonly UUID: string = '00000047-0000-1000-8000-656261617577';

    constructor() {
        super('Change Track', ChangeTrack.UUID, {
            format: Characteristic.Formats.INT,
            minValue: -1,
            maxValue: 1,
            minStep: 1,
            perms: [
                Characteristic.Perms.READ,
                Characteristic.Perms.NOTIFY,
                Characteristic.Perms.WRITE,
            ],
        });
        this.value = this.getDefaultValue();
    }
    };
};
