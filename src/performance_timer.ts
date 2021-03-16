// Copyright (c) 2019-2021, The TurtleCoin Developers
//
// Please see the included LICENSE file for more information.

import { performance } from 'perf_hooks';

/** @ignore */
export class PerformanceTimer {
    private readonly m_start = performance.now();
    private m_last = 0;

    /**
     * Returns the elapsed time since the instance was created
     */
    public get elapsed (): { milliseconds: number, seconds: number } {
        const delta = Math.round(performance.now() - this.m_start);

        return {
            milliseconds: delta,
            seconds: parseFloat((delta / 1000).toFixed(2))
        };
    }

    public get mark (): { milliseconds: number, seconds: number } {
        let delta = 0;
        const now = performance.now();

        if (this.m_last !== 0) {
            delta = Math.round(now - this.m_last);
        } else {
            delta = Math.round(now - this.m_start);
        }

        this.m_last = now;

        return {
            milliseconds: delta,
            seconds: parseFloat((delta / 1000).toFixed(2))
        };
    }
}
