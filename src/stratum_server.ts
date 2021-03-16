// Copyright (c) 2019-2021, The TurtleCoin Developers
//
// Please see the included LICENSE file for more information.

import { EventEmitter } from 'events';
import * as net from 'net';
import * as util from 'util';
import { v4 as uuid } from 'uuid';
import { Logger } from '@turtlepay/logger';

export class StratumServer extends EventEmitter {
    private m_server: net.Server;
    private connections: Map<string, net.Socket> = new Map<string, net.Socket>();

    constructor (private bind_ip: string = '0.0.0.0', private port: number = 3333) {
        super();

        if (net.isIP(this.bind_ip) === 0) throw new Error('Invalid Bind IP');

        this.m_server = net.createServer({
            pauseOnConnect: true
        });

        this.m_server.on('error', error => {
            const obj = this.m_server.address();

            this.emit('error', error, obj);
        });

        this.m_server.on('connection', connection =>
            this.handle_connection(connection));

        this.m_server.on('listening', () => {
            const obj = this.m_server.address();

            this.emit('listening', obj);
        });

        this.m_server.on('end', () => this.emit('end'));
    }

    public get connection_ids (): string[] {
        const result: string[] = [];

        for (const id of this.connections.keys()) {
            result.push(id);
        }

        return result;
    }

    public on (event: 'error', listener:
        (error: Error, server: net.AddressInfo) => void): this;

    public on (event: 'listening', listener:
        (server: net.AddressInfo) => void): this;

    public on (event: 'end', listener: () => void): this;

    public on (event: 'socket_error', listener:
        (connection_id: string, error: Error) => void): this;

    public on (event: 'socket_close',
        listener: (connection_id: string, remote: net.AddressInfo) => void): this;

    public on (event: 'connection', listener:
        (connection_id: string, remote: net.AddressInfo) => void): this;

    public on (event: 'data', listener:
        (connection_id: string, data: any) => void): this;

    public on (event: 'raw', listener:
        (connection_id: string, data: Buffer) => void): this;

    public on (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    public start () {
        return this.m_server.listen(this.port, this.bind_ip);
    }

    public stop () {
        return this.m_server.close();
    }

    public connected (connection_id: string): boolean {
        return this.connections.has(connection_id);
    }

    public handle_connection (conn: net.Socket) {
        const id = uuid().replace(/-/g, '');

        conn.setKeepAlive(true);

        conn.on('error', error => {
            this.emit('socket_error', id, error);

            this.hangup(id);
        });

        conn.on('data', data => {
            try {
                data = JSON.parse(data.toString());

                this.emit('data', id, data);
            } catch (e) {
                this.emit('raw', id, data);
            }
        });

        conn.on('end', () => this.hangup(id));

        conn.on('close', () => this.emit('socket_close', id));

        this.connections.set(id, conn);

        this.emit('connection', id, conn.remoteAddress);
    }

    public accept (connection_id: string): boolean {
        if (!this.connected(connection_id)) return false;

        const socket = this.connections.get(connection_id);

        if (socket) {
            socket.resume();
        } else {
            return false;
        }

        return true;
    }

    public async write (
        connection_id: string,
        data: any,
        always_resolve = false
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.connected(connection_id)) {
                if (!always_resolve) {
                    return reject(new Error('Connection ID does not exist'));
                }

                return resolve();
            }

            if (typeof data !== 'string') {
                data = JSON.stringify(data);

                data = util.format('%s\n', data.trim());
            }

            const timer = setTimeout(() => {
                if (!always_resolve) {
                    return reject(new Error('Could not write to socket'));
                }

                return resolve();
            }, 2000);

            const socket = this.connections.get(connection_id);

            if (!socket) {
                if (!always_resolve) {
                    return reject(new Error('Could not get socket'));
                }

                return resolve();
            }

            socket.write(data, () => {
                clearTimeout(timer);

                Logger.debug('Sent to %s: %s', connection_id, JSON.stringify(data));

                return resolve();
            });
        });
    }

    public hangup (connection_id: string): boolean {
        if (!this.connected(connection_id)) return false;

        try {
            const socket = this.connections.get(connection_id);

            if (!socket) return false;

            socket.destroy();

            this.connections.delete(connection_id);

            return true;
        } catch (e) {
            return false;
        }
    }
}
