const esbuild = require('esbuild');
const sveltePlugin = require('esbuild-svelte');
const path = require('path');

const production = process.env.NODE_ENV === 'production';

async function build() {
  try {
    // Build JavaScript with Svelte support
    await esbuild.build({
      entryPoints: [
        'src/js/unified_index.js',
        'src/js/print_view.js'
      ],
      bundle: true,
      minify: production,
      sourcemap: true,
      target: 'es2018',
      outdir: '../templates/static/dist',
      inject: ['src/js/process_shim.js'],
      define: {
        'process.env.NODE_ENV': '"production"'
      },
      plugins: [
        sveltePlugin({
          compilerOptions: {
            dev: !production,
            css: 'injected',
          }
        })
      ]
    });

    // Build CSS
    await esbuild.build({
      entryPoints: [
        'src/css/app.css',
        'src/css/print.css'
      ],
      bundle: true,
      minify: production,
      outdir: '../templates/static/dist',
      loader: {
        '.woff2': 'file',
        '.woff': 'file',
        '.ttf': 'file'
      }
    });

    console.log('Build completed successfully');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
