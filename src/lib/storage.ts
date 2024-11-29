import { promises as fs } from 'fs';

export class Storage {
    public constructor(private readonly filePath: string) {
    }

    public async write<T>(data: Record<string, T>): Promise<void> {
        await fs.writeFile(this.filePath, JSON.stringify(data), 'utf8');
    }

    public async read<T>(): Promise<Record<string, T> | null> {
        try {
            const data = await fs.readFile(this.filePath);
            return JSON.parse(data.toString());
        } catch (err) {
            return null;
        }
    }
}
