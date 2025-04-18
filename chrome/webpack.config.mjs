import CopyWebpackPlugin from 'copy-webpack-plugin';
import Dotenv from 'dotenv-webpack';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const config = {
  entry: {
    newRedditContentScript: './src/newRedditContentScript.ts',
    oldRedditContentScript: './src/oldRedditContentScript.ts',
    background: './src/background.ts',
    options: './src/options.ts',
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
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
        { from: path.resolve(__dirname, '../assets/icons'), to: 'icons' },
        { from: path.resolve(__dirname, 'src/options.html'), to: 'options.html' },
      ],
    }),
    new Dotenv({ path: './.env' }),
  ],
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    modules: [path.resolve(__dirname, 'node_modules'), 'node_modules'],
  },
};

export default config;
