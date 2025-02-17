import browser, {Runtime} from 'webextension-polyfill';

import {logErrorsFrom} from "../oops";
import {NanoPort, NanoService, NanoTimeoutError, RemoteNanoError} from '.';
import {
    Envelope, NotifyEnvelope, RequestEnvelope, ResponseEnvelope, Response, Send,
} from './proto';
import {makeRandomString} from '../random';

let listener_count = 0;

// (<any>globalThis).trace_nano_ports = true;

// istanbul ignore next
const trace = (...args: any[]) => {
    if (! (<any>globalThis).trace_nano_ports) return;
    console.log(`[NanoPort ${globalThis?.location?.pathname}]`, ...args);
};

export class SvcRegistry {
    private services = new Map<string, NanoService<Send, Send>>();
    private listener = (port: RTPort) => {
        const svc = this.services.get(port.name);
        if (! svc) {
            // Probably intended for another audience.
            trace(`[listener] ignored connection for ${port.name}`);
            return;
        }

        ++listener_count;
        const nport = new Port<Send, Send>(`${port.name}<${listener_count}`, port);
        nport.onDisconnect = () => {
            // istanbul ignore else
            if (svc.onDisconnect) svc.onDisconnect(nport);
        };
        nport.onRequest = msg => {
            if (svc.onRequest) return svc.onRequest(nport, msg);
            return not_implemented();
        };
        nport.onNotify = msg => {
            if (svc.onNotify) svc.onNotify(nport, msg);
            else /* istanbul ignore else */ if (svc.onRequest) svc.onRequest(nport, msg);
        };

        trace(`[listener] Accepted connection for ${port.name} as ${nport.name}`);
        if (svc.onConnect) svc.onConnect(nport);
    };

    reset_testonly() {
        this.services.clear();
        browser.runtime.onConnect.removeListener(this.listener);
    }

    register(name: string, svc: NanoService<Send, Send>) {
        // istanbul ignore if
        if (this.services.has(name)) {
            throw new Error(`Service ${name} is already launched`);
        }

        trace('[listener] listening for service', name);
        this.services.set(name, svc);

        // istanbul ignore else
        if (this.services.size == 1) {
            // We wait to start listening until the first service is actually
            // registered, because of Firefox bug 1465514--listening for ANY
            // connections and then dropping a connection may result in other,
            // unrelated connections getting spuriously dropped.
            browser.runtime.onConnect.addListener(this.listener);
        }
    }
}

export const registry = new SvcRegistry();

export class Port<S extends Send, R extends Send>
    implements NanoPort<S, R>
{
    static connect<MM extends Send, PM extends Send>(
        name: string
    ): Port<MM, PM> {
        trace('connect', name);
        return new Port(name, browser.runtime.connect(undefined, {name}));
    }

    readonly name: string;
    defaultTimeoutMS = 2000;

    onDisconnect?: (port: NanoPort<S, R>) => void;
    onRequest?: (msg: R) => Promise<S>;
    onNotify?: (msg: R) => void;

    private port: RTPort;
    private pending: Map<string, PendingMsg<R>> = new Map();

    constructor(name: string, port: RTPort) {
        this.name = name;
        this.port = port;

        this.port.onDisconnect.addListener(() => {
            this._trace('disconnected');
            this._flushPendingOnDisconnect();
            if (this.onDisconnect) this.onDisconnect(this);
        });

        this.port.onMessage.addListener(((msg: Envelope<R>) => {
            this._trace('recv', msg);
            if (typeof msg !== 'object') return;

            if ('tag' in msg) {
                if ('request' in msg) {
                    logErrorsFrom(() => this._handleRequest(msg));

                } else if ('response' in msg || 'error' in msg) {
                    this._handleResponse(msg);
                }

            } else if ('notify' in msg) {
                if (this.onNotify) this.onNotify(msg.notify as R);
                else {
                    // istanbul ignore else
                    if (this.onRequest) this.onRequest(msg.notify as R);
                }
            }
        }) as (msg: object) => void);

        this._trace('create');
    }

    disconnect() {
        this._trace('disconnect');
        this.port.disconnect();
        this._flushPendingOnDisconnect();
    }

    request(request: S, options?: {timeout_ms?: number}): Promise<R> {
        return new Promise((resolve, reject) => {
            let tag = makeRandomString(4);
            // istanbul ignore next
            while (this.pending.has(tag)) tag = makeRandomString(4);

            this._trace('send', {tag, request});
            this.port.postMessage({tag, request} as RequestEnvelope<S>);

            this.pending.set(tag, {
                resolve, reject,
                timeout_id: setTimeout(
                    () => {
                        this.pending.delete(tag);
                        reject(new NanoTimeoutError(request, tag));
                    },
                    options?.timeout_ms ?? this.defaultTimeoutMS),
            });
        });
    }

    notify(notify: S) {
        try {
            this._trace('send', {notify});
            this.port.postMessage({notify} as NotifyEnvelope<S>);
        } catch (e) {
            // If we are unable to send due to a disconnected port, the message
            // is simply dropped.
        }
    }

    private _flushPendingOnDisconnect() {
        for (const [tag, pending] of this.pending) {
            this._trace('flush on disconnect', tag);
            pending.reject(new Error("Disconnected"));
        }
        this.pending.clear();
    }

    private async _handleRequest(msg: RequestEnvelope<R>) {
        let res: Response<S>;

        try {
            if (! this.onRequest) await not_implemented();
            res = {response: await this.onRequest!(msg.request as R)};

        } catch (e) {
            let data: Send;
            try {
                data = JSON.parse(JSON.stringify(e));
            } catch (ee) {
                data = `${e}`;
            }

            if (e instanceof Error) {
                res = {error: {
                    name: e.name, message: e.message, stack: e.stack, data
                }};
            } else if (e instanceof Object) {
                res = {error: { name: e.constructor.name, data}};
            } else {
                res = {error: {name: '', data}};
            }
        }

        const resmsg: ResponseEnvelope<S> = {tag: msg.tag, ...res};

        try {
            this._trace('send', resmsg);
            this.port.postMessage(resmsg);
        } catch (e) {
            // If the other side becomes disconnected before we can send the
            // reply, just drop it.  We should get a disconnection event later.
            this._trace('dropped reply to request:', msg, 'error:', e);
        }
    }

    private _handleResponse(msg: ResponseEnvelope<R>) {
        const handler = this.pending.get(msg.tag);
        if (! handler) return;

        if ('response' in msg) {
            handler.resolve(msg.response);
        } else {
            handler.reject(new RemoteNanoError(msg.error));
        }
    }

    private _trace(...args: any[]) {
        trace(`[${this.name}]`, ...args);
    }
}

type PendingMsg<M extends Send> = {
    resolve: (msg: M) => void,
    reject: (err: Error) => void,
    timeout_id: ReturnType<typeof setTimeout>,
};

type RTPort = Runtime.Port;

function not_implemented(): Promise<any> {
    const e = new Error('No request handler defined');
    e.name = 'NotImplemented';
    return Promise.reject(e);
}
