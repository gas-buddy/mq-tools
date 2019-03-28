import assert from 'assert';
import minimist from 'minimist';
import { runWithService } from '@gasbuddy/service';
import RabbotClient from '@gasbuddy/configured-rabbitmq-client';

const argv = minimist(process.argv.slice(2));

assert(argv.me, 'Missing required "me" argument');
assert(argv.them, 'Missing required "them" argument');

/**
 * Sets up a chaos tester that will publish to all other parties and receive from all other parties.
 * If any messages are dropped, it will yell.
 */
runWithService(async (service, req) => {
  const ctx = { service, logger: req.gb.logger };
  const config = {
    exchangeGroups: {},
  };

  const others = argv.them.split(',');
  others.forEach((o) => {
    config.exchangeGroups[`heartbeat.${argv.me}.to.${o}`] = {
      keys: 'ping',
    };
    config.exchangeGroups[`heartbeat.${o}.to.${argv.me}`] = {
      keys: 'ping',
    };
  });

  const client = new RabbotClient(ctx, {
    username: argv.username || process.env.RABBITMQ_USERNAME || 'guest',
    password: argv.password || process.env.RABBITMQ_PASSWORD || 'guest',
    hostname: argv.hostname || process.env.RABBITMQ_HOSTNAME,
    config,
  });

  await client.start(ctx);
  let sentMessages = 0;
  let counter = 0;
  let interval;
  const counters = {};

  others.forEach((other) => {
    counters[other] = 0;
    // Subscribe to everyone else's queue to me
    client.subscribe(`heartbeat.${other}.to.${argv.me}`, 'ping', (context, message) => {
      if (counters[other] === 0) {
        req.gb.logger.info('Received first message', {
          from: other,
          counter: message.body.counter,
        });
        counters[other] = message.body.counter;
      } else if (counters[other] + 1 !== message.body.counter) {
        // Miss any?
        req.gb.logger.warn('Out of order', {
          from: other,
          expected: counters[other] + 1,
          received: message.body.counter,
        });
        if (message.body.counter > counters[other]) {
          counters[other] = message.body.counter;
        }
      } else if (message.body.counter % 10 === 0) {
        counters[other] = message.body.counter;
        req.gb.logger.info('Received 10 messages in a row', {
          from: other,
          counter: message.body.counter,
        });
      } else {
        counters[other] = message.body.counter;
      }
      return message.ack().catch((error) => {
        req.gb.logger.error('Failed to ack', {
          ...req.gb.wrapError(error),
          from: other,
          counter: message.body.counter,
        });
      });
    });
  });

  const sendMessage = async () => {
    counter += 1;
    await Promise.all(others.map(other => client
      .publish(`heartbeat.${argv.me}.to.${other}`, 'ping', { counter, date: Date.now() })
      .catch((error) => {
        req.gb.logger.error('Failed to send', {
          ...req.gb.wrapError(error),
          to: other,
          counter,
        });
      })));
    sentMessages += 1;
    if (argv.count && sentMessages > argv.count) {
      clearInterval(interval);
      await client.stop(ctx);
    }
  };
  interval = setInterval(sendMessage, argv.interval || 5000);
});
