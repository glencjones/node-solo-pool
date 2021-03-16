// Copyright (c) 2019-2021, The TurtleCoin Developers
//
// Please see the included LICENSE file for more information.

import { EventEmitter } from 'events';
import { StratumServer } from './stratum_server';
import * as net from 'net';
import { Address } from 'turtlecoin-utils';

export interface ILogin {
    login: string;
    pass: string;
    rigid?: string;
    agent?: string;
}

export interface IJobSubmission {
    id: string;
    job_id: string;
    nonce: number;
    result: string;
}

/** @ignore */
interface IPoolReply {
    id: number;
    jsonrpc: '2.0';
    error: any;
}

/** @ignore */
interface IPoolPush {
    jsonrpc: '2.0';
    method: string;
    params: any;
}

export interface IJob {
    id: string;
    job_id: string;
    blob: string;
    target: string;
    height: number;
    blockMajorVersion?: number;
    blockMinorVersion?: number;
    rootMajorVersion?: number;
    rootMinorVersion?: number;
    poolNonce: number;
    difficulty: number;
}

/** @ignore */
interface IPoolLoginOK extends IPoolReply {
    result: {
        id: string;
        job: IJob;
        status: 'OK';
    };
}

/** @ignore */
interface IPoolError extends IPoolReply {
    error: {
        code: number;
        message: string;
    };
}

/** @ignore */
interface IPoolOK extends IPoolReply {
    result: {
        status: 'OK';
    };
}

/** @ignore */
interface IPoolKeepAlive extends IPoolReply {
    result: {
        status: 'KEEPALIVED';
    };
}

/** @ignore */
interface IPoolJob extends IPoolPush {
    method: 'job';
    params: IJob;
}

/** @ignore */
type IPoolResponsePayload = IPoolLoginOK | IPoolError | IPoolOK | IPoolKeepAlive | IPoolJob;

export class StratumController extends EventEmitter {
    private m_server: StratumServer;

    constructor (private ip: string, private port: number) {
        super();

        this.m_server = new StratumServer(ip, port);

        this.m_server.on('socket_error', (id, error) =>
            this.emit('error', error));
        this.m_server.on('error', (error, server) =>
            this.emit('error', error, server));
        this.m_server.on('listening', server =>
            this.emit('listening', server));
        this.m_server.on('connection', (id, remote) =>
            this.emit('connection', id, remote));
        this.m_server.on('socket_close', id =>
            this.emit('close', id));

        this.m_server.on('data', async (id, data) => {
            if (typeof data.method !== 'string' ||
                typeof data.params !== 'object' ||
                typeof data.id === 'undefined') {
                return this.m_server.hangup(id);
            }

            switch (data.method.toLowerCase()) {
                case 'login': {
                    const login_msg = await StratumController.sanitize_login_params(data.params);

                    if (!login_msg) {
                        await this.error(id, data.id, -1, 'Invalid login syntax');

                        return this.m_server.hangup(id);
                    }

                    this.emit('login', id, data.id, login_msg);

                    break;
                }
                case 'submit': {
                    const submit_msg = await StratumController.sanitize_job_submission(data.params);

                    if (!submit_msg) {
                        await this.error(id, data.id, -1,
                            'Invalid share submission syntax');

                        return this.m_server.hangup(id);
                    }

                    this.emit('submit', id, data.id, submit_msg);

                    break;
                }
                case 'getjob': {
                    this.emit('getjob', id, data.id);

                    break;
                }
                case 'keepalived': {
                    this.emit('keepalive', id, data.id);

                    break;
                }
                default:
                    return this.error(id, data.id, -1,
                        'Invalid method specified');
            }
        });
    }

    private static async sanitize_login_params (params: any): Promise<ILogin | undefined> {
        if (typeof params.login !== 'string') return;
        if (typeof params.pass !== 'string') return;

        params.login = params.login.split('.')[0];
        params.login = params.login.split('+')[0];

        try {
            // check to make sure the miner address is okay
            await Address.fromAddress(params.login);

            return params;
        } catch {
            return undefined;
        }
    }

