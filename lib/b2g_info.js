// @ts-check
const EventEmitter = require('events').EventEmitter;
const util = require('util');
const winston = require('winston');
const exec = require('child_process').exec;

const Snapshot = require('./snapshot');

class B2GInfo extends EventEmitter {
  constructor(paths) {
    super();
    this.paths = paths;
    this.device = null;
    this.throttle = 0;
    this.lag = 0;
    this.confirmed = false;
    this.notSupported = false;
    this.snapshot = null;
    exec(
      this.paths.adb + ' version',
      {
        cwd: this.paths.tmp
      },
      function(err, stdout, strerr) {
        const version = (stdout || strerr).match(/version\s+([\d.]+)/i);
        if (!version) {
          winston.error('[b2ginfo] adb not found at %s', this.paths.adb);
        } else {
          winston.info('[b2ginfo] Using adb %s', version[1]);
        }
      }
    );
  }

  resume() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.nextPoll();
    this.emit('start');
  }

  nextPoll(err) {
    if (!this.running) {
      return this.emit('end');
    }
    if (err && this.device && !this.notSupported) {
      this.emit('disconnected', this.device, err);
      winston.error('[b2ginfo] b2g-info failed', err);
      this.notSupported = err;
    }
    const bound = this.poll.bind(this, this.nextPoll.bind(this));
    if (!this.throttle) {
      process.nextTick(bound);
    } else {
      setTimeout(bound, Math.max(0, this.throttle - this.lag));
    }
  }

  poll(done) {
    if (!this.device || this.notSupported) {
      return this.pollDevice(done);
    }
    return this.pollInfo(done);
  }

  pollDevice(done) {
    exec(
      this.paths.adb + ' devices',
      function(err, stdout, strerr) {
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
          if (this.device) {
            winston.info('[b2ginfo] disconnected device %s', this.device);
            this.device = null;
            this.notSupported = false;
          }
          done();
          return;
        }
        const device = devices[0][0];
        if (this.notSupported && this.device == device) {
          return done();
        }
        this.device = device;
        this.confirmed = false;
        this.notSupported = false;
        done();
      }.bind(this)
    );
  }

  pollInfo(done) {
    const started = Date.now();
    exec(
      this.paths.adb + ' shell b2g-info',
      {
        cwd: this.paths.tmp
      },
      function(err, stdout, strerr) {
        if (err) {
          return done('adb shell failed');
        }
        if (stdout.toString().indexOf('b2g-info: not found') > -1) {
          return done('b2g-info not found');
        }
        if (stdout.toString().indexOf('B2G main process not found') > -1) {
          return done('B2G main process not found');
        }
        if (stdout.toString().indexOf('Fatal error') > -1) {
          return done('Fatal error ' + stdout);
        }

        const lag = Date.now() - started;
        this.lag = lag;
        const snapshot = new Snapshot(stdout, lag, this.device, this.snapshot);
        this.snapshot = snapshot;

        if (!this.confirmed) {
          winston.info('[b2ginfo] connected device `%s`', this.device);
          this.emit('connected', this.device);
        }
        this.confirmed = true;

        this.emit('data', snapshot);

        done();
      }.bind(this)
    );
  }
}

module.exports = B2GInfo;
