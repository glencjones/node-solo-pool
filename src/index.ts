// Copyright (c) 2021, The TurtleCoin Developers
//
// Please see the included LICENSE file for more information.

import { Pool } from './pool';

(async () => {
    const pool = new Pool();

    await pool.start();
})();
