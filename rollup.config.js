import babel from 'rollup-plugin-babel';
import { eslint } from 'rollup-plugin-eslint';

export default {
    input: 'public/tikzwolke.js',
    output: {
	file: 'public/tikzwolke.min.js',
	sourceMap: 'inline',
	format: 'iife',
    },
    plugins: [
	eslint({}),
	babel({
	    exclude: 'node_modules/**',
	}),
    ]
};
