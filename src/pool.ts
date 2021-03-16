// Copyright (c) 2019-2021, The TurtleCoin Developers
//
// Please see the included LICENSE file for more information.

import { IJobSubmission, ILogin, StratumController } from './stratum_controller';
import { Address, BlockTemplate, Crypto, TurtleCoind } from 'turtlecoin-utils';
import { EventEmitter } from 'events';
import { Logger } from '@turtlepay/logger';
import { Miner } from './miner';
import * as Express from 'express';
import * as Helmet from 'helmet';
import * as BodyParser from 'body-parser';
import { Metronome } from 'node-metronome';
import * as dotenv from 'dotenv';
import { Database } from './database';

dotenv.config();

/** @ignore */
function envSSL (): boolean {
    if (!process.env.NODE_SSL) {
        return false;
    } else {
        return process.env.NODE_SSL === '1' || process.env.NODE_SSL === 'true';
    }
}

/** @ignore */
const default_node_host =
    (process.env.NODE_HOST && process.env.NODE_HOST.length !== 0)
        ? process.env.NODE_HOST
        : 'node.turtlepay.io';

/** @ignore */
const default_node_port =
    (process.env.NODE_PORT && parseInt(process.env.NODE_PORT))
        ? parseInt(process.env.NODE_PORT)
        : 443;

/** @ignore */
const default_node_ssl = (default_node_port === 443) ? true : envSSL();

/** @ignore */
const default_node_timeout =
    (process.env.NODE_TIMEOUT && parseInt(process.env.NODE_TIMEOUT))
        ? parseInt(process.env.NODE_TIMEOUT)
        : 5000;

/** @ignore */
const default_pool_ip =
    (process.env.POOL_BIND_IP && process.env.POOL_BIND_IP.length !== 0)
        ? process.env.POOL_BIND_IP
        : '0.0.0.0';

/** @ignore */
const default_pool_hostname =
    (process.env.POOL_HOSTNAME && process.env.POOL_HOSTNAME.length !== 0)
        ? process.env.POOL_HOSTNAME
        : 'solo.turtlecoin.dev';

/** @ignore */
const default_pool_port =
    (process.env.POOL_PORT && parseInt(process.env.POOL_PORT))
        ? parseInt(process.env.POOL_PORT)
        : 3333;

/** @ignore */
const default_api_port =
    (process.env.POOL_HTTP_PORT && parseInt(process.env.POOL_HTTP_PORT))
        ? parseInt(process.env.POOL_HTTP_PORT)
        : 80;

export class Pool extends EventEmitter {
    // [connection_id, address]
    private m_miner_ids: Map<string, string> = new Map<string, string>();

    // [address, Miner]
    private m_miners: Map<string, Miner> = new Map<string, Miner>();
    private m_crypto = new Crypto();
    private m_controller: StratumController;
    private m_app = Express();
    private m_daemon: TurtleCoind;
    private m_stale_miner_timer: Metronome;
    private m_db: Database = new Database();

    constructor (
        private node_host = default_node_host,
        private node_port = default_node_port,
        private node_ssl = default_node_ssl,
        private node_timeout = default_node_timeout,
        private pool_ip = default_pool_ip,
        private pool_port = default_pool_port
    ) {
        super();

        Logger.info('Starting pool server using node [%s:%s] SSL:%s',
            default_node_host, default_node_port, (default_node_ssl) ? 'ON' : 'OFF');

        this.m_stale_miner_timer = new Metronome(60 * 1000, true);

        this.m_stale_miner_timer.on('tick', async () => {
            const check_time = (new Date()).getTime();

            for (const [address, miner] of this.m_miners) {
                if ((check_time - miner.last_touch) > (120 * 1000)) {
                    Logger.warn('Expiring stale miner instance for: %s [%ss]',
                        address, Math.round((check_time - miner.last_touch) / 1000));

                    miner.stop();

                    this.m_miners.delete(address);
                }
            }
        });

        this.setup_http();

        this.m_daemon = new TurtleCoind(node_host, node_port, node_timeout, node_ssl);

        this.m_controller = new StratumController(pool_ip, pool_port);

        this.setup_controller();
    }

    public async start (): Promise<void> {
        await this.m_controller.start();

        this.m_db = await Database.get_instance();

        const start = async (): Promise<void> => {
            return new Promise((resolve) => {
                this.m_app.listen(default_api_port, this.pool_ip, () => {
                    Logger.info('HTTP server listening on %s:%s', this.pool_ip, default_api_port);

                    return resolve();
                });
            });
        };

        await start();
    }

