export async function timeout<T>(
    duration: number,
    defaultValue: T,
): Promise<T> {
    return await new Promise((resolve) =>
        setTimeout(() => {
            resolve(defaultValue);
        }, duration),
    );
}

export async function delay<T>(duration: number, value: T): Promise<T> {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve(value);
        }, duration);
    });
}
