import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';

export default {
    input: 'index.js',
    output: {
        file: 'dist/plugins/trouble-plugin.js',
        format: 'es',
        sourcemap: true
    },
    plugins: [json(), resolve(), commonjs()],
    external: (id) => {
        // Don't externalize relative imports (trouble-specific files)
        if (id.startsWith('.') || id.startsWith('/')) {
            return false;
        }
        // Bundle everything for now - dependencies will be available at runtime
        return false;
    }
};
