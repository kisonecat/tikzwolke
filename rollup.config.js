import babel from 'rollup-plugin-babel';
import { eslint } from 'rollup-plugin-eslint';
import resolve from 'rollup-plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';

export default {
    input: 'public/tikzwolke.js',
    output: {
	file: 'public/tikzwolke.min.js',
	sourceMap: 'inline',
	format: 'iife',
    },
    plugins: [
        resolve({
	    // use "module" field for ES6 module if possible
	    module: true,
 
	    // use "jsnext:main" if possible
	    // – see https://github.com/rollup/rollup/wiki/jsnext:main
	    jsnext: true,
 
	    // use "main" field or index.js, even if it's not an ES6 module
	    // (needs to be converted from CommonJS to ES6
	    // – see https://github.com/rollup/rollup-plugin-commonjs
	    main: true,
	    
	    // some package.json files have a `browser` field which
	    // specifies alternative files to load for people bundling
	    // for the browser. If that's you, use this option, otherwise
	    // pkg.browser will be ignored
	    browser: true,
 
	    // not all files you want to resolve are .js files
	    extensions: [ '.mjs', '.js', '.jsx', '.json' ],  // Default: [ '.mjs', '.js', '.json', '.node' ]
 
	    // whether to prefer built-in modules (e.g. `fs`, `path`) or
	    // local ones with the same names
	    preferBuiltins: false,  // Default: true
	}),
	commonjs(),
	eslint({}),
	babel({
	    exclude: 'node_modules/**',
	})	
    ]
};
