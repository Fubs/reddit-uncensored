import CopyWebpackPlugin from "copy-webpack-plugin";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url); // get the resolved path to the file
const __dirname = path.dirname(__filename); // get the name of the directory

const config = {
  entry: {
    newRedditContentScript: "./src/newRedditContentScript.js",
    oldRedditContentScript: "./src/oldRedditContentScript.js",
    background: "./src/background.js",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
  },
  optimization: {
    minimize: false,
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: "./manifest.json", to: "manifest.json" },
        { from: path.resolve(__dirname, "../assets/icons/*.png"), to: "icons" },
        {
          from: path.resolve(__dirname, "../assets/icons/favicon.ico"),
          to: "favicon.ico",
        },
      ],
    }),
  ],
};

export default config;