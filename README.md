# TikZ Wolke

TikZ Wolke is a cloud-based service which converts `script` tags
(containing TikZ code) into SVGs.

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
This TikZ will be compiled (on the tikzwolke.com server) into SVGs;
the `<script>` element will be replaced with the corresponding SVG.

