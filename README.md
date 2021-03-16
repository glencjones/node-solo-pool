![image](https://user-images.githubusercontent.com/34389545/35821974-62e0e25c-0a70-11e8-87dd-2cfffeb6ed47.png)

# TurtleCoin: Solo Mining Pool

![Prerequisite](https://img.shields.io/badge/node-%3E%3D12-blue.svg) [![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://github.com/turtlecoin/node-solo-pool/graphs/commit-activity) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/turtlecoin/node-solo-pool/blob/master/LICENSE) [![Twitter: _TurtleCoin](https://img.shields.io/twitter/follow/_TurtleCoin.svg?style=social)](https://twitter.com/_TurtleCoin)

## Overview

This package is designed for operating a solo mining pool that only support solo mining. By doing so, miners can utilize CPU/GPU mining software beyond the core suite mining software. The work provided to each miner is specific to the wallet address (login) they provide when they connect to the pool and rewards are sent directly to the miners via the block coinbase (miner) transaction. There is no middle man.

***This is not a PPS or PPLNS pool***

## Features

* Single pool port w/ single starting difficulty
* Pool calculates variable difficulty
  * Shares are not recorded and are only used to keep the connection alive and maintain a reasonable difficulty for the miner
* Keeps track of solo mined blocks
* Blocktemplates are independent for each miner wallet address (login)
* Miners can connect multiple workers and all work on the same blocktemplate (job)
* Miners can select and/or specify what node they want to use for mining via options in the password field of the mining software
  * host=<hostname>
  * port=<port>
  * ssl=<ssl> (use 1 or true to enable; or 0 or false to disable)
  * timeout=<timeout> (in milliseconds, 1000 minimum)
  * To combine multiple options, separate them by a semicolon `;`
    * Example: `node=node.turtlepay.io;port=443;ssl=true;timeout=5000`
* Built in webserver with REST API for statistics and dynamic updating of miner node used
    
## Requirements

* [Node.js](https://nodejs.org) >= +12.x LTS (or Node v12)
* Compiler supporting C++17 (gcc/clang/etc)

## Installation / Setup

### From Source

```bash
git clone https://github.com/turtlecoin/node-solo-pool
cd node-solo-pool
yarn
yarn start
```

### From NPM

```bash
npm install -g @turtlecoin/solo-pool
solo-pool
```

## Configuration

All configuration is accomplished via environment parameters; or, optionally a `.env` file for the same.

**Note:** Default values are provided below

```bash
export POOL_HOSTNAME=solo.turtlecoin.dev
export POOL_BIND_IP=0.0.0.0
export POOL_PORT=3333
export POOL_DEFAULT_DIFFICULTY=10000
export POOL_HTTP_PORT=80
export NODE_SSL=1
export NODE_HOST=node.turtlepay.io
export NODE_PORT=443
export NODE_SSL=1
export NODE_TIMEOUT=5000
```

## Thanks
The TurtleCoin Community
