import { PlatformConfig } from 'homebridge';
import { PLUGIN_MODEL } from './platformConstants';

export interface RadioConfig {
      name: string;
      model: string;
      radioUrl: string;
      trackName: string;
      autoResume: boolean;
      metadataUrl: string;
      artworkUrl: string;
      onSwitch: boolean;
      volume: number;
      validateRadioUrl: boolean;
}

export interface AudioConfig {
      name: string;
      fileName: string;
      volume: number;
}

export class HomepodRadioPlatformConfig {
      public readonly homepodId: string;
      public readonly serialNumber: string;
      public readonly verboseMode: boolean;
      public readonly radios: RadioConfig[];
      public readonly audioConfigs: AudioConfig[];
      public readonly mediaPath: string;
      public readonly httpPort: number;

      public readonly enableVolumeControl: boolean;
      public readonly telegramUpdateToken: string;
      public readonly telegramUpdateChatId: string;

      constructor(private config: PlatformConfig) {
          this.radios = [];
          this.audioConfigs = [];
          if (!config.homepodId) {
              throw 'Missing "homepodId" setting!';
          }
          this.homepodId = config.homepodId;
          this.serialNumber = config.serialNumber || `HPD${this.homepodId}`;
          this.verboseMode = !!config.verboseMode && config.verboseMode ? true : false;

          this.httpPort = this.config.httpPort || 4567;
          this.mediaPath = this.config.mediaPath || '';

          this.telegramUpdateToken = this.config.telegramUpdateToken || '';
          this.telegramUpdateChatId = this.config.telegramUpdateChatId || '';

          this.enableVolumeControl = this.config.enableVolumeControl || false;

          this.loadRadios();
          this.loadAudioConfigs();
      }

      private loadAudioConfigs() {
          if (this.config.audioFiles) {
              this.config.audioFiles.forEach((audioConfig) => {
                  const config = {
                      name: audioConfig.name,
                      fileName: audioConfig.fileName,
                      volume: audioConfig.volume || 0,
                  } as AudioConfig;

                  this.audioConfigs.push(config);
              });
          }
      }

      private loadRadios() {
          if (this.config.radios) {
              this.config.radios.forEach((radioConfig) => {
                  const radio = {
                      name: radioConfig.name,
                      model: radioConfig.model || PLUGIN_MODEL,
                      radioUrl: radioConfig.radioUrl,
                      trackName: radioConfig.trackName || radioConfig.name,
                      serialNumber: this.serialNumber,
                      autoResume: radioConfig.autoResume || false,
                      metadataUrl: radioConfig.metadataUrl || '',
                      artworkUrl: radioConfig.artworkUrl || '',
                      onSwitch: radioConfig.onSwitch || false,
                      volume: radioConfig.volume || 0,
                      validateRadioUrl: radioConfig.validateRadioUrl || false,
                  } as RadioConfig;

                  this.radios.push(radio);
              });
          }
      }

      public getRadioNames(): string[] {
          return this.radios.map((r) => r.name);
      }
}
