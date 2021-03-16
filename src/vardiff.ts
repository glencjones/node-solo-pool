// Copyright (c) 2019-2021, The TurtleCoin Developers
//
// Please see the included LICENSE file for more information.

import { PerformanceTimer } from './performance_timer';
import * as dotenv from 'dotenv';

dotenv.config();

/** @ignore */
interface IDifficultySample {
    elapsed: number;
    difficulty: number;
}

/** @ignore */
const default_starting_difficulty =
    (process.env.POOL_DEFAULT_DIFFICULTY && parseInt(process.env.POOL_DEFAULT_DIFFICULTY))
        ? parseInt(process.env.POOL_DEFAULT_DIFFICULTY)
        : 10000;

export class Vardiff {
    private m_samples: IDifficultySample[] = [];
    private m_timer = new PerformanceTimer();
    private m_last_diff = default_starting_difficulty;

    public static get default_difficulty (): number {
        return default_starting_difficulty;
    }

    public get hashrate (): number {
        if (this.m_samples.length === 0) {
            return 0;
        }

        let total_ms = 0;
        let total_difficulty = 0;

        for (const sample of this.m_samples) {
            total_ms += sample.elapsed;

            total_difficulty += sample.difficulty;
        }

        return Math.round((total_difficulty / total_ms) * 1000);
    }

    public get last_target (): number {
        return this.m_last_diff;
    }

    public target (update = true): number {
        const hashrate = this.hashrate;

        if (hashrate === 0) {
            return this.m_last_diff;
        }

        let new_target = hashrate * 5;

        const max_target = Math.round(this.m_last_diff * 5);

        const min_target = Math.round(this.m_last_diff * 0.5);

        if (new_target > max_target) {
            new_target = max_target;
        } else if (new_target < min_target) {
            new_target = min_target;
        }

        if (update) {
            this.m_last_diff = new_target;
        }

        return new_target;
    }

    public insert (difficulty: number) {
        this.m_samples.push({
            elapsed: this.m_timer.mark.milliseconds,
            difficulty: difficulty
        });

        while (this.m_samples.length > 100) {
            this.m_samples.shift();
        }
    }
}
