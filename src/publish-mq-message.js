import assert from 'assert';
import fs from 'fs';
import path from 'path';
import moment from 'moment';
import minimist from 'minimist';
import shortstop from 'shortstop';
import handlers from 'shortstop-handlers';
import { runWithService } from '@gasbuddy/service';
import RabbotClient from '@gasbuddy/configured-rabbitmq-client';

const argv = minimist(process.argv.slice(2));

assert(argv.exchange, 'Missing required "exchange" argument');
assert(argv.type, 'Missing required "type" argument');
assert(argv.template, 'Missing required "template" argument');

runWithService(async (service, req) => {
  const ctx = { service, logger: req.gb.logger };
  const client = new RabbotClient(ctx, {
    username: argv.username || process.env.RABBITMQ_USERNAME || 'guest',
    password: argv.password || process.env.RABBITMQ_PASSWORD || 'guest',
    hostname: argv.hostname || process.env.RABBITMQ_HOSTNAME,
    config: {
      dependencies: [argv.exchange],
      replyQueue: !!argv.waitForReply,
    },
  });

  await client.start(ctx);

  const json = JSON.parse(argv.template[0] === '{' ? argv.template : fs.readFileSync(path.resolve(argv.template), 'utf8'));
  const resolver = shortstop.create();
  resolver.use(handlers.env());
  resolver.use(handlers.base64());
  resolver.use(handlers.exec());
  resolver.use('now', value => moment().format(value));
  resolver.use('relative-date', (value) => {
    const [amount, interval, ...format] = value.split(' ');
    const finalFormat = format.join(' ');
    return moment().add(amount, interval).format(finalFormat);
  });

  const message = await new Promise((accept, reject) => {
    resolver.resolve(json, (error, data) => {
      if (error) {
        reject(error);
      } else {
        accept(data);
      }
    });
  });

  let goodResponse = false;
  try {
    if (argv.waitForReply) {
      req.gb.logger.info('Publishing message and waiting for reply', { body: JSON.stringify(message) });
      const reply = await client.request(argv.exchange, {
        type: argv.type,
        body: message,
        replyTimeout: (argv.timeout || 30) * 1000,
        correlationId: req.headers.correlationid,
      });
      goodResponse = true;
      req.gb.logger.info('Got reply', { body: JSON.stringify(reply.body) });
      await reply.ack();
      if (reply.body.error) {
        goodResponse = false;
      }
    } else {
      goodResponse = true;
      req.gb.logger.info('Publishing message', message);
      await client.publish(argv.exchange, { type: argv.type, body: message, correlationId: req.headers.correlationid });
    }
  } catch (error) {
    req.gb.logger.error('Failed to publish', req.gb.wrapError(error));
  } finally {
    await client.stop(ctx);
  }
  process.exitCode = goodResponse ? 0 : -1;
});
