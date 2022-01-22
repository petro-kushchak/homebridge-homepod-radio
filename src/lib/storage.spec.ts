import { Storage } from './storage';

import * as path from 'path';
import * as os from 'os';

describe('Storage Tests', () => {
    describe('create storage, write&read', () => {
        it('create write & read', async () => {
            const filePath = path.join(
                os.tmpdir(),
                `test-${new Date().getTime()}.tmp`,
            );
            const storage = new Storage(filePath);
            expect(storage).not.toBeNull();
            await storage.write({ test: 1 });
            const data = await storage.read();
            expect(data['test']).not.toBeNull();
            expect(data['test']).toBe(1);
        });
    });
});
