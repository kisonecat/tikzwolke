const express = require('express');
const crypto = require('crypto');
const kue = require('kue');
const path = require('path');
const fs = require('fs');
const spawn = require('child_process').spawn;
const config = require('./config');
const winston = require('winston');
const expressWinston = require('express-winston');

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

// BADBAD: should just redirect to github
app.get('/', (req, res) => res.send('Hello World!'));

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

jobs.process('tikz', function(job, done){
    // BADBAD: instead of file:output.txt perhaps /dev/fd/2 so I can
    // capture stderr?  Or a named pipe or something similar?  Then I
    // think I could run more than one process?
    var args = [ '-hda',
		 path.join(__dirname, 'qemu/cow.img'),
		 '-m',
		 '512',
		 '-enable-kvm',
		 '-loadvm',
		 'booted',
		 '-nographic',
		 '-monitor', 'none', 
		 '-serial',
		 'stdio',
		 '-serial',
		 'file:output.txt' ];
    
    var outputFilename = path.join(__dirname, 'qemu/output.txt');
    
    var dir = path.join(__dirname, 'qemu');
    var ps = spawn("/usr/bin/qemu-system-x86_64", args, { cwd: dir });

    var errored = undefined;
    
    // Kill the process unless it outputs something every seconds
    var watchdog;
    function resetWatchdog() {
	if (watchdog) watchdog.close();	
	watchdog = setTimeout( function() { errored = "output too slow"; ps.kill(); }, 1000 );
    }
    resetWatchdog();
    
    function processLine(line) {
	winston.debug(" >",line);
	resetWatchdog();

	if (line.match( "@@@ finished" )) {
	    ps.kill();
	}
    }

    // Only give it 10 seconds total
    setTimeout( function() { errored = "pdflatex took too long"; ps.kill(); }, 10000 );

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
	    winston.error(errored);
	    done(errored);
	} else {
	    fs.readFile(outputFilename, 'utf-8', function(err, contents) {
		if (err) {
                    return done(err);
		}

		var svg = Buffer.concat( contents.split("\n").map(
		    (data) => new Buffer(data, 'base64') ) ).toString('utf-8');
		
		// should base64 decode this data
		done(null,svg);
		
		// cache this in redis too
		client.set( job.data.hash, svg );
		client.expire( job.data.hash, config.cache.ttl );
	    });
	}	       
    });
    
    // Feed the sandbox with the data we want to process
    job.data.body.replace( "\\begin{document}", "" );
    ps.stdin.write( job.data.body );
    ps.stdin.write("\\end{document}\n");    
    
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

// BADBAD: the /v1/ path is being ignored?
const versionator = require('versionator').createBasic('v1');
app.use(versionator.middleware);
app.use(express.static('public'));

client.select(config.redis.database, function() {
    app.listen(3000, () => winston.info('tikzwolke listening on port 3000'));
});
