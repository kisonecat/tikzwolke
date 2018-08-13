const express = require('express');
const crypto = require('crypto');
const kue = require('kue');
const path = require('path');
const fs = require('fs');
const spawn = require('child_process').spawn;
const redis = require("redis");

var client = redis.createClient({return_buffers: true});

client.on("error", function (err) {
    console.log("Error " + err);
});

const app = express();

// BADBAD: should move this to a config stanza
var jobs = kue.createQueue({
    redis: {
	port: 6379,
	host: '127.0.0.1',
	db: 3
    }
});

// basically ignore CORS for now
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Should have an actual "what is this project?" page
app.get('/', (req, res) => res.send('Hello World!'));

jobs.process('tikz', function(job, done){
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
    
    // Kill the process unless it outputs something every couple seconds
    var watchdog;
    function resetWatchdog() {
	if (watchdog) watchdog.close();	
	watchdog = setTimeout( function() { errored = "output too slow"; ps.kill(); }, 2000 );
    }
    resetWatchdog();
    
    function processLine(line) {
	console.log(" >",line);
	resetWatchdog();

	if (line.match( "@@@ finished" )) {
	    ps.kill();
	}
    }

    // Only give it 15 seconds total
    setTimeout( function() { errored = "pdflatex took too long"; ps.kill(); }, 15000 );

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
	    console.log("error: ",errored);
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
	    });
	}	       
    });
    
    // Feed the sandbox with the data we want to process
    job.data.body.replace( "\\begin{document}", "" );
    ps.stdin.write( job.data.body );
    ps.stdin.write("\\end{document}\n");    
    
});

// I could rate-limit this by demanding the client provide some
// hashcash, say that the client must provide a string X so that
// hash+X itself hases to 0000...  This could actually control the
// priority in the queue, so a client can pay for a higher position in
// the queue with hashcash
app.post('/sha1/:hash', function(req, res) {
    var hash = req.params.hash;
    var hashFunction = 'sha1';
    var multihash = hashFunction + ":" + hash;
    
    // if the hash is available, just serve the .svg immediately and
    // don't even bother receiving any data from the client
    client.get(multihash, function (err, val) {
	if (val) {
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
	      

app.use(express.static('public'));

client.select(3, function() {
    app.listen(3000, () => console.log('tikzwolke listening on port 3000'));
});



