// Copyright (c) 2019-2021, The TurtleCoin Developers
//
// Please see the included LICENSE file for more information.

import * as BigInteger from 'bignum';

export interface IDifficultyTarget {
    target: number;
    hex: string;
}

class WrappedBuffer {
    public buffer: Buffer = Buffer.alloc(0);

    constructor (size: number, fill: number) {
        this.buffer = Buffer.alloc(size, fill);
    }

    public get length (): number {
        return this.buffer.length;
    }

    public static alloc (size: number, fill: number): WrappedBuffer {
        return new WrappedBuffer(size, fill);
    }

    public toByteArray (): number[] {
        const arr = [];

        for (let i = 0; i < this.buffer.length; i++) {
            arr.push(this.buffer[i]);
        }

        return arr;
    }

    public slice (start: number, end: number): WrappedBuffer {
        const wb = new WrappedBuffer(0, 0);

        wb.buffer = this.buffer.slice(start, end);

        return wb;
    }
}

export function difficulty_to_hex (difficulty: number): IDifficultyTarget {
    const padded = WrappedBuffer.alloc(32, 0);

    const base_diff_buffer = new BigInteger('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', 16)
        .div(difficulty)
        .toBuffer();

    base_diff_buffer.copy(padded.buffer, padded.length - base_diff_buffer.length);

    const buff_reversed = Buffer.from(padded.slice(0, 4).toByteArray().reverse());

    return {
        target: buff_reversed.readUInt32BE(0),
        hex: buff_reversed.toString('hex')
    };
}
