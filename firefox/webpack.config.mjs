import CopyWebpackPlugin from 'copy-webpack-plugin'
import Dotenv from 'dotenv-webpack'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const config = {
  entry: {
    newRedditContentScript: './src/newRedditContentScript.js',
    oldRedditContentScript: './src/oldRedditContentScript.js',
    background: './src/background.js',
    options: './src/options.js',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
  },
  optimization: {
    minimize: false,
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: './manifest.json', to: 'manifest.json' },
        { from: path.resolve(__dirname, '../assets/icons/*.png'), to: 'icons' },
        {
          from: path.resolve(__dirname, '../assets/icons/favicon.ico'),
          to: 'favicon.ico',
        },
        { from: path.resolve(__dirname, 'src/options.html'), to: 'options.html' },
      ],
    }),
    new Dotenv({ path: './.env' }),
  ],
  resolve: {
    modules: [path.resolve(__dirname, 'node_modules'), 'node_modules'],
  },
}

export default config
