# TikZ Wolke

TikZ Wolke is a service which converts `script` tags (containing TikZ
code) into SVGs.  [Wolke is German for cloud.](https://en.wiktionary.org/wiki/Wolke)

See a live demo at http://demo.tikzwolke.com/

## Example

In the `<head>` of your HTML, include 
```html
<script src="http://tikzwolke.com/v1/tikzwolke.js"></script>
```
Then in the `<body>`, include TikZ code such as
```html
<script type="text/tikz">
  \begin{tikzpicture}
    \draw (0,0) circle (1in);
  \end{tikzpicture}
</script>
```

Your TikZ will be compiled (on the tikzwolke.com server) into SVGs;
the `<script>` element will be replaced with the corresponding SVG.
In this case, the stanza above will be replaced with

<img src="http://images.tikzwolke.com/sha1/dc40db944d1e8f4ab868502fddf6b026710056af">

Amazon S3 is used as a caching layer, so a TikZ image need only be
rendered once globally.
