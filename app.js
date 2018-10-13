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
const package = require('./package.json');

// bucket = images.tikzwolke.com
const AWS = require('aws-sdk');
var s3 = new AWS.S3();
var bucketName = 'images.tikzwolke.com';

// Setup redis
const redis = require("redis");

var client = redis.createClient({
    host: config.redis.host,
    port: config.redis.port,
    return_buffers: true
});

client.on("error", function (err) {
    winston.error(err);
});

// Setup express
const app = express();

// basically ignore CORS for now
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.get('/', (req, res) =>
	res.redirect(303, package.homepage ) );

if (config.logging) {
    app.use(expressWinston.logger({
	transports: [
	    new winston.transports.Console({
		json: true,
		colorize: true
	    })	    
	],
	expressFormat: true, // Use the default Express/morgan request formatting. Enabling this will override any msg if true. Will only output colors with colorize set to true
	colorize: true, // Color the text and status code, using the Express/morgan color palette (text: gray, status: default green, 3XX cyan, 4XX yellow, 5XX red).
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
function runProcessUntilOutput( command, dir, args, filenameGoal, callback ) {
    var ps = spawn(command, args, { cwd: dir });

    var errored = undefined;
    
    // Kill the process unless it outputs something every second
    var watchdog;
    function resetWatchdog() {
	if (watchdog) watchdog.close();	
	watchdog = setTimeout( function() { errored = command + " output too slow"; ps.kill(); }, 1000 );
    }
    resetWatchdog();
    
    function processLine(line) {
	console.log(line);
	winston.debug(" >",line);
	resetWatchdog();
    }

    // Only give it a few seconds total
    var timer = setTimeout( function() { errored = command + " took too long"; ps.kill(); }, 5000 );

    // Split the output into lines so we can process the output one line at a time
    var remainder = new Buffer('');
    ps.stdout.on('data', function (buffer) {
	buffer = remainder + buffer;
	
	var linebreak;
	while( (linebreak = buffer.indexOf("\n")) >= 0 ) {
	    processLine( buffer.slice(0,linebreak).toString('utf-8') );
	    buffer = buffer.slice(linebreak+1);
	}

	remainder = buffer;
    });
    ps.stdout.on('end', function () {
	processLine( remainder.toString('utf-8') );
    });

    // When the process exits, we can try to read the file
    ps.on( 'exit', function() {
	if (errored) {
	    clearTimeout( timer );
	    callback(errored);
	} else {
	    callback(null);
	}
    });

    return ps;
}

jobs.process('tikz', function(job, done){
    var args = [];
    var dir = path.join(__dirname, 'latex');
    var ps = spawn("/usr/bin/pdflatex", args, { cwd: dir });
    var pdfGoal = path.join(dir, 'texput.pdf');
    var svgGoal = path.join(dir, 'texput.svg');

    var processPdf = function(callback) {
	var ps = runProcessUntilOutput( "/usr/bin/pdflatex", dir, [], pdfGoal, callback );

	function writer(s) {
	    ps.stdin.write(s);
	    console.log(s);
	}
	
	// Feed the process with the data we want to process
	writer( "\\documentclass{standalone}\n" );
	writer( "\\usepackage{tikz}\n" );
	if (job.data.body.match( "\\begin{document}" ) === null) {
	    writer("\\begin{document}\n");
	}
	writer( job.data.body );
	writer("\n\\end{document}\n");
    };
    
    async.series([
	processPdf,
	processPdf,
	function(callback) {
	    runProcessUntilOutput( "/usr/bin/mutool", dir, ['draw','-o',svgGoal,pdfGoal], svgGoal, callback );
	},
    ], function(err, results) {
	if (err) {
	    // BADBAD: cache errors
	    winston.error(err);
	    done(err);
	} else {	    
	    fs.readFile(svgGoal, 'utf-8', function(err, contents) {
		if (err) {
		    console.log("ERR");		    
                    done(err);
		} else {
		    console.log(contents);
		    done(null,contents);
		
		    // cache this in redis too
		    client.set( job.data.hash, contents );
		    client.expire( job.data.hash, config.cache.ttl );

		    var params = {Bucket: bucketName, Key: job.data.hash, Body: contents,
				  CacheControl: 'public, max-age=31536000',
				  ContentType: "image/svg+xml" };
		    s3.putObject(params, function(err, data) {
			if (err) {
			    winston.error(err);
			} else {
			    winston.info("s3 upload for " + job.data.hash);
			}
		    });
		}
	    });
	}
    });
});

app.get('/sha1/:hash', function(req, res) {
    var hash = req.params.hash;
    var hashFunction = 'sha1';
    var multihash = hashFunction + "/" + hash;

    client.get(multihash, function (err, val) {
	if (err) {
	    res.status(500).send(err);
	} else {
	    if (val) {
		res.setHeader('content-type', 'image/svg+xml');
		res.set('Cache-Control', 'public, max-age=31536000');
		res.send(val);
	    } else {
		res.status(404).send("Cached content not found.");		
	    }
	}
    });
});

// Rate limit the POST endpoint since it is necessary slow
var RateLimit = require('express-rate-limit');
var RedisStore = require('rate-limit-redis');
 
var limiter = new RateLimit({
  store: new RedisStore({
      client: client
  }),
    max: config.rateLimit, // limit each IP to so many requests per window    
    delayMs: 0 // full speed until the max limit is reached
});
 

app.use( '/sha1/:hash', limiter );

// I could rate-limit this by demanding the client provide some
// hashcash, say that the client must provide a string X so that
// hash+X itself hases to 0000...  This could actually control the
// priority in the queue, so a client can pay for a higher position in
// the queue with hashcash
app.post('/sha1/:hash', function(req, res) {
    var hash = req.params.hash;
    var hashFunction = 'sha1';
    var multihash = hashFunction + "/" + hash;

    // if the hash is available, just serve the .svg immediately and
    // don't even bother receiving any data from the client
    client.get(multihash, function (err, val) {
	if ((!err) && (val)) {
	    res.setHeader('content-type', 'image/svg+xml');
	    res.send(val);
	} else {
	    // we haven't already processed this image, so process it.
	    var shasum = crypto.createHash('sha1');
    
	    var data = "";
    
	    req.on('data', function( chunk ) {
		shasum.update(chunk);
		data += chunk;
	    });
	    req.on('end', function() {
		var computedHash = shasum.digest('hex');
		
		if (computedHash === hash) {
		    var job = jobs.create( 'tikz', { body: data, hash: multihash } )
			.ttl( 30 * 1000 ) // value in milliseconds
			.removeOnComplete( true )
			.save(function(err) {
			    if (err) {
				res.status(500).send(err);
			    }
			});
		    
		    job.on('error', function(err){
			res.status(500).send(err);
		    });
		    
		    job.on('complete', function(result){
			res.setHeader('content-type', 'image/svg+xml');
			res.send(result);
		    });
		    
		} else {
		    res.status(500).send("The provided hash does not match the provided content.");
		}
	    });
	}
    });
});

const versionator = require('versionator').createBasic('v1');
app.use(versionator.middleware);
app.use(express.static('public'));

client.select(config.redis.database, function() {
    app.listen(3000, () => winston.info('tikzwolke listening on port 3000'));
});
