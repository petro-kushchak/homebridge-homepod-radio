import { PlatformConfig } from 'homebridge';

export interface Radio {
  name: string;
  model: string;
  radioUrl: string;
  trackName: string;
  volume: number;
  autoResume: boolean;
}

export class HomepodRadioPlatformConfig {
  public readonly homepodId: string;
  public readonly serialNumber: string;
  public readonly verboseMode: boolean;
  public readonly volumeControl: boolean;
  public readonly radios: Radio[];
  public readonly mediaPath: string;
  public readonly httpPort: number;

  constructor(private config: PlatformConfig) {
      this.radios = [];
      if (!config.homepodId) {
          throw 'Missing "homepodId" setting!';
      }
      this.homepodId = config.homepodId;
      this.serialNumber = config.serialNumber || `HPD${this.homepodId}`;
      this.verboseMode =
      !!config.verboseMode && config.verboseMode ? true : false;

      this.httpPort = this.config.httpPort || 4567;
      this.mediaPath = this.config.mediaPath || '';

      this.volumeControl =
      !!config.volumeControl && config.volumeControl ? true : false;

      this.loadRadios();
  }

  private loadRadios() {
      //backward compatibility - single accessory mode
      if (!this.config.radios) {
          const radio = {
              name: this.config.name || 'HomePod Radio',
              model: this.config.model || 'Radio BBC',
              radioUrl: this.config.radioUrl,
              trackName: this.config.trackName || 'Radio BBC',
              serialNumber: this.serialNumber,
              volume:
          !!this.config.volume &&
          this.config.volume > 0 &&
          this.config.volume < 100
              ? this.config.volume
              : 0,
              autoResume: false,
          } as Radio;

          this.radios.push(radio);
      } else {
          this.config.radios.forEach((radioConfig) => {
              const radio = {
                  name: radioConfig.name,
                  model: radioConfig.model || 'HomePod Radio',
                  radioUrl: radioConfig.radioUrl,
                  trackName: radioConfig.trackName || 'HomePod Radio',
                  serialNumber: this.serialNumber,
                  volume:
            !!radioConfig.volume &&
            radioConfig.volume > 0 &&
            radioConfig.volume < 100
                ? radioConfig.volume
                : 0,
                  autoResume: radioConfig.autoResume || false,
              } as Radio;

              this.radios.push(radio);
          });
      }
  }

  public getRadioNames(): string[] {
      return this.radios.map((r) => r.name);
  }
}
