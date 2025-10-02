# Diagram Gallery

This page demonstrates the extended renderer that now understands Mermaid, Excalidraw, and Vega specifications.

## Excalidraw: Scene JSON

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [
    {
      "id": "node-1",
      "type": "rectangle",
      "x": 120,
      "y": 140,
      "width": 220,
      "height": 80,
      "angle": 0,
      "strokeColor": "#3b82f6",
      "backgroundColor": "#1e293b",
      "fillStyle": "hachure",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "roundness": { "type": 3 },
      "seed": 21190217,
      "version": 32,
      "versionNonce": 123456789,
      "isDeleted": false,
      "boundElements": [
        { "type": "arrow", "id": "arrow-1" }
      ],
      "updated": 1700000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "label-1",
      "type": "text",
      "x": 150,
      "y": 164,
      "width": 160,
      "height": 36,
      "angle": 0,
      "strokeColor": "#93c5fd",
      "backgroundColor": "transparent",
      "fillStyle": "hachure",
      "strokeWidth": 1,
      "strokeStyle": "solid",
      "roughness": 0,
      "opacity": 100,
      "groupIds": [],
      "roundness": null,
      "seed": 18273645,
      "version": 53,
      "versionNonce": 987654321,
      "isDeleted": false,
      "boundElements": [],
      "updated": 1700000000000,
      "link": null,
      "locked": false,
      "text": "Visual Flow",
      "fontSize": 28,
      "fontFamily": 1,
      "textAlign": "center",
      "verticalAlign": "middle",
      "baseline": 24,
      "containerId": null,
      "originalText": "Visual Flow",
      "lineHeight": 1.25
    },
    {
      "id": "node-2",
      "type": "ellipse",
      "x": 420,
      "y": 150,
      "width": 200,
      "height": 120,
      "angle": 0,
      "strokeColor": "#10b981",
      "backgroundColor": "#064e3b",
      "fillStyle": "hachure",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "roundness": null,
      "seed": 99887766,
      "version": 29,
      "versionNonce": 456123789,
      "isDeleted": false,
      "boundElements": [
        { "type": "arrow", "id": "arrow-1" }
      ],
      "updated": 1700000000000,
      "link": null,
      "locked": false
    },
    {
      "id": "arrow-1",
      "type": "arrow",
      "x": 340,
      "y": 178,
      "width": 120,
      "height": 8,
      "angle": 0,
      "strokeColor": "#f97316",
      "backgroundColor": "transparent",
      "fillStyle": "hachure",
      "strokeWidth": 2,
      "strokeStyle": "solid",
      "roughness": 1,
      "opacity": 100,
      "groupIds": [],
      "roundness": null,
      "seed": 44556677,
      "version": 41,
      "versionNonce": 22334455,
      "isDeleted": false,
      "boundElements": [],
      "updated": 1700000000000,
      "link": null,
      "locked": false,
      "points": [
        [0, 0],
        [120, 8]
      ],
      "lastCommittedPoint": [120, 8],
      "startBinding": {
        "elementId": "node-1",
        "focus": 0.1,
        "gap": 8
      },
      "endBinding": {
        "elementId": "node-2",
        "focus": -0.05,
        "gap": 12
      },
      "startArrowhead": null,
      "endArrowhead": "arrow"
    }
  ],
  "appState": {
    "gridSize": null,
    "viewBackgroundColor": "#0f172a",
    "zoom": { "value": 1 },
    "scrollX": 0,
    "scrollY": 0,
    "theme": "dark"
  },
  "files": {}
}
```

## Vega-Lite: Streaming-style Metrics

```vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "description": "Lightweight metric trend rendered through Vega-Lite.",
  "data": {
    "values": [
      { "step": 0, "value": 12 },
      { "step": 1, "value": 18 },
      { "step": 2, "value": 22 },
      { "step": 3, "value": 28 },
      { "step": 4, "value": 35 },
      { "step": 5, "value": 42 }
    ]
  },
  "mark": { "type": "line", "point": true, "tooltip": true },
  "encoding": {
    "x": { "field": "step", "type": "quantitative", "title": "Iteration" },
    "y": { "field": "value", "type": "quantitative", "title": "Synthetic Score" },
    "color": { "value": "#60a5fa" }
  }
}
```
