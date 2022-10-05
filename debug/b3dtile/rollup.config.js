import path from 'path';
import { terser } from 'rollup-plugin-terser';
import postcss from 'rollup-plugin-postcss';
import resolve from 'rollup-plugin-node-resolve';
import preprocess from 'rollup-plugin-preprocess';
import injectProcessEnv from 'rollup-plugin-inject-process-env';
import typescript from 'rollup-plugin-typescript2';



const outdir = "dist/";

const env = {
    MAPRAY_ACCESS_TOKEN:    process.env.MAPRAY_ACCESS_TOKEN,
    BINGMAP_ACCESS_TOKEN:   process.env.BINGMAP_ACCESS_TOKEN,
};

[
    "MAPRAY_ACCESS_TOKEN",
]
.forEach( key => { if ( !env[key] ) throw new Error( `${key} is missing` ); });



export default function() {

    const isProd = process.env.BUILD === 'production';
    const maprayAccessToken = process.env.MAPRAY_ACCESS_TOKEN;
    const bingAccessToken = process.env.BINGMAP_ACCESS_TOKEN;

    const bundle = {
        input: 'src/index.ts',
        output: {
            file: outdir + 'bundle.js',
            format: 'iife',
            indent: false,
            sourcemap: !isProd,
        },
        plugins: [
            postcss(),
            injectProcessEnv( env ),
            resolve(),
            preprocess({
                include: ([
                    "src/**/*.js"
                ]),
                exclude: [], // disable default option (node_modules/**)
                context: {
                    BUILD: process.env.BUILD,
                }
            }),
            typescript({
                tsconfig: './tsconfig.json',
                tsconfigOverride: {
                    compilerOptions: {
                        sourceMap: true,
                    }
                }
            }),
            (isProd ?
                terser({
                    compress: {
                        unused: false,
                        collapse_vars: false,
                    },
                    output: {
                        comments: false,
                    },
                }):
                null
            ),
        ],
    }

    return bundle;
}
