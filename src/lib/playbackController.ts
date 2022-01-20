export interface PlaybackStreamer {
    stopRequested(source: PlaybackStreamer): Promise<void>;
    shutdownRequested(): Promise<void>;
    platformLaunched(): Promise<void>;
    streamerName(): string;
  }

export class PlaybackController {
    private readonly streamers: PlaybackStreamer[];
    public constructor() {
        this.streamers = [];
    }

    public addStreamer(streamer: PlaybackStreamer) {
        this.streamers.push(streamer);
    }

    public async requestStop(source: PlaybackStreamer): Promise<void> {
        this.streamers.forEach(async (streamer) => {
            if (streamer !== source) {
                await streamer.stopRequested(source);
            }
        });
    }

    public async shutdown(): Promise<void> {
        this.streamers.forEach(async (streamer) => {
            await streamer.shutdownRequested();
        });
    }

    public async platformReady(): Promise<void> {
        this.streamers.forEach(async (streamer) => {
            await streamer.platformLaunched
            ();
        });
    }
}
