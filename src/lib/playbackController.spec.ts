/* eslint-disable @typescript-eslint/no-unused-vars */
import { PlaybackController, PlaybackStreamer } from './playbackController';

class PlaybackStreamerStub implements PlaybackStreamer {
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
