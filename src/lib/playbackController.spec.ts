import { PlaybackController, PlaybackStreamer } from './playbackController';

class PlaybackStreamerStub implements PlaybackStreamer {
    isPlaying(): boolean {
        return false;
    }

    async startPlaying(): Promise<void> {
        Promise.resolve();
    }

    async stopPlaying(): Promise<void> {
        Promise.resolve();
    }

  public stopRequestedRaised = false;
  public shutdownRequestedRaised = false;
  public platformLaunchedRaised = false;

  async stopRequested(source: PlaybackStreamer): Promise<void> {
      this.stopRequestedRaised = true;
  }

  async shutdownRequested(): Promise<void> {
      this.shutdownRequestedRaised = true;
  }

  async platformLaunched(): Promise<void> {
      this.platformLaunchedRaised = true;
  }

  streamerName(): string {
      return 'test';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async volumeUpdated(homepodId: string, volume: number): Promise<void> {
      return await Promise.resolve();
  }
}
describe('PlaybackController Tests', () => {
    describe('basic flow', () => {
        it('make sure streamer receive controller events', async () => {
            const controller = new PlaybackController();
            const streamer = new PlaybackStreamerStub();
            controller.addStreamer(streamer);
            expect(streamer.platformLaunchedRaised).toBeFalsy;
            expect(streamer.stopRequestedRaised).toBeFalsy;
            expect(streamer.shutdownRequestedRaised).toBeFalsy;
            await controller.platformReady();
            expect(streamer.platformLaunchedRaised).toBeTruthy;
            await controller.shutdown();
            expect(streamer.shutdownRequestedRaised).toBeTruthy;
            await controller.requestStop(streamer);
            expect(streamer.stopRequestedRaised).toBeFalsy;
            await controller.requestStop(new PlaybackStreamerStub());
            expect(streamer.stopRequestedRaised).toBeTruthy;
        });
    });
});
