# jornet <sub><sup>| Suffer Smarter </sup></sub>

--------------------------------------------------------------------------------

[![version](http://img.shields.io/badge/version-v0.0.1-blue.svg)](#) [![versioning](http://img.shields.io/badge/versioning-semver-blue.svg)](http://semver.org/) [![branching](http://img.shields.io/badge/branching-github%20flow-blue.svg)](https://guides.github.com/introduction/flow/)
[![Circle CI](https://circleci.com/gh/cairn-software/jornet.svg?style=shield)](https://circleci.com/gh/cairn-software/jornet)


## Overview
Cairn.

## Installation
If you don't have `node` and `npm` installed, do [that](https://docs.npmjs.com/getting-started/installing-node) first.

> __PROTIP:__ `node` version must  be >= `v6.3.0`

```bash
# Install all necessary npm packages:
$ npm install
```

Next, if you don't already have postgres installed locally, you will need to do that.  Once you have postgres up and running, do the following:

```bash
$ psql postgres
=# create user jornet with password 'jornetdb';
=# create database jornet;
=# grant all privileges on database jornet to jornet;
```

To point the `jornet` app at this postgres instance, set the following environment variables:

```bash
export JORNET_DB_HOST=localhost
export JORNET_DB_PORT=5432
export JORNET_DB_USER=jornet
export JORNET_DB_PASSWORD=jornetdb
```

## Configuration
You will need to create a `private.key` file that goes in your jornet root folder, with the private key you want to use. This private key will be used to sign authentication requests using JWT.

To run `jornet`, you will need to set the following environment variables.

```bash
export JORNET_GOOGLE_MAPS_KEY=
export JORNET_STRAVA_CLIENT_SECRET=
export JORNET_STRAVA_CLIENT_ID=
export JORNET_REDIRECT_URL=http://localhost:7347/login
```

## Running
```bash
# Fire that bad boy up:
$ npm start
```

## Deploying
Make sure the following environment variables are set to the proper production values:
```bash
export JORNET_DB_HOST=
export JORNET_DB_PORT=
export JORNET_DB_USER=
export JORNET_DB_PASSWORD=
export JORNET_REDIRECT_URL=
```

Build the production artifacts:
```bash
npm run build:prod
```
> Make sure to run this from the same terminal window where you set the above environment variables

Run `dbdeploy` against the prod database:
```bash
npm run dbdeploy
```
> Make sure to run this from the same terminal window where you set the above environment variables

Stop the prod app server by `ssh`'ing to it and running the stop command:
```bash
npm run stop:prod
```

Run the deploy script to deploy the latest artifacts that were just built:
```bash
./bin/deploy.sh /path/to/jornet
```

Start the prod app server node process by `ssh`'ing to it and running the start command:
```bash
npm run start:prod
```
