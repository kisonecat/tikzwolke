# TikZ Wolke

**If you are interested in this, you are likely more interested in [TikZJax](https://github.com/kisonecat/tikzjax), though which TikZ runs entirely in the browser in WebAssembly.**

TikZ Wolke is a service which converts `script` tags (containing TikZ
code) into SVGs.  [Wolke is German for cloud.](https://en.wiktionary.org/wiki/Wolke)

See a live demo at https://demo.tikzwolke.com/

## Example

In the `<head>` of your HTML, include 
```html
<script src="https://tikzwolke.com/v1/tikzwolke.js"></script>
```
Then in the `<body>`, include TikZ code such as
```html
<script type="text/tikz">
  \begin{tikzpicture}
    \draw (0,0) circle (1in);
  \end{tikzpicture}
</script>
```

Your TikZ will be compiled (on the `tikzwolke.com` server) into SVGs;
the `<script>` element will be replaced with the corresponding SVG.
In this case, the stanza above would be replaced with

<img src="http://images.tikzwolke.com/sha1/dc40db944d1e8f4ab868502fddf6b026710056af">

Because tikzwolke.js relies on `crypto.window.subtle`, you must use
https and a browser supporting WebCrypto.  Additionally, currently
SHA1 hashes are used which aren't available on Edge.  <b>These bugs
will be fixed (with an appropriate polyfill) in the 1.0 release.</b>

Amazon S3 is used as a caching layer, so a TikZ image need only be
rendered once globally.
