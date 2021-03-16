// Copyright (c) 2019-2021, The TurtleCoin Developers
//
// Please see the included LICENSE file for more information.

import { EventEmitter } from 'events';
import { Metronome } from 'node-metronome';
import { TurtleCoind, TurtleCoindTypes } from 'turtlecoin-utils';

/** @ignore */
const pkg = require('../package.json');

export class BlockchainMonitor extends EventEmitter {
    private state: TurtleCoindTypes.IBlockTemplate = {
        blob: '',
        height: 0,
        difficulty: 0,
        reservedOffset: 0
    };

    private node: TurtleCoind;
    private timer: Metronome;

    constructor (
        private walletAddress: string =
        'TRTLv1pacKFJk9QgSmzk2LJWn14JGmTKzReFLz1RgY3K9Ryn7783RDT2TretzfYdck5GMCGzXTuwKfePWQYViNs4avKpnUbrwfQ',
        private m_host: string = '127.0.0.1',
        private m_port: number = 11898,
        private m_ssl: boolean = false,
        private m_timeout: number = 1000,
        private m_checkInterval: number = 1000
    ) {
        super();

        this.node = this.update();

        this.timer = new Metronome(this.m_checkInterval);

        this.timer.paused = true;

        this.timer.on('tick', async () => {
            try {
                const data = await this.node.blockTemplate(walletAddress, 8);

                if (data.height > this.state.height) {
                    this.state = data;

                    this.emit('update', data);
                }
            } catch (error) {
                this.emit('warning', error);
            }
        });
    }

    public get host (): string {
        return this.m_host;
    }

    public set host (host: string) {
        this.m_host = host;

        this.node = this.update();
    }

    public get port (): number {
        return this.m_port;
    }

    public set port (port: number) {
        this.m_port = port;

        this.node = this.update();
    }

    public get ssl (): boolean {
        return this.m_ssl;
    }

    public set ssl (ssl: boolean) {
        this.m_ssl = ssl;

        this.node = this.update();
    }

    public get timeout (): number {
        return this.m_timeout;
    }

    public set timeout (timeout: number) {
        this.m_timeout = timeout;

        this.node = this.update();
    }

    public on (event: 'update', listener:
        (data: TurtleCoindTypes.IBlockTemplate) => void): this;

    public on (event: 'warning', listener:
        (error: Error) => void): this;

    public on (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    public once (event: 'update', listener:
        (template: TurtleCoindTypes.IBlockTemplate) => void): this;

    public once (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    public update_node (host = this.host, port = this.port, ssl = this.ssl, timeout = this.timeout) {
        this.m_host = host;

        this.m_port = port;

        this.m_ssl = ssl;

        this.m_timeout = timeout;

        this.node = this.update();
    }

    public start (): void {
        this.timer.paused = false;

        this.timer.tick();
    }

    public stop (): void {
        this.timer.paused = true;
    }

    public destroy () {
        this.timer.destroy();
    }

    private update (): TurtleCoind {
        return new TurtleCoind(
            this.m_host,
            this.m_port,
            this.m_timeout,
            this.m_ssl,
            'TurtleCoin-Solo-Pool/' + pkg.version,
            true);
    }
}
