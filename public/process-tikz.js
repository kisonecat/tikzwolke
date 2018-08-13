document.addEventListener("DOMContentLoaded", function(event) { 
    function sha1(text) {
	var enc = new TextEncoder(); // always utf-8
	console.log(text);
	return window.crypto.subtle.digest('SHA-1', enc.encode(text));	
    }

    function buf2hex(buffer) {
	return Array.prototype.map.call(new Uint8Array(buffer),
					x => ('00' + x.toString(16)).slice(-2)).join('');
    }
    
    function process(elt) {
	var text = elt.childNodes[0].nodeValue;

	sha1(text).then( function(hash) {
	    var hexhash = buf2hex(hash);

	    var xhr = new XMLHttpRequest();

	    xhr.open('POST', "http://localhost:3000/sha1/" + hexhash);
	    
	    xhr.setRequestHeader('Content-Type', 'application/x-latex');
	    
	    xhr.onload = function() {
		if (xhr.status === 200) {
		    var parser = new DOMParser();
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
    }
    
    var scripts = document.getElementsByTagName("script");
    var tikzScripts = Array.prototype.slice.call(scripts).filter(
	(e) => (e.getAttribute("type") === "text/tikz") );
    tikzScripts.map( process );
});