    private async handle_disconnect (
        connection_id: string
    ): Promise<void> {
        // get the miner address by connection id
        const address = this.m_miner_ids.get(connection_id);

        // if we found their wallet address...
        if (address !== undefined) {
            const miner = this.m_miners.get(address);

            // if we found the miner
            if (miner !== undefined) {
                miner.del_id(connection_id);

                // if there are no more connections, destroy the monitor for that wallet
                if (miner.workers === 0) {
                    Logger.debug('Last miner for %s disconnected, deleting instance...', address);

                    miner.stop();

                    this.m_miners.delete(address);
                }
            }

            this.m_miner_ids.delete(connection_id);
        }

        Logger.info('Miner disconnected: %s', connection_id);
    }

    private async handle_getjob (
        connection_id: string,
        message_id: number
    ): Promise<void> {
        // get the miner address by connection id
        const address = this.m_miner_ids.get(connection_id);

        if (address === undefined) {
            return this.m_controller.error(
                connection_id, message_id, -1, 'Miner not logged in');
        }

        // go get the miner from the map
        const miner = this.m_miners.get(address);

        // if not found, that's a problem
        if (miner === undefined) {
            return this.m_controller.error(
                connection_id, message_id, -1, 'Miner not logged in');
        }

        // get the next miner job
        const job = await miner.next_job(connection_id);

        Logger.info('Miner %s send new job: %s', connection_id, job.job_id);

        // send it back
        return this.m_controller.job(connection_id, job);
    }

    private async create_miner (
        login: string,
        pass = ''
    ): Promise<void> {
        /**
         * If this is a new miner address that we haven't seen before then
         * there is additional setup that we have to do
         */
        if (!this.m_miners.has(login)) {
            let node_host = this.node_host;
            let node_port = this.node_port;
            let node_ssl = this.node_ssl;
            let node_timeout = this.node_timeout;

            // figure out if we have node information in the password field
            if (pass.length !== 0) {
                const parts = pass.split(';');

                for (const part of parts) {
                    const [key, value] = part.split('=', 2);

                    switch (key.toLowerCase()) {
                        case 'host':
                            node_host = value;
                            break;
                        case 'port':
                            node_port = parseInt(value);
                            break;
                        case 'ssl':
                            node_ssl = (value === 'true' || value === '1');
                            break;
                        case 'timeout':
                            node_timeout = parseInt(value);
                            break;
                    }
                }
            }

            if (node_timeout < 1000) {
                node_timeout = 1000;
            }

            // Setup the miner instance
            Logger.info('Creating miner instance for %s using node [%s:%s] SSL:%s',
                login, node_host, node_port, (node_ssl) ? 'ON' : 'OFF');

            const miner = new Miner(login, node_host, node_port, node_ssl, node_timeout);

            miner.on('job', async (id, job) =>
                await this.m_controller.job(id, job));

            // start the miner instance
            await miner.start();

            // add the miner to the Map
            this.m_miners.set(login, miner);

            Logger.info('New miner instance created for %s', login);
        }
    }

    private async handle_login (
        connection_id: string,
        message_id: number,
        payload: ILogin
    ): Promise<void> {
        await this.create_miner(payload.login, payload.pass);

        // go get the miner from the map
        const miner = this.m_miners.get(payload.login);

        // if not found, that's a problem
        if (miner === undefined) {
            return this.m_controller.login_rejected(connection_id, message_id);
        }

        // add this connection id to the miner instance
        miner.add_id(connection_id, payload.pass, payload.rigid);

        // add the connection id to the Map
        this.m_miner_ids.set(connection_id, payload.login);

        // get the next miner job
        const job = await miner.next_job(connection_id);

        Logger.info('New miner connected: %s', connection_id);

        // send it back
        return this.m_controller.login_accepted(connection_id, message_id, job, connection_id);
    }

