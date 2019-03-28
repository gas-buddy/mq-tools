mq-tools
========

Various tools for dealing with RabbitMQ.

publish-mq-message
==================
Publish a templated message to an exchange. Example:

```
publish-mq-message --exchange foo.bar --type baz --template '{"date":"now:YYYY-MM-DD"}'
```

heartbeat
=========
Perform some chaos testing against a RabbitMQ cluster. Typically you would run one copy
of heartbeat PER RabbitMQ node. Each process will send messages to all others and receive
messages from all others, and ensure that they arrive in order and completely. If any
messages are dropped, it will be reported. For example, for a three node cluster:

On machine 1:
```
```