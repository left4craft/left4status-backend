# Serverless Left4Status API

This repository contains the backend for Left4Craft's statuspage. It is completely serverless to maximize reliability.

## Structure

The `functions` directory contains code for 3 lambda functions: update, status, and history.

The update function is called every 5 minutes by EventBridge, and it logs in to the control panel to gather status data about the Minecraft servers. The function stores the result into an Timestream database and a Redis cache.

The status function responds to HTTP requests from API Gateway and returns cached values from the Redis cache.

The history function responds to HTTP requests from API Gateway and returns historic uptime information from the Timestream database. It also uses Redis as a caching layer.

Redis is not included in `serverless.yml` because it's cheaper to simply use Redis enterprise free tier, which includes failover and AWS hosting.

## Setup

To install required dependencies, run

```bash
npm install
```

## Deploy

In order to deploy the endpoint, copy `secret_template.js` into `secret.js`, [provide AWS credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html), and run

```bash
serverless deploy
```
