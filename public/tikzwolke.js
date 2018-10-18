// document.currentScript polyfill
if (document.currentScript === undefined) {
  var scripts = document.getElementsByTagName('script');
  document.currentScript = scripts[scripts.length - 1];
}

// Determine where we were loaded from; we'll use that to find a
// tikzwolke server that can handle our POSTing tikz code
var url = new URL(document.currentScript.src);
// host includes the port
var urlRoot = url.protocol + '//' + url.host;

var awsRoot = 'https://s3.us-east-2.amazonaws.com/images.tikzwolke.com';

function sha1 (text) {
  var enc = new TextEncoder(); // always utf-8
  return window.crypto.subtle.digest('SHA-1', enc.encode(text));
}

function buf2hex (buffer) {
  return Array.prototype.map.call(new Uint8Array(buffer),
    x => ('00' + x.toString(16)).slice(-2)).join('');
}

function downloadCachedCopy (url) {
  return new Promise(function (resolve, reject) {
    var img = document.createElement('img');
    img.src = url;
    img.style.overflow = 'visible';
    img.onload = function () {
      resolve(img);
    };
    img.onerror = function () {
      reject();
    };
  });
}

function process (elt) {
  var text = elt.childNodes[0].nodeValue;

  sha1(text).then(function (hash) {
    var hexhash = buf2hex(hash);

    // First try a GET to AWS because those are likely to be
    // cached along the way
    downloadCachedCopy(awsRoot + '/sha1/' + hexhash)
      .then((svg) => elt.parentNode.replaceChild(svg, elt))
      .catch(function (err) {
        // We missed the AWS cache, but maybe we cached it
        // locally
        downloadCachedCopy(urlRoot + '/sha1/' + hexhash)
          .then((svg) => elt.parentNode.replaceChild(svg, elt))
          .catch(function (err) {
            // since we missed the cache, generate
            // hashcash for a high-priority but slow
            // POST
            var xhr = new XMLHttpRequest();

            xhr.open('POST', urlRoot + '/sha1/' + hexhash);

            xhr.setRequestHeader('Content-Type', 'application/x-latex');

            xhr.onload = function () {
              if (xhr.status === 200) {
                var img = document.createElement('img');
                img.src = 'data:image/svg+xml;base64,' + window.btoa(xhr.responseText);
                img.style.overflow = 'visible';
                elt.parentNode.replaceChild(img, elt);
              } else if (xhr.status !== 200) {
                console.log('tikzwolke error:', xhr.responseText);

                // Display the error in place
                var paragraph = document.createElement('p');
                var text = document.createTextNode('[TikzWolke error]');
                paragraph.appendChild(text);
                elt.parentNode.replaceChild(paragraph, elt);
              }
            };
            xhr.send(text);
          });
      });
  });
}

document.addEventListener('DOMContentLoaded', function (event) {
  var scripts = document.getElementsByTagName('script');
  var tikzScripts = Array.prototype.slice.call(scripts).filter(
    (e) => (e.getAttribute('type') === 'text/tikz'));
  tikzScripts.map(process);
});
