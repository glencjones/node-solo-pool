// Copyright (c) 2019-2021, The TurtleCoin Developers
//
// Please see the included LICENSE file for more information.

import { EventEmitter } from 'events';
import { BlockchainMonitor } from './blockchain_monitor';
import { IJob } from './stratum_controller';
import { BlockTemplate, TurtleCoind, TurtleCoindTypes } from 'turtlecoin-utils';
import { v4 as uuid } from 'uuid';
import { difficulty_to_hex } from './difficulty_helper';
import { Logger } from '@turtlepay/logger';
import { Vardiff } from './vardiff';
import { BigInteger } from 'turtlecoin-utils/dist/Types';

/** @ignore */
const pkg = require('../package.json');

/** @ignore */
import IBlockTemplate = TurtleCoindTypes.IBlockTemplate;

/** @ignore */
const sleep = async (timeout: number): Promise<void> => {
    return new Promise((resolve) => {
        setTimeout(() => {
            return resolve();
        }, timeout);
    });
};

interface IWorker {
    id: string;
    rig_id: string;
    pass: string;
    hashrate: number;
    difficulty: number;
    next_difficulty: number;
}

export class Miner extends EventEmitter {
    private m_monitor: BlockchainMonitor;
    private m_jobs: Map<string, IJob> = new Map<string, IJob>();
    private m_ids: Map<string, {vardiff: Vardiff, rig_id: string, pass: string}> =
        new Map<string, {vardiff: Vardiff, rig_id: string, pass: string}>();

    private m_template: BlockTemplate = new BlockTemplate();
    private m_node: TurtleCoind;
    private m_lasttouch = 0;

    constructor (
        public address: string,
        private m_host: string,
        private m_port: number,
        private m_ssl: boolean,
        private m_timeout = 1000
    ) {
        super();

        this.m_node = new TurtleCoind(m_host, m_port, m_timeout, m_ssl);

        this.m_monitor = new BlockchainMonitor(address, m_host, m_port, m_ssl, m_timeout);
    }

    public get hashrate (): number {
        let rate = 0;

        for (const [, info] of this.m_ids) {
            rate += info.vardiff.hashrate;
        }

        return rate;
    }

    public get last_touch (): number {
        return this.m_lasttouch;
    }

    public get node (): TurtleCoind {
        return this.m_node;
    }

    public get workers (): number {
        return this.m_ids.size;
    }

    public get host (): string {
        return this.m_host;
    }

    public set host (host: string) {
        this.m_host = host;

        this.m_node = this.update();
    }

    public get port (): number {
        return this.m_port;
    }

    public set port (port: number) {
        this.m_port = port;

        this.m_node = this.update();
    }

    public get ssl (): boolean {
        return this.m_ssl;
    }

    public set ssl (ssl: boolean) {
        this.m_ssl = ssl;

        this.m_node = this.update();
    }

    public get timeout (): number {
        return this.m_timeout;
    }

    public set timeout (timeout: number) {
        this.m_timeout = timeout;

        this.m_node = this.update();
    }

    public on (event: 'job', listener: (connection_id: string, job: IJob) => void): this;

    public on (event: any, listener: (...args: any[]) => void): this {
        return super.on(event, listener);
    }

    public add_id (connection_id: string, pass = '', rig_id = '') {
        if (!this.m_ids.has(connection_id)) {
            this.m_ids.set(connection_id, { vardiff: new Vardiff(), rig_id: rig_id, pass: pass });
        }

        this.m_lasttouch = (new Date()).getTime();
    }

    public del_id (connection_id: string) {
        if (this.m_ids.has(connection_id)) {
            this.m_ids.delete(connection_id);
        }

        this.m_lasttouch = (new Date()).getTime();
    }

    public get_workers (): IWorker[] {
        const result: IWorker[] = [];

        for (const [id, info] of this.m_ids) {
            result.push({
                id: id,
                rig_id: info.rig_id,
                pass: info.pass,
                hashrate: info.vardiff.hashrate,
                difficulty: info.vardiff.last_target,
                next_difficulty: info.vardiff.target(false)
            });
        }

        return result;
    }