    private async handle_submit (
        connection_id: string,
        message_id: number,
        payload: IJobSubmission
    ): Promise<void> {
        // get the miner address by connection id
        const address = this.m_miner_ids.get(connection_id);

        if (address === undefined) {
            return this.m_controller.share_rejected(
                connection_id, message_id, -1, 'Miner not logged in');
        }

        // go get the miner from the map
        const miner = this.m_miners.get(address);

        // if not found, that's a problem
        if (miner === undefined) {
            return this.m_controller.share_rejected(
                connection_id, message_id, -1, 'Miner not logged in');
        }

        // retrieve the job
        const job = await miner.get_job(payload.job_id);

        // get the job template
        const template = await miner.get_job_template(payload.job_id);

        if (template === undefined || job === undefined) {
            return this.m_controller.share_rejected(
                connection_id, message_id, -1, 'Job expired.');
        }

        // start to reconstruct the miner block
        const block = await template.convert();

        block.nonce = payload.nonce;

        // calculate the expected slow hash value
        const hash = await this.m_crypto.chukwa_slow_hash_v2(await block.toHashingString());

        // if they do not match, then the miner is trying to lie to us
        if (hash !== payload.result) {
            Logger.error('Miner %s submitted an invalid share', connection_id);

            return this.m_controller.share_rejected(connection_id, message_id, -1,
                'Invalid share detected. Check your algorithm and try again');
        }

        // check to verify that the hash meets the required difficulty
        if (BlockTemplate.hashMeetsDifficulty(hash, template.difficulty)) {
            // construct the final block from the template
            const final = await template.construct(payload.nonce);

            // get the block id
            const block_hash = await final.hash();

            Logger.warn('Miner %s found block [%s] meeting %s difficulty for block %s',
                connection_id, block_hash, template.difficulty, template.height);

            try {
                const rawblock = await final.toString();

                Logger.debug('Submitting raw block to node: %s', rawblock);

                const result = await miner.node.submitBlock(rawblock);

                if (result === block_hash) {
                    await this.m_db.add_block(
                        miner.address, block_hash, Math.round(final.timestamp.getTime() / 1000));

                    Logger.info('Block accepted by node: %s', block_hash);
                } else {
                    Logger.error('Block rejected by node: %s', block_hash);

                    await miner.force_job_refresh();
                }
            } catch (e) {
                Logger.error('Error submitting block to node: %s => %s', block_hash, e.toString());

                await miner.force_job_refresh();
            }
        }

        Logger.debug('Miner %s submitted valid share of %s difficulty for block %s',
            connection_id, job.difficulty, template.height);

        miner.record_share(connection_id, job.difficulty);

        return this.m_controller.share_accepted(connection_id, message_id);
    }

    private setup_controller () {
        this.m_controller.on('error',
            (error) =>
                Logger.debug('Server encountered an error: %s',
                    error.toString()));

        this.m_controller.on('listening', server =>
            Logger.info('Server listening on: %s:%s',
                server.address, server.port));

        this.m_controller.on('connection',
            async (id, remote) => {
                await this.m_controller.accept(id);

                Logger.info('New connection from [%s:%s]: %s',
                    remote.address, remote.port, id);
            });

        this.m_controller.on('close',
            async (id) =>
                await this.handle_disconnect(id));

        this.m_controller.on('login',
            async (id, msg_id, data) =>
                await this.handle_login(id, msg_id, data));

        this.m_controller.on('getjob',
            async (id, msg_id) =>
                await this.handle_getjob(id, msg_id));

        this.m_controller.on('keepalive',
            async (id, msg_id) =>
                await this.m_controller.keepalive(id, msg_id));

        this.m_controller.on('submit',
            async (id, msg_id, data) =>
                await this.handle_submit(id, msg_id, data));
    }

