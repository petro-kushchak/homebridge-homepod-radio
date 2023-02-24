import { PlatformConfig } from 'homebridge';
import { PLUGIN_MODEL } from './platformConstants';

export interface Radio {
      name: string;
      model: string;
      radioUrl: string;
      trackName: string;
      autoResume: boolean;
      metadataUrl: string;
      artworkUrl: string;
      onSwitch: boolean;
      volume: number;
}

export interface AudioFile {
      name: string;
      fileName: string;
      volume: number;
}

export class HomepodRadioPlatformConfig {
      public readonly homepodId: string;
      public readonly serialNumber: string;
      public readonly verboseMode: boolean;
      public readonly radios: Radio[];
      public readonly audioFiles: AudioFile[];
      public readonly mediaPath: string;
      public readonly httpPort: number;

      constructor(private config: PlatformConfig) {
          this.radios = [];
          this.audioFiles = [];
          if (!config.homepodId) {
              throw 'Missing "homepodId" setting!';
          }
          this.homepodId = config.homepodId;
          this.serialNumber = config.serialNumber || `HPD${this.homepodId}`;
          this.verboseMode = !!config.verboseMode && config.verboseMode ? true : false;

          this.httpPort = this.config.httpPort || 4567;
          this.mediaPath = this.config.mediaPath || '';

          this.loadRadios();
          this.loadAudioFiles();
      }

      private loadAudioFiles() {
          if (this.config.audioFiles) {
              this.config.audioFiles.forEach((audioConfig) => {
                  const audioFile = {
                      name: audioConfig.name,
                      fileName: audioConfig.fileName,
                      volume: audioConfig.volume || 0,
                  } as AudioFile;

                  this.audioFiles.push(audioFile);
              });
          }
      }

      private loadRadios() {
          //backward compatibility - single accessory mode
          if (!this.config.radios) {
              const radio = {
                  name: this.config.name || 'HomePod Radio',
                  model: this.config.model || PLUGIN_MODEL,
                  radioUrl: this.config.radioUrl,
                  trackName: this.config.trackName || this.config.name,
                  serialNumber: this.serialNumber,
                  autoResume: false,
                  metadataUrl: this.config.metadataUrl || '',
                  artworkUrl: this.config.artworkUrl || '',
                  onSwitch: this.config.onSwitch || false,
                  volume: this.config.volume || 0,
              } as Radio;

              this.radios.push(radio);
          } else {
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
                  } as Radio;

                  this.radios.push(radio);
              });
          }
      }

      public getRadioNames(): string[] {
          return this.radios.map((r) => r.name);
      }
}
