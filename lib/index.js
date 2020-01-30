#!/usr/bin/env node

// @ts-check
const clivas = require('clivas');
const exec = require('child_process').exec;

const opts = require('nomnom')
  .option('app', {
    abbr: 'a',
    help: 'Filter list to one app (regexp format)'
  })
  .option('throttle', {
    abbr: 't',
    default: 0,
    help: 'Throttling b2g-info polling'
  })
  .parse();

let filter = null;
if (opts.app) {
  filter = new RegExp(opts.app, 'i');
}

const Snapshot = require('./snapshot');

let device = null;

clivas.cursor(false);

function watch(done) {
  if (!device) {
    exec('adb devices', function(err, stdout, strerr) {
      const devices = stdout
        .split('\n')
        .slice(1)
        .filter(function(line, idx) {
          return line.trim() != '' && /\w+\t\w+/.test(line);
        })
        .map(function(line) {
          return line.split(/[\s]+/);
        });
      if (!devices.length) {
        done();
        return;
      }
      clivas.clear();
      device = devices[0][0];
      done();
    });
    return;
  }

  const started = Date.now();
  exec('adb shell b2g-info', function(err, stdout, strerr) {
    if (err) {
      done('disconnected');
      return;
    }
    if (stdout.toString().indexOf('b2g-info: not found') > -1) {
      clivas.clear();
      clivas.line('{red:device "' + device + '" doesn\'t have b2g-info}');
      done();
      return;
    }

    const lag = Date.now() - started;
    const snapshot = new Snapshot(stdout);
    console.log('snapshot', snapshot);
    const running = Object.keys(snapshot.apps).length;

    if (running == 0) {
      done('empty snapshot');
      return;
    }

    clivas.clear();
    clivas.line(
      '{yellow:{11:device:}} ' + device + ' {italic:(' + lag + ' ms)}'
    );
    clivas.line(
      '{yellow:{11:free (mb):}} {bold:{8:' + (snapshot.mem.free || '-') + '}}'
    );
    clivas.line(
      '{yellow:{11:cache (mb):}} {bold:{8:' + (snapshot.mem.cache || '-') + '}}'
    );
    clivas.line('{yellow:{6:pid} {15:app} {8:uss} pss} (mb)');

    Object.keys(snapshot.apps).forEach(function(pid) {
      const app = snapshot.apps[pid];
      if (app.name.charAt(0) == '(') {
        return;
      }
      if (filter && !filter.test(app.pid) && !filter.test(app.name)) {
        return;
      }
      clivas.line(
        '{6:' +
          app.pid +
          '} {15:' +
          app.name +
          '} {bold:{8:' +
          app.uss +
          '} {8:' +
          app.pss +
          '}}'
      );
    });

    done();
  });
}

function nextWatch(err) {
  if (err) {
    clivas.line('{red:device "' + device + '"" disconnected}');
    device = null;
  }
  const bound = watch.bind(null, nextWatch);
  if (!opts.throttle) {
    process.nextTick(bound);
  } else {
    setTimeout(bound, opts.throttle);
  }
}

clivas.line('{yellow:waiting for device}');

watch(nextWatch);
