const express = require('express');
const crypto = require('crypto');
const kue = require('kue');
const path = require('path');
const fs = require('fs');
const spawn = require('child_process').spawn;
const config = require('./config');
const winston = require('winston');
const expressWinston = require('express-winston');
const async = require('async');
const packageJson = require('./package.json');
const tmp = require('tmp');

const AWS = require('aws-sdk');
var s3 = new AWS.S3();
var bucketName = 'images.tikzwolke.com';

// Setup express
const app = express();

// basically ignore CORS for now
app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.get('/', (req, res) =>
  res.redirect(303, packageJson.homepage));

if (config.logging) {
  app.use(expressWinston.logger({
    transports: [
      new winston.transports.Console({
        json: true,
        colorize: true
      })
    ],
    // Use the default Express/morgan request formatting. Enabling
    // this will override any msg if true. Will only output colors
    // with colorize set to true
    expressFormat: true,
    // Color the text and status code, using the Express/morgan color
    // palette (text: gray, status: default green, 3XX cyan, 4XX yellow,
    // 5XX red).
    colorize: true
  }));
}

var jobs = kue.createQueue({
  redis: {
    host: config.redis.host,
    port: config.redis.port,
    db: config.redis.database
  }
});

// spawn command inside dir with args and wait until filename is
// created or until a watchdog timer times out
function runProcessUntilOutput (command, dir, args, filenameGoal, callback) {
  var ps = spawn(command, args, { cwd: dir });

  var errored = false;

  // Kill the process unless it outputs something every second
  var watchdog;
  function resetWatchdog () {
    if (watchdog) watchdog.close();
    watchdog = setTimeout(function () { errored = command + ' output too slow'; ps.kill(); }, 15000);
  }
  resetWatchdog();

  function processLine (line) {
    console.log(line);
    winston.debug(' >', line);
    resetWatchdog();
  }

  // Only give it a few seconds total
  var timer = setTimeout(function () { errored = command + ' took too long'; ps.kill(); }, 15000);

  // Split the output into lines so we can process the output one line at a time
  var remainder = Buffer.alloc(0);
  ps.stdout.on('data', function (buffer) {
    buffer = remainder + buffer;

    var linebreak;
    while ((linebreak = buffer.indexOf('\n')) >= 0) {
      processLine(buffer.slice(0, linebreak).toString('utf-8'));
      buffer = buffer.slice(linebreak + 1);
    }

    remainder = buffer;
  });
  ps.stdout.on('end', function () {
    processLine(remainder.toString('utf-8'));
  });

  // When the process exits, we can try to read the file
  ps.on('exit', function () {
    if (errored) {
      clearTimeout(timer);
      callback(errored);
    } else {
      callback(null);
    }
  });

  return ps;
}

jobs.process('tikz', config.concurrentLatex, function (job, done) {
  tmp.dir({ unsafeCleanup: true }, function (err, dir, cleanupCallback) {
    if (err) {
      winston.error(err);
      done(err);
    } else {
      var pdfGoal = path.join(dir, 'texput.pdf');
      var svgGoal = path.join(dir, 'texput.svg');

      var processPdf = function (callback) {
        var ps = runProcessUntilOutput('/usr/bin/pdflatex', dir, [], pdfGoal, callback);

        function writer (s) {
          ps.stdin.write(s);
          console.log(s);
        }

        // Feed the process with the data we want to process
        writer('\\documentclass{standalone}\n');
        writer('\\usepackage{tikz}\n');
        if (job.data.body.match('\\\\begin *{document}') === null) {
          writer('\\begin{document}\n');
        }
        writer(job.data.body);
        writer('\n\\end{document}\n');
      };

      async.series([
        processPdf,
        processPdf,
        function (callback) {
          runProcessUntilOutput('/usr/bin/mutool', dir, ['draw', '-o', svgGoal, pdfGoal], svgGoal, callback);
        }
      ], function (err, results) {
        if (err) {
          // BADBAD: cache errors
          winston.error(err);
          done(err);
          cleanupCallback();
        } else {
          fs.readFile(svgGoal, 'utf-8', function (err, contents) {
            cleanupCallback();

            if (err) {
              console.log('ERR');
              done(err);
            } else {
              console.log(contents);
              done(null, contents);

              var params = { Bucket: bucketName,
                             Key: job.data.hash,
                             Body: contents,
                             CacheControl: 'public, max-age=31536000',
                             ContentType: 'image/svg+xml' };
              s3.putObject(params, function (err, data) {
                if (err) {
                  winston.error(err);
                } else {
                  winston.info('s3 upload for ' + job.data.hash);
                }
              });
            }
          });
        }
      });
    }
  });
});

// Rate limit the POST endpoint since it is necessarily slow
var RateLimit = require('express-rate-limit');

var limiter = new RateLimit({
  max: config.rateLimit, // limit each IP to so many requests per window
  delayMs: 0 // full speed until the max limit is reached
});

app.use('/sha1/:hash', limiter);

// I could rate-limit this by demanding the client provide some
// hashcash, say that the client must provide a string X so that
// hash+X itself hases to 0000...  This could actually control the
// priority in the queue, so a client can pay for a higher position in
// the queue with hashcash
app.post('/sha1/:hash', function (req, res) {
  var hash = req.params.hash;
  var hashFunction = 'sha1';
  var multihash = hashFunction + '/' + hash;

  // we haven't already processed this image, so process it.
  var shasum = crypto.createHash('sha1');

  var data = '';

  req.on('data', function (chunk) {
    shasum.update(chunk);
    data += chunk;
  });
  req.on('end', function () {
    var computedHash = shasum.digest('hex');

    if (computedHash === hash) {
      var job = jobs.create('tikz', { body: data, hash: multihash })
          .ttl(30 * 1000) // value in milliseconds
          .removeOnComplete(true)
          .save(function (err) {
            if (err) {
              res.status(500).send(err);
            }
          });

      job.on('error', function (err) {
        res.status(500).send(err);
      });

      job.on('complete', function (result) {
        res.setHeader('content-type', 'image/svg+xml');
        res.send(result);
      });
    } else {
      res.status(500).send('The provided hash does not match the provided content.');
    }
  });
});

// BADBAD: add some caching to this?
function serveJavascript (req, res, next) {
  var options = {
    root: path.join(__dirname, '/public/'),
    dotfiles: 'deny',
    headers: {
      'x-timestamp': Date.now()
    }
  };

  res.sendFile('tikzwolke.min.js', options, function (err) {
    if (err) {
      next(err);
    } else {
    }
  });
}

app.get('/v:version/:filename.js', serveJavascript);
app.get('/:filename.js', serveJavascript);
app.get('/.js', serveJavascript);

app.listen(3000, () => winston.info('tikzwolke listening on port 3000'));
