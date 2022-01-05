/**
 * AirPlay device
 */

export class AirPlayDevice {
    constructor (private readonly deviceIp: string) {
        
    }

    public play(streamUrl: string) {
    }

    public stop() {
    }

    public isPlaying(): boolean {
        return false;
    }
}
