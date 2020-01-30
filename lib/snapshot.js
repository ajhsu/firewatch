// @ts-check

const sysMatch = /\(Prealloc/;

class Snapshot {
  constructor(stdout, lag, device, compare) {
    this.apps = [];
    this.pids = [];
    this.mem = {};

    const time = (this.time = Date.now());
    this.lag = lag;
    this.device = device;
    this.closed = [];
    this.opened = [];
    this.interval = 0;

    if (stdout == null) {
      return;
    }
    let section = 0;
    let headers = [];
    const pids = this.pids;

    stdout.split(/\r?\n/).some((line) => {
      if (section > 0 && line.trim() == '') {
        section++;
        return;
      }
      switch (section) {
        // Process list headers
        case 0:
          headers = line.match(/\s*[^\s]+/g);
          // Skip error lines (Failed to match, etc)
          if (!headers || headers[0].trim().toLowerCase() != 'name') {
            return;
          }
          section++;
          return;
        // Process list numbers
        case 1:
          let from = 0;
          const app = headers.reduce((app, header) => {
            const len = header.length;
            const key = sluggify(header);
            let value = line.substr(from, len).trim();
            if (/^\d+(\.\d+)?$/.test(value)) {
              value = Number(value);
            }
            app[key] = value;
            from += len;
            return app;
          }, {});
          if (!app.name) {
            // Buggy output
            return;
          }
          pids.push(app.pid);
          app.id = app.pid; // + '-' + sluggify(app.name);
          app.time = time;
          app.sys = app.user == 'root' || sysMatch.test(app.name);
          this.apps.push(app);
        // Empty lines
        case 2:
          return;
        // Memory section
        case 3:
          const parts = line.trim().match(/([\w\s+()-]+[\w)])\s+([\d.]+)/);
          if (!parts) {
            return;
          }
          const key = sluggify(parts[1]);
          this.mem[key] = Number(parts[2]);
          return;
        default:
          // Done
          return true;
      }
    });

    if (compare && compare.device == device) {
      this.interval = time - compare.time;
      const comparePids = compare.apps.map((app) => {
        return app.pid;
      });
      this.opened = pids.filter((id) => {
        return comparePids.indexOf(id) == -1;
      });
      this.closed = comparePids.filter((id) => {
        return pids.indexOf(id) == -1;
      });
    }
  }

  toObject() {
    return {
      apps: this.apps,
      mem: this.mem,
      time: this.time,
      device: this.device,
      lag: this.lag,
      interval: this.interval,
      opened: this.opened,
      closed: this.closed
    };
  }
}

Snapshot.reduce = (snapshot) => {
  return {
    apps: snapshot.apps.map((app) => {
      return {
        id: app.id,
        pid: app.pid,
        oomadj: app['oom_adj'],
        nice: app['nice'],
        name: app.name,
        mem: app.uss,
        time: app.time,
        sys: app.sys
      };
    }),
    mem: {
      total: snapshot.mem.total,
      free: snapshot.mem.free,
      cache: snapshot.mem.cache
    },
    time: snapshot.time,
    lag: snapshot.lag,
    interval: snapshot.interval,
    closed: snapshot.closed,
    opened: snapshot.opened
  };
};

function sluggify(str) {
  return str
    .toLowerCase()
    .replace(/[^\w]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

module.exports = Snapshot;
