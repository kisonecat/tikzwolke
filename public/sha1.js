import 'fast-text-encoding'; // TextEncoder polyfill

import Rusha from 'rusha';
const worker = Rusha.createWorker();

var uuids = 0;
var jobs = {};

worker.onmessage = function (e) {
  jobs[e.data.id](e.data.hash);
};

export default function sha1 (text) {
  var enc = new window.TextEncoder(); // always utf-8
  var data = enc.encode(text);

  // It would be easier to just return
  // window.crypto.subtle.digest('SHA-1', data) but that isn't
  // supported everywhere.

  return new Promise(function (resolve, reject) {
    var uuid = uuids;
    uuids = uuids + 1;
    jobs[uuid] = resolve;
    worker.postMessage({ id: uuid, data: data });
  });
}
