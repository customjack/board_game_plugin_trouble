# Trouble Plugin

A plugin for my [Board Game website](https://github.com/customjack/board_game) that provides full Trouble gameplay integration.

## Usage

Load the plugin directly via CDN in the board game websites plugin manager:

[CDN Link (v1.0.6)](https://cdn.jsdelivr.net/gh/customjack/board_game_plugin_trouble@v1.0.6/dist/plugins/trouble-plugin.js)

```
https://cdn.jsdelivr.net/gh/customjack/board_game_plugin_trouble@v1.0.6/dist/plugins/trouble-plugin.js
```


This automatically registers the Trouble plugin and its associated “Trouble Classic” map when the script loads.

## Build Instructions

The plugin is built independently from the main project.

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

This produces `dist/plugins/trouble-plugin.js`.

### Watch mode (development)

```bash
npm run watch
```

This rebuilds on file changes.

## Map

The Trouble plugin includes the **Trouble Classic** map, which is registered automatically when the plugin is loaded.

## License

This plugin is licensed under the Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0). You are free to use, modify, and distribute this software for non-commercial purposes, but commercial use is prohibited.

---
