# Trouble Plugin

A plugin for my [Board Game website](https://github.com/customjack/board_game) that provides full Trouble gameplay integration.

## Usage

Load the plugin directly via CDN in the board game websites plugin manager:

```html
<script src="https://cdn.jsdelivr.net/gh/customjack/drinking-board-game-trouble-plugin@v1.0.0/dist/plugins/trouble-plugin.js"></script>
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

---