    private setup_http () {
        this.m_app.use(BodyParser.json());

        this.m_app.use((
            error: Error,
            request: Express.Request,
            response: Express.Response,
            next: Express.NextFunction
        ) => {
            if (error instanceof SyntaxError) {
                return response.sendStatus(400).send();
            }
            next();
        });

        this.m_app.use((
            request: Express.Request,
            response: Express.Response,
            next: Express.NextFunction
        ) => {
            response.header('X-Requested-With',
                '*');
            response.header('Access-Control-Allow-Origin', '*');
            response.header('Access-Control-Allow-Headers',
                'Origin, X-Requested-With, Content-Type, Accept, User-Agent');
            response.header('Access-Control-Allow-Methods',
                'PATCH, POST, PUT, DELETE, GET, OPTIONS');
            response.header('Cache-Control',
                'max-age=30, public');
            response.header('Referrer-Policy',
                'no-referrer');
            response.header('Content-Security-Policy',
                'default-src \'none\'');
            response.header('Feature-Policy',
                'geolocation none;midi none;notifications none;push none;sync-xhr none;microphone none;' +
                'camera none;magnetometer none;gyroscope none;speaker self;vibrate none;fullscreen self;' +
                'payment none;');
            response.header('Permissions-Policy', 'geolocation=(), midi=(), notifications=(), push=(), ' +
                'sync-xhr=(), microphone=(), camera=(), magnetometer=(), gyroscope=(), speaker=(self), vibrate=(), ' +
                'fullscreen=(self), payment=()');

            next();
        });

        this.m_app.use(Helmet());

        /*
        this.m_app.use((
            request: Express.Request,
            response: Express.Response,
            next: Express.NextFunction
        ) => {
            Logger.warn('[%s] %s %s',
                request.header('x-forwarded-for') || request.ip,
                request.method,
                request.url);

            next();
        });
        */

        /**
         * These HTTP methods support using the core miner software
         */

        this.m_app.post('/block', async (
            request: Express.Request,
            response: Express.Response
        ) => {
            try {
                const result = await this.m_daemon.submitBlock(request.body);

                const template = await BlockTemplate.from(request.body);

                await this.m_db.add_block(
                    'HTTP', await template.block.hash(), Math.round(template.block.timestamp.getTime() / 1000));

                return response.status(202)
                    .json(result);
            } catch {
                return response.status(501)
                    .send();
            }
        });

        this.m_app.get('/block/last', async (
            request: Express.Request,
            response: Express.Response
        ) => {
            try {
                return response.status(200)
                    .json(await this.m_daemon.lastBlock());
            } catch {
                return response.status(501)
                    .send();
            }
        });

        this.m_app.post('/block/template', async (
            request: Express.Request,
            response: Express.Response
        ) => {
            const address = request.body.address || '';

            try {
                await Address.fromAddress(address);
            } catch {
                return response.status(400)
                    .send();
            }

            await this.create_miner(request.body.address);

            const miner = this.m_miners.get(request.body.address);

            if (miner === undefined) {
                return response.status(404)
                    .send();
            }

            return response.status(201)
                .json(await miner.next_core_job());
        });

        this.m_app.get('/stats', async (
            request: Express.Request,
            response: Express.Response
        ) => {
            try {
                const info = await this.m_daemon.info();

                const block = await this.m_daemon.lastBlock();

                let miners = 0;

                let hashrate = 0;

                for (const [, miner] of this.m_miners) {
                    miners += miner.workers;

                    hashrate += miner.hashrate;
                }

                const last_block = await this.m_db.get_last_block();

                return response.json({
                    height: info.height,
                    hashrate: hashrate,
                    miners: miners,
                    fee: 0,
                    minPayout: block.baseReward,
                    lastBlock: last_block.timestamp,
                    lastBlockHash: last_block.hash,
                    donation: 0,
                    hostname: default_pool_hostname,
                    port: default_pool_port,
                    difficulty: info.difficulty,
                    node: {
                        host: this.node_host,
                        port: this.node_port,
                        ssl: this.node_ssl,
                        timeout: this.node_timeout
                    }
                });
            } catch {
                return response.status(501)
                    .send();
            }
        });

        this.m_app.get('/stats/blocks', async (
            request: Express.Request,
            response: Express.Response
        ) => {
            try {
                return response.json(await this.m_db.get_last_blocks());
            } catch {
                return response.status(501).send();
            }
        });

        this.m_app.get('/stats/:address', async (
            request: Express.Request,
            response: Express.Response
        ) => {
            if (!request.params.address) {
                return response.status(400).send();
            }

            const miner = this.m_miners.get(request.params.address);

            if (miner === undefined) {
                return response.status(404).send();
            }

            const miner_last_block = await this.m_db.get_last_miner_block(miner.address);

            return response.json({
                address: miner.address,
                workers: miner.workers,
                hashrate: miner.hashrate,
                last_block: miner_last_block.timestamp,
                last_block_hash: miner_last_block.hash,
                node: {
                    host: miner.host,
                    port: miner.port,
                    ssl: miner.ssl,
                    timeout: miner.timeout
                }
            });
        });

        this.m_app.get('/stats/:address/workers', async (
            request: Express.Request,
            response: Express.Response
        ) => {
            if (!request.params.address) {
                return response.status(400).send();
            }

            const miner = this.m_miners.get(request.params.address);

            if (miner === undefined) {
                return response.status(404).send();
            }

            return response.json(miner.get_workers());
        });

        this.m_app.post('/:address', async (
            request: Express.Request,
            response: Express.Response
        ) => {
            if (!request.params.address) {
                return response.status(400).send();
            }

            const miner = this.m_miners.get(request.params.address);

            if (miner === undefined) {
                return response.status(404).send();
            }

            if (!request.body) {
                return response.status(400).send();
            }

            const host = (request.body.host && request.body.host.length !== 0) ? request.body.host : undefined;
            const port = (request.body.port) ? request.body.port : undefined;
            const ssl = (typeof request.body.ssl !== undefined) ? request.body.ssl : undefined;
            const timeout = (request.body.timeout) ? request.body.timeout : undefined;

            const pre_host = miner.host;
            const pre_port = miner.port;
            const pre_ssl = miner.ssl;
            const pre_timeout = miner.timeout;

            try {
                if (host) {
                    miner.host = host;
                }

                if (port) {
                    miner.port = port;
                }

                if (ssl) {
                    miner.ssl = ssl;
                }

                if (timeout) {
                    miner.timeout = timeout;
                }

                return response.status(202).send();
            } catch {
                miner.host = pre_host;

                miner.port = pre_port;

                miner.ssl = pre_ssl;

                miner.timeout = pre_timeout;

                return response.status(417).send();
            }
        });

        this.m_app.options('*', async (
            request: Express.Request,
            response: Express.Response
        ) => {
            return response.status(200).send();
        });

        this.m_app.all('*', async (
            request: Express.Request,
            response: Express.Response
        ) => {
            return response.status(404).send();
        });
    }
}
