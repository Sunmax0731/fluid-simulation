# Fluid Motion Lab

Realtime fluid-inspired visual demos for games, motion graphics, and environment FX.

This workspace contains three browser demos built with WebGL2, Three.js, and Vite. The focus is not academic naming but visual output: ocean waves, smoke and fire plumes, and stylized ink-like liquid motion.

## Demos

- `airflow/` - `Ocean Surface`
  - Gerstner-wave ocean surface for background scenes and cinematic shots.
- `liquid/` - `Smoke & Fire`
  - Interactive plume simulation for fog, campfire, and thruster-style looks.
- `multiphase/` - `Ink Flow`
  - Stylized liquid sheet / ink demo with paint and bubble carving interactions.

## Quick Start

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
```

## Controls

- Ocean Surface
  - Drag: orbit camera
  - Mouse wheel: zoom
  - Presets: change sea state
- Smoke & Fire
  - Drag: inject smoke or flame
  - `R`: reset
  - Presets: campfire / mist / thruster
- Ink Flow
  - Drag: paint liquid or carve bubbles
  - `1` `2` `3`: scene presets
  - `V`: toggle liquid / velocity view
  - `B`: toggle bubble tool
  - `R`: reset current scene

## Tech Notes

- `airflow/` uses a stylized ocean surface rather than a strict CFD presentation.
- `liquid/` uses a 2D smoke-style solver with buoyancy, pressure projection, and live splats.
- `multiphase/` uses a VOF-style liquid field, but the rendering is tuned for visual direction instead of scientific inspection.

## Structure

```text
fluid-simulation/
  airflow/
  liquid/
  multiphase/
  shared/
  index.html
  vite.config.js
```
