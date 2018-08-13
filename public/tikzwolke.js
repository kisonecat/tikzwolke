// Determine where we were loaded from; we'll use that to find a
// tikzwolke server that can handle our POSTing tikz code
var scripts = document.getElementsByTagName( "script" ); 
var lastScript = scripts[scripts.length - 1]; 
var url = new URL(lastScript.src);
var urlRoot = url.protocol + "//" + url.hostname;
if (url.port) {
    urlRoot = urlRoot + ":" + url.port;
}

function sha1(text) {
    var enc = new TextEncoder(); // always utf-8
    return window.crypto.subtle.digest('SHA-1', enc.encode(text));	
}

function buf2hex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer),
				    x => ('00' + x.toString(16)).slice(-2)).join('');
}

function downloadCachedCopy( hash ) {
    return new Promise( function( resolve, reject ) {
	var xhr = new XMLHttpRequest();
	
	xhr.open('GET', urlRoot + "/" + hash);
	xhr.onload = function() {
	    if (xhr.status === 200) {
		var parser = new window.DOMParser();
		var svg = parser.parseFromString(xhr.responseText,"text/xml").rootElement;
		svg.style.overflow = 'visible';
		resolve(svg);
	    }
	    else if (xhr.status !== 200) {
		reject(xhr.responseText);
	    }
	};
	xhr.send();
    });
}

function process(elt) {
    var text = elt.childNodes[0].nodeValue;
    
    sha1(text).then( function(hash) {
	var hexhash = buf2hex(hash);
	
	// First try a GET because those are likely to be cached
	// along the way; if that fails, then generate hashcash
	// for a high-priority but slow POST
	downloadCachedCopy( "sha1/" + hexhash )
	    .then( (svg) => elt.parentNode.replaceChild(svg, elt) )
	    .catch( function(err) {
		var xhr = new XMLHttpRequest();
		
		xhr.open('POST', urlRoot + "/sha1/" + hexhash);
		
		xhr.setRequestHeader('Content-Type', 'application/x-latex');
		
		xhr.onload = function() {
		    if (xhr.status === 200) {
			var parser = new window.DOMParser();
			var svg = parser.parseFromString(xhr.responseText,"text/xml").rootElement;
			svg.style.overflow = 'visible';
			elt.parentNode.replaceChild(svg, elt);
		    }
		    else if (xhr.status !== 200) {
			console.log( "tikzwolke error:", xhr.responseText );
			
			// Display the error in place
			var paragraph = document.createElement("p");
			var text = document.createTextNode("[TikzWolke error]");
			paragraph.appendChild(text);
			elt.parentNode.replaceChild(paragraph, elt);
		    }
		};
		xhr.send(text);		    
	    });
    });
}

document.addEventListener("DOMContentLoaded", function(event) {     
    var scripts = document.getElementsByTagName("script");
    var tikzScripts = Array.prototype.slice.call(scripts).filter(
	(e) => (e.getAttribute("type") === "text/tikz") );
    tikzScripts.map( process );
});
