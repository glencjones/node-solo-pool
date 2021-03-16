// Copyright (c) 2021, The TurtleCoin Developers
//
// Please see the included LICENSE file for more information.

import { SQLite, Interfaces, prepareCreateTable, IDatabase } from 'db-abstraction';
import { Logger } from '@turtlepay/logger';

/** @ignore */
let database: IDatabase;

/** @ignore */
import IBulkQuery = Interfaces.IBulkQuery;

export class Database {
    public static async get_instance (): Promise<Database> {
        if (database) {
            return new Database();
        }

        Logger.info('Creating new database instance...');

        const db = new SQLite('blocks.db');

        db.on('error', error => Logger.error('[DB] %s', error.toString()));

        database = db;

        const obj = new Database();

        await obj.init();

        return obj;
    }

    protected async init (): Promise<void> {
        const stmts: IBulkQuery[] = [];

        // eslint-disable-next-line prefer-const
        let create: { table: string, indexes: string[]};

        const addQuery = () => {
            stmts.push({ query: create.table });

            create.indexes.map(index => stmts.push({ query: index }));
        };

        create = prepareCreateTable(database.type, 'blocks', [
            { name: 'address', type: database.hashType },
            { name: 'hash', type: database.hashType },
            { name: 'timestamp', type: database.uint64Type }
        ], ['address', 'hash', 'timestamp'], database.tableOptions);

        addQuery();

        return database.transaction(stmts);
    }

    public async add_block (address: string, hash: string, timestamp: number): Promise<void> {
        const stmts: IBulkQuery[] = [];

        stmts.push({
            query: 'INSERT INTO blocks (address, hash, timestamp) VALUES (?,?,?)',
            values: [address, hash, timestamp]
        });

        return database.transaction(stmts);
    }

    public async get_last_block (): Promise<{hash: string, timestamp: number, address: string}> {
        const [row_count, rows] = await database.query('SELECT * from blocks ORDER BY timestamp DESC LIMIT 1');

        if (row_count === 0) {
            return {
                hash: 'Never',
                timestamp: 0,
                address: 'Never'
            };
        }

        return rows[0];
    }

    public async get_last_blocks (count = 30): Promise<{hash: string, timestamp: number}[]> {
        const [, rows] = await database.query(
            'SELECT * from blocks ORDER BY timestamp DESC LIMIT ?', [count]);

        return rows.map(row => { return { hash: row.hash, timestamp: row.timestamp }; });
    }

    public async get_last_miner_block (address: string): Promise<{hash: string, timestamp: number, address: string}> {
        const [row_count, rows] = await database.query(
            'SELECT * from blocks WHERE address = ? ORDER BY timestamp DESC LIMIT 1', [address]);

        if (row_count === 0) {
            return {
                hash: 'Never',
                timestamp: 0,
                address: 'Never'
            };
        }

        return rows[0];
    }
}
