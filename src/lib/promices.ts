export async function timeout<T>(duration: number, defaultValue: T): Promise<T> {
    return await new Promise(resolve => setTimeout(() => {
        resolve(defaultValue);
    }, duration));
}