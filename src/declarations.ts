// Declarations used to make the TypeScript compiler happy
declare module 'huejay' {
    export class Client {
        constructor(options: Client.Options);
    }

    export namespace Client {
        export type Options = {
            host: string;
            port?: number;
            username?: string;
            timeout?: number;
        };
    }

    export class Error {}
}