    private static async sanitize_job_submission (params: any): Promise<IJobSubmission | undefined> {
        if (typeof params.job_id !== 'string') return;
        if (typeof params.nonce !== 'string') return;
        if (typeof params.result !== 'string') return;
        if (typeof params.id !== 'string') return;

        const buffer = Buffer.from(params.nonce, 'hex');

        return {
            id: params.id || '',
            job_id: params.job_id || '',
            nonce: buffer.readUInt32LE(0),
            result: params.result || ''
        };
    }

    public on (event: 'error', listener:
        (error: Error, server: net.AddressInfo) => void): this;

    public on (event: 'listening', listener:
        (server: net.AddressInfo) => void): this;

    public on (event: 'connection', listener:
        (connection_id: string, remote: net.AddressInfo) => void): this;

    public on (event: 'close', listener:
        (connection_id: string) => void): this;

    public on (event: 'login', listener:
        (connection_id: string, msg_id: number, data: ILogin) => void): this;

    public on (event: 'submit', listener:
        (connection_id: string, msg_id: number, data: IJobSubmission) => void): this;

    public on (event: 'getjob', listener:
        (connection_id: string, msg_id: number) => void): this;

    public on (event: 'keepalive', listener:
        (connection_id: string, msg_id: number) => void): this;

    public on (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    public start () {
        return this.m_server.start();
    }

    public stop () {
        return this.m_server.stop();
    }

    public async accept (connection_id: string): Promise<boolean> {
        return this.m_server.accept(connection_id);
    }

    public async error (
        connection_id: string,
        message_id: number,
        error_code = -1,
        error_message = 'Undefined Error'
    ): Promise<void> {
        const payload: IPoolError = {
            id: message_id,
            jsonrpc: '2.0',
            error: {
                code: error_code,
                message: error_message
            }
        };

        return this.send(connection_id, payload);
    }

    public async job (
        connection_id: string,
        job: IJob
    ): Promise<void> {
        const payload: IPoolJob = {
            jsonrpc: '2.0',
            method: 'job',
            params: job
        };

        return this.send(connection_id, payload);
    }

    public async keepalive (
        connection_id: string,
        message_id: number
    ): Promise<void> {
        const payload: IPoolKeepAlive = {
            id: message_id,
            jsonrpc: '2.0',
            result: {
                status: 'KEEPALIVED'
            },
            error: null
        };

        return this.send(connection_id, payload);
    }

    public async login_accepted (
        connection_id: string,
        message_id: number,
        job: IJob,
        id: string
    ): Promise<void> {
        const payload: IPoolLoginOK = {
            id: message_id,
            jsonrpc: '2.0',
            result: {
                id: id,
                job: job,
                status: 'OK'
            },
            error: null
        };

        return this.send(connection_id, payload);
    }

    public async login_rejected (
        connection_id: string,
        message_id: number,
        error_code = -1,
        error_message = 'Unknown Login failure'
    ): Promise<void> {
        const payload: IPoolError = {
            id: message_id,
            jsonrpc: '2.0',
            error: {
                code: error_code,
                message: error_message
            }
        };

        return this.send(connection_id, payload);
    }

    public async share_accepted (
        connection_id: string,
        message_id: number
    ): Promise<void> {
        const payload: IPoolOK = {
            id: message_id,
            jsonrpc: '2.0',
            result: {
                status: 'OK'
            },
            error: null
        };

        return this.send(connection_id, payload);
    }

    public share_rejected (
        connection_id: string,
        message_id: number,
        error_code = -1,
        error_message = 'Invalid Share Submitted'
    ): Promise<void> {
        const payload: IPoolError = {
            id: message_id,
            jsonrpc: '2.0',
            error: {
                code: error_code,
                message: error_message
            }
        };

        return this.send(connection_id, payload);
    }

    public async send (
        connection_id: string,
        payload: IPoolResponsePayload,
        always_resolve = true
    ): Promise<void> {
        return this.m_server.write(connection_id, payload, always_resolve);
    }
}
