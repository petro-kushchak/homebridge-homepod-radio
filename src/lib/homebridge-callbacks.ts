/* eslint-disable @typescript-eslint/ban-types */
export function callbackify(task: (...taskArgs: any[]) => Promise<any>): any {
    return (...args: any[]) => {
        const onlyArgs: any[] = [];
        let callback: Function = undefined;

        for (const arg of args) {
            if (typeof arg === 'function') {
                callback = arg;
                break;
            }
            onlyArgs.push(arg);
        }
        if (!callback) {
            throw new Error('Missing callback parameter!');
        }
        task(...onlyArgs)
            .then((data: any) => callback(undefined, data))
            .catch((err: any) => callback(err));
    };
}