    public async get_job (job_id: string): Promise<IJob | undefined> {
        return this.m_jobs.get(job_id);
    }

    public async get_job_template (job_id: string): Promise<BlockTemplate | undefined> {
        const job = this.m_jobs.get(job_id);

        if (job === undefined) {
            return undefined;
        }

        const template = this.m_template;

        template.minerTransaction.poolNonce = BigInteger.zero;

        try {
            for (let i = 0; i < job.poolNonce; ++i) {
                template.block.minerTransaction.incrementPoolNonce();
            }
        } catch {}

        this.m_lasttouch = (new Date()).getTime();

        return template;
    }

    public async next_core_job (): Promise<IBlockTemplate> {
        const template = this.m_template;

        template.minerTransaction.poolNonce = BigInteger.zero;

        try {
            for (let i = 0; i < this.m_jobs.size; ++i) {
                template.block.minerTransaction.incrementPoolNonce();
            }
        } catch {}

        const block = await template.convert();

        const job: IJob = {
            id: '',
            job_id: uuid(),
            blob: await block.toHashingString(),
            target: difficulty_to_hex(template.difficulty).hex,
            height: template.height,
            poolNonce: this.m_jobs.size,
            difficulty: template.difficulty
        };

        job.id = job.job_id;

        this.m_jobs.set(job.job_id, job);

        this.m_lasttouch = (new Date()).getTime();

        return {
            difficulty: template.difficulty,
            height: template.height,
            reservedOffset: template.reservedOffset,
            blob: template.blockTemplate
        };
    }

    public async next_job (connection_id: string): Promise<IJob> {
        const info = this.m_ids.get(connection_id);

        let target_difficulty = Vardiff.default_difficulty;

        if (info !== undefined) {
            target_difficulty = info.vardiff.target();
        }

        const template = this.m_template;

        template.minerTransaction.poolNonce = BigInteger.zero;

        try {
            for (let i = 0; i < this.m_jobs.size; ++i) {
                template.block.minerTransaction.incrementPoolNonce();
            }
        } catch {}

        const block = await template.convert();

        const job: IJob = {
            id: '',
            job_id: uuid(),
            blob: await block.toHashingString(),
            target: difficulty_to_hex(target_difficulty).hex,
            height: template.height,
            poolNonce: this.m_jobs.size,
            difficulty: target_difficulty
        };

        job.id = job.job_id;

        this.m_jobs.set(job.job_id, job);

        this.m_lasttouch = (new Date()).getTime();

        return job;
    }

    public record_share (connection_id: string, difficulty: number) {
        const info = this.m_ids.get(connection_id);

        if (info === undefined) return;

        info.vardiff.insert(difficulty);
    }

    public async start (): Promise<void> {
        // set up our FIRST job
        this.m_monitor.once('update', async (template) => {
            this.m_template = await BlockTemplate.from(template);

            // when a new block is ready to be mined, all previous jobs are cleared
            this.m_jobs.clear();
        });

        this.m_monitor.start();

        while (this.m_template.height === 0) {
            await sleep(150);
        }

        // handle all subsequent jobs
        this.m_monitor.on('update', async (template) => {
            this.m_template = await BlockTemplate.from(template);

            Logger.debug('New block template received for block %s: %s with difficulty: %s',
                this.m_template.height, this.address, this.m_template.difficulty);

            // when a new block is ready to be mined, all previous jobs are cleared
            this.m_jobs.clear();

            for (const [id] of this.m_ids) {
                this.emit('job', id, await this.next_job(id));
            }
        });
    }

    public async force_job_refresh () {
        // when a new block is ready to be mined, all previous jobs are cleared
        this.m_jobs.clear();

        for (const [id] of this.m_ids) {
            this.emit('job', id, await this.next_job(id));
        }
    }

    public stop () {
        this.m_monitor.destroy();
    }

    public update_node (host = this.host, port = this.port, ssl = this.ssl, timeout = this.timeout) {
        this.m_host = host;

        this.m_port = port;

        this.m_ssl = ssl;

        this.m_timeout = timeout;

        this.m_node = this.update();

        this.m_monitor.update_node(host, port, ssl, timeout);
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
