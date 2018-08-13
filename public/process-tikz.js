$(function() {
    console.log("Processing TikZ...");

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

	    $.ajax({
		type: "POST",
		url: "http://localhost:3000/sha1/" + hexhash,
		data: text
	    }).done( function(data) {
		var parser = new DOMParser();
		var svg = parser.parseFromString(data,"text/xml").rootElement;
		svg.style.overflow = 'visible';
		elt.parentNode.replaceChild(svg, elt);
	    });
	});
    }
    
    var scripts = document.getElementsByTagName("script");
    var tikzScripts = Array.prototype.slice.call(scripts).filter(
	(e) => (e.getAttribute("type") === "text/tikz") );
    tikzScripts.map( process );
});
