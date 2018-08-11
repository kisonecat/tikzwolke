const express = require('express');
const crypto = require('crypto');
const kue = require('kue');

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
    // Should call "done" with the SVG images
    done(null,"Processed: " + job.data);
});

// I could rate-limit this by demanding the client provide some
// hashcash, say that the client must provide a string X so that
// hash+X itself hases to 0000...
app.post('/sha1/:hash', function(req, res) {
    var hash = req.params.hash;

    // BADBAD: if the hash is available, just serve the .svg
    // immediately and don't even bother receiving data from the
    // client
    
    // we haven't already processed this image, so 

    var shasum = crypto.createHash('sha1');
    
    var data = "";
    
    req.on('data', function( chunk ) {
	shasum.update(chunk);
	data += chunk;
    });
    req.on('end', function() {
	var computedHash = shasum.digest('hex');

	if (computedHash === hash) {
	    var job = jobs.create( 'tikz', data )
		.ttl( 30 * 1000 ) // value in milliseconds
		.removeOnComplete( true )
		.save(function(err) {
		    if (err) {
			res.status(500).send(err);
		    }
		});

	    job.on('complete', function(result){
		// BADBAD: need to set the type appropriately
		res.send(result);
	    });
	} else {
	    res.status(500).send("The provided hash does not match the provided content.");
	}
    });
});

app.use(express.static('public'));

app.listen(3000, () => console.log('Example app listening on port 3000!'));


