<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="src/lib/assets/bebop-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="src/lib/assets/bebop-light.svg">
    <img alt="be-BOP" src="src/lib/assets/bebop-light.svg" width="140">
  </picture>
</p>

<h1 align="center">be-BOP</h1>

be-BOP is a free and open-source, peer-to-peer monetization platform built for
communities and creators. It brings e-commerce, point-of-sale (PoS),
subscriptions, crowdfunding/peerfunding, ticketing, donations, and
pay-what-you-want models together under one roof — with first-class Bitcoin and
Lightning support.

> 🚀 **New here?** Follow the official [DIY quick start guide](https://be-bop.io/get-started-diy)
> to stand up your own be-BOP instance step by step.

## Features

- **E-commerce & PoS** — sell physical or digital products online and in person
- **Subscriptions** — recurring memberships and plans
- **Crowdfunding / peerfunding** — fund projects and goals
- **Ticketing** — sell and validate event tickets
- **Donations & pay-what-you-want** — flexible, customer-set pricing
- **Bitcoin & Lightning native** — accept BTC on-chain and over Lightning,
  nodeless with `phoenixd` or by connecting your own node

## Table of contents

- [Requirements](#requirements)
- [Quick start (local development)](#quick-start-local-development)
  - [Option A: Cloud services (minimal setup)](#option-a-cloud-services-minimal-setup)
  - [Option B: Docker Compose (fully local)](#option-b-docker-compose-fully-local)
- [Configuration](#configuration)
  - [Core](#core)
  - [S3 object storage](#s3-object-storage)
  - [Email (SMTP)](#email-smtp)
  - [Bitcoin & Lightning](#bitcoin--lightning)
  - [SSO sign-in](#sso-sign-in)
- [Production](#production)
  - [Running](#running)
  - [Docker](#docker)
  - [Docker Compose](#docker-compose)
- [Operations](#operations)
  - [Reverse proxy](#reverse-proxy)
  - [Maintenance mode](#maintenance-mode)
  - [Copying DB & S3 to another instance](#copying-db--s3-to-another-instance)
- [Analytics (Plausible)](#analytics-plausible)

## Requirements

- **Node.js 18+**, with corepack enabled: `corepack enable`
- **pnpm** (enabled via corepack — you may need `sudo corepack enable`)
- **Git LFS**, installed with `git lfs install`
- A **MongoDB replica set** — run it in Docker or use [MongoDB Atlas](https://www.mongodb.com/atlas/database)
- An **S3-compatible object storage** — [MinIO](https://min.io/) (open source, runs in Docker), or a paid service like AWS or Scaleway. be-BOP configures the bucket to accept CORS `PUT` calls automatically.
- **SMTP credentials**, for sending emails
- A **Bitcoin node and lnd** — optional; you can go nodeless with `phoenixd` directly from the UI

## Quick start (local development)

> Deploying a real instance? Start with the [DIY quick start guide](https://be-bop.io/get-started-diy).

```bash
pnpm install
pnpm dev
```

be-BOP still needs a MongoDB replica set and an S3-compatible object storage.
Pick one of the two setups below, add the variables to a `.env.local` file,
then run `pnpm dev`.

### Option A: Cloud services (minimal setup)

The fastest way to get started — use cloud-hosted MongoDB, and either a cloud S3
or a single local MinIO container:

1. **MongoDB:** Get a free tier on [MongoDB Atlas](https://www.mongodb.com/atlas/database). A free M0 cluster is more than enough for development.
2. **S3-compatible storage** — pick one:
   - **Quickest local option:** Run a single MinIO container (see below) — this is the only Docker container you'll need
   - [AWS S3](https://aws.amazon.com/s3/) free tier
   - [Scaleway Object Storage](https://www.scaleway.com/en/object-storage/) free tier
   - Or any other S3-compatible service

To run MinIO locally:

```bash
mkdir -p ${HOME}/minio/data

docker run -d \
   -p 9000:9000 \
   -p 9090:9090 \
   --name minio \
   -e "MINIO_ROOT_USER=ROOTUSER" \
   -e "MINIO_ROOT_PASSWORD=CHANGEME123" \
   -v ${HOME}/minio/data:/data \
   quay.io/minio/minio server /data --console-address ":9090"
```

MinIO console will be available at http://127.0.0.1:9090. The S3 bucket will be
created automatically by be-BOP on first run.

Add to your `.env.local`:

```bash
# MongoDB Atlas
MONGODB_URL="mongodb+srv://<user>:<password>@<cluster>.mongodb.net/..."
MONGODB_DB="bebop"

# Your app URL
ORIGIN="http://localhost:5173"

# MinIO (local) — or replace with your cloud S3 credentials
S3_BUCKET="bebop"
S3_ENDPOINT_URL="http://127.0.0.1:9000"
PUBLIC_S3_ENDPOINT_URL="http://127.0.0.1:9000"
S3_REGION="localhost"
S3_KEY_ID="ROOTUSER"
S3_KEY_SECRET="CHANGEME123"

# Mock emails in development
SMTP_FAKE="true"
```

Run `pnpm dev` and you're ready to go.

### Option B: Docker Compose (fully local)

Run both MongoDB and MinIO locally using Docker Compose — no cloud accounts needed:

```bash
docker compose -f docker-compose.dev.yml up -d
```

This starts a MongoDB replica set (port 27017) and MinIO (ports 9000, 9090).
There is no be-BOP container — you run the app with `pnpm dev`.

Add to your `.env.local`:

```bash
MONGODB_URL=mongodb://localhost:27017
MONGODB_DIRECT_CONNECTION=true
MONGODB_DB="bebop"
ORIGIN="http://localhost:5173"
S3_BUCKET="bebop"
S3_ENDPOINT_URL="http://localhost:9000"
PUBLIC_S3_ENDPOINT_URL="http://localhost:9000"
S3_REGION="localhost"
S3_KEY_ID="minio"
S3_KEY_SECRET="minio123"
SMTP_FAKE="true"
```

> **Note:** `MONGODB_DIRECT_CONNECTION=true` is required when connecting to a
> MongoDB replica set running inside Docker from the host machine.

Helper commands:

```bash
docker compose -f docker-compose.dev.yml ps        # See running containers
docker compose -f docker-compose.dev.yml logs -f   # View logs
docker compose -f docker-compose.dev.yml down      # Stop containers
```

To add personal services like [mongo-express](https://github.com/mongo-express/mongo-express)
or [mailhog](https://github.com/mailhog/MailHog), you can either add them
directly to your local `docker-compose.dev.yml` (changes will show in
`git diff`), or create a separate `docker-compose.override.yml` (gitignored) and
run both with:

```bash
docker compose -f docker-compose.dev.yml -f docker-compose.override.yml up -d
```

## Configuration

Add a `.env.local` (or `.env.{development,test,production}.local`) file for
secrets that should not be committed to git; these override the values in
`.env`.

### Core

| Variable               | Description                                                                                                                                                                                                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URL`          | The connection URL to the MongoDB replica set                                                                                                                                                                                                                                                         |
| `MONGODB_DB`           | The DB name, defaulting to `bebop`                                                                                                                                                                                                                                                                    |
| `ORIGIN`               | The URL where be-BOP will be deployed, e.g. `https://dev-bootik.pvh-labs.ch`                                                                                                                                                                                                                          |
| `NOSTR_PRIVATE_KEY`    | Private key used to send Nostr notifications                                                                                                                                                                                                                                                          |
| `LINK_PRELOAD_HEADERS` | Set to `true` to enable the `Link rel=preload` header ([explanation](https://nitropack.io/blog/post/link-rel-preload-explained)). If you do, you may need to raise nginx's `proxy_buffer_size 16k` ([explanation](https://www.getpagespeed.com/server-setup/nginx/tuning-proxy_buffer_size-in-nginx)) |

### S3 object storage

be-BOP automatically configures the S3 bucket to accept CORS `PUT` calls.

| Variable                 | Description                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `S3_BUCKET`              | The bucket name for the S3-compatible object storage                                           |
| `S3_ENDPOINT_URL`        | The endpoint, e.g. `http://s3.fr-par.scw.cloud` or `http://s3-website.us-east-1.amazonaws.com` |
| `PUBLIC_S3_ENDPOINT_URL` | Public-facing endpoint used to build browser-visible asset URLs                                |
| `S3_KEY_ID`              | Access key credential                                                                          |
| `S3_KEY_SECRET`          | Secret key credential                                                                          |
| `S3_REGION`              | Region of the S3-compatible object storage                                                     |

### Email (SMTP)

| Variable        | Description                                                                      |
| --------------- | -------------------------------------------------------------------------------- |
| `SMTP_HOST`     | SMTP server host — set all four `SMTP_*` variables to enable email notifications |
| `SMTP_PORT`     | SMTP server port                                                                 |
| `SMTP_USER`     | SMTP username                                                                    |
| `SMTP_PASSWORD` | SMTP password                                                                    |
| `SMTP_FROM`     | Optional sender address, defaults to `SMTP_USER`                                 |
| `SMTP_FAKE`     | Set to `true` to mock emails in development                                      |

### Bitcoin & Lightning

> 🚨 You can use `phoenixd` for Lightning and Bitcoin **nodeless directly from
> the UI**, without setting up any of these variables.

- `BITCOIN_RPC_URL` - The RPC url for the bitcoin node. Set to http://127.0.0.1:8332 if you run a bitcoin node locally with default configuration
- `BITCOIN_RPC_USER` - The RPC user
- `BITCOIN_RPC_PASSWORD` - The RPC password
- `BIP84_XPUB` - with derivation path m/84'/0'/0'. If you have a ZPub, use https://jlopp.github.io/xpub-converter/ to convert to xpub. This enables a completely trustless setup, where the be-BOP server does not need to know the private key. You can generate the xpub from the sparrow wallet, for example.
- `LND_REST_URL` - The LND Rest interface URL. Set to http://127.0.0.1:8080 if you run a lnd node locally with default configuration
- `LND_MACAROON_PATH` - Where the credentials for lnd are located. For example, `~/.lnd/data/chain/bitcoin/mainnet/admin.macaroon`. Leave empty if lnd runs with `--no-macaroons`, or if you're using `LND_MACAROON_VALUE`. You can use `invoices.macaroon` instead of `admin.macaroon`, but then the admin LND page in the be-BOP will not work. Orders should work fine.
- `LND_MACAROON_VALUE` - Upper-case hex-encoded representation of the LND macaroon. Leave empty if lnd runs with `--no-macaroons`, or if you're using `LND_MACAROON_PATH`. Example command: `cat .lnd/data/chain/bitcoin/mainnet/admin.macaroon | hexdump -e '16/1 "%02X"'`. You can use `invoices.macaroon` instead of `admin.macaroon`, but then the admin LND page in the be-BOP will not work. Orders should work fine.
- `TOR_PROXY_URL` - Url of the SOCKS5 proxy used to access TOR. If set, and the hostname for `BITCOIN_RPC_URL` is a `.onion` address, the app will use the proxy to access the bitcoin node. In the same manner, if `LND_REST_URL` is a `.onion` address, TOR will be used to access the lightning node.

### SSO sign-in

Set the following variables to allow SSO. On each provider's website, set the
redirect URL to `https://<...>/api/callback/<provider>`, where `<provider>` is
one of `github`, `google`, `facebook`, or `twitter`:

| Provider | Variables                        |
| -------- | -------------------------------- |
| GitHub   | `GITHUB_ID`, `GITHUB_SECRET`     |
| Google   | `GOOGLE_ID`, `GOOGLE_SECRET`     |
| Facebook | `FACEBOOK_ID`, `FACEBOOK_SECRET` |
| Twitter  | `TWITTER_ID`, `TWITTER_SECRET`   |

## Production

### Running

```shell
pnpm run build
node --enable-source-maps build/index.js

# If behind a reverse proxy, you can use the following config:
# ADDRESS_HEADER=X-Forwarded-For XFF_DEPTH=1 node build/index.js
```

You can set the `PORT` environment variable to change from the default port 3000
to another port.

You can also use [pm2](https://pm2.keymetrics.io/docs/usage/quick-start/) to
manage your node application, and run it on multiple cores.

```shell
NODE_OPTIONS=--enable-source-maps pm2 start --name bebop --update-env build/index.js

# If behind a reverse proxy, you can use the following config:
# NODE_OPTIONS=--enable-source-maps ADDRESS_HEADER=X-Forwarded-For XFF_DEPTH=1 pm2 start --name bebop --update-env build/index.js
```

> **Note:** for uploading large payloads you may want to set
> `BODY_SIZE_LIMIT=20000000` to allow 20 MB payloads, for example. It should not
> be needed for normal usage.

### Docker

Build the docker image:

```shell
docker build -t bebop .
```

Run the docker image with environment variables:

```shell
export DOTENV_LOCAL=$(cat .env.local)
docker run -p 3000:3000 --env DOTENV_LOCAL=$DOTENV_LOCAL bebop --add-host=host.docker.internal:host-gateway
```

or

```shell
# Be careful, double-quotes surrounding values in .env.local will not be ignored
docker run -p 3000:3000 --env-file .env.local bebop --add-host=host.docker.internal:host-gateway
```

> **Accessing a local node from Docker:** to reach a local BTC or LND node from
> inside a container, use `host.docker.internal` as the hostname instead of
> `localhost`, e.g. `BITCOIN_RPC_URL=http://host.docker.internal:8332`.

### Docker Compose

Docker Compose is used for local development, but you can also use it for
production. It launches a MongoDB and a MinIO container.

#### Required configuration

Edit `.env.local` to add an S3 access key and secret if not already present, for
example:

```console
echo "S3_KEY_ID=$(openssl rand -base64 63 | tr -d '\n')" >> .env.local
echo "S3_KEY_SECRET=$(openssl rand -base64 63 | tr -d '\n')" >> .env.local
```

Make sure to have a fairly recent version of docker & docker compose.

#### Start the containers

```shell
# Optional: update dependencies
docker compose pull
# --build will rebuild the docker image when you change the code. Use --force-recreate to force a rebuild (eg after updating dependencies).
docker compose --env-file .env.local up --build -d
```

It will still use the `.env.local` file for the environment variables if
present, overriding the values for MongoDB and S3.

MinIO will be available on http://localhost:9000 and be-BOP on
http://localhost:3000.

Some helper commands:

```bash
docker compose ps              # See the containers
docker compose logs bebop -f   # Get the logs
docker compose exec bebop sh   # Enter the container
docker compose down            # Stop the containers
```

#### Other configuration

See [Configuration](#configuration) for the other environment variables you can
set in `.env.local`, including the SMTP credentials.

If you run in production, set the `ORIGIN` environment variable to the URL of
your be-BOP instance, and the object storage (MinIO) URL:

```env
# .env.local - replace with your values
ORIGIN=https://bebop.example.com
S3_ENDPOINT_URL=https://minio.bebop.example.com
```

To reach a local BTC or LND node, use `host.docker.internal` as the hostname
instead of `localhost` (see [Docker](#docker) above).

## Operations

### Reverse proxy

When placing be-BOP behind a reverse proxy such as nginx, set `ADDRESS_HEADER`
to `X-Forwarded-For` and `XFF_DEPTH` to `1` (or the appropriate value for your
configuration) in the environment so that be-BOP correctly resolves your users'
IP addresses. This also applies to [maintenance mode](#maintenance-mode).

### Maintenance mode

Maintenance mode can be enabled in the admin. It relies on correct client IP
resolution — if you are behind a reverse proxy, make sure you have configured it
as described in [Reverse proxy](#reverse-proxy).

### Copying DB & S3 to another instance

You can run the following command to copy the DB and S3 to another instance:

```shell
export OLD_DB_URL="..."
export OLD_DB_NAME="..."

export NEW_DB_URL="..."
export NEW_DB_NAME="..."

export OLD_S3_ENDPOINT="..."
export OLD_S3_BUCKET="..."
export OLD_S3_REGION="..."
export OLD_S3_KEY="..."
export OLD_S3_SECRET="..."

export NEW_S3_BUCKET="..."
export NEW_S3_REGION="..."
export NEW_S3_KEY="..."
export NEW_S3_SECRET="..."
export NEW_S3_ENDPOINT="..."

pnpm run copy-db-s3
```

## Analytics (Plausible)

Self-host Plausible by following the [official guide](https://plausible.io/docs/self-hosting).

Then go to the config page at `/admin/config` and paste your Plausible URL into
the plausible input, for example:

```
https://plausible.your-domain.com/js/script.js
```

To enable **emails** in Plausible (for example, to support multiple users), you
need to [configure SMTP with environment variables](https://plausible.io/docs/self-hosting-configuration#mailersmtp-setup)
and set `DISABLE_REGISTRATION=invite_only`.
