# Veilway

Third-person night driving through **real OpenStreetMap streets**. The map stays hidden until you drive there. Street names are how you navigate — there is no turn-by-turn.

Reach the destination and the trip is scored against the **shortest legal driving route** from OSM/OSRM.

**Play it here:** this is the Grok App Builder source. Clone, `npm install`, `npm run dev`.

## Play

- **Start from** a neighborhood (Covent Garden, Gion, Jordaan, …) or jump into the **Practice district** (instant named grid, no network).
- **Destination:** random within a radius, or a named nearby place (capped at 1.5 km so the map stays small enough to drive).
- **W** accelerate · **S** reverse · **A / D** steer · **Space** brake. Phone: left stick + brake pedal.
- Fog of war: only the vicinity of the car is visible; explored blocks stay revealed; street-name signs appear as you go.
- Traffic lights cycle. Running a red costs 40 points.
- Arrival (~18 m) ends the trip. Cream line = your path, dashed green = shortest route.

## Score

```
points = round(shortestMeters / drivenMeters * 1000) - 40 * redLightsRun
```

Shortest distance comes from [OSRM](https://project-osrm.org/) when the network is up, otherwise A* on the local street graph. Off-road driving is allowed but heavily dragged, so cutting blocks rarely wins.

## Architecture

```
src/
  routes/index.tsx          Start menu → load trip → 3D canvas
  lib/osm/api.ts            Server functions: Photon/Nominatim geocode, Overpass/OSM map, OSRM route
  lib/osm/parse.ts          Overpass JSON + OSM XML → roads, buildings, lights
  lib/osm/pathfind.ts       Snap to nearest road, A* fallback, current-street name
  lib/osm/synthetic.ts      Practice district (named grid + promenade + park)
  game/engine.ts            Loop, arcade car, collisions, arrival, score
  game/fog.ts               512² canvas fog-of-war stamped around the car, shader-mixed on world meshes
  game/world-mesh.ts        Road ribbons, merged building boxes, lamps, traffic signals
  game/input.ts             WASD + arrows + gamepad + touch → steer / throttle / brake
  store/session.ts          Zustand phase: menu | loading | playing | paused | scored
```

### Map data

`buildTrip` (TanStack `createServerFn`) geocodes the start, downloads streets/buildings/signals in a radius, snaps start & dest onto the graph, then asks OSRM for the official driving distance. Overpass mirrors are tried first; if they time out, the official OSM map API is the fallback.

Projection is local meters: **+X east, −Z north**, so yaw `0` faces north and matches the chase camera (`forward = (-sin(yaw), 0, -cos(yaw))`). **A increases yaw** (nose left on screen).

### Fog of war

A square canvas covering the map is stamped with a soft circle (~54 m) as the car moves. Road/building/ground materials share one `onBeforeCompile` chunk that mixes albedo toward night fog using that texture. Unexplored city is not drawn as geometry you can read — only revealed texels show streets and signs.

### Driving

Arcade model, not a rigid-body sim: heading + forward speed + extra drag off-pavement, steering scaled by speed (and flipped in reverse). Buildings are AABB pushes. Red lights cap speed on approach; passing one at speed while it is red is a violation.

## Build notes

These are the things that actually mattered while shipping the first playable:

- **Steer polarity.** `KeyA` is `steer = +1` → **+yaw**. With `forward = (-sin(yaw), 0, -cos(yaw))` that turns the nose left on screen. Overlay injects (for QA) sit *on top of* keys; an early-return in `injectSteer` used to zero throttle and made A/D tests look broken.
- **Clock, not Timer.** Three.js r185 ships `THREE.Clock`. `THREE.Timer` is not on `three.module.js` exports. Call `getDelta()` once per frame.
- **Map fetch.** Overpass `kumi` / `.de` mirrors flake; `overpass-api.de` and the france mirror are more reliable. If JSON Overpass dies, fall back to OSM API 0.6 XML and parse with a named-entity regex (`decodeXml`) — XML entity tools can corrupt `"` strings.
- **World size.** Destinations are capped at ~1.5 km so the fog canvas (512²) still has usable texel density and the trip is finishable in a few minutes.
- **Fog shader.** One `MeshStandardMaterial.onBeforeCompile` chunk samples the fog canvas. Street-name sprites keep `depthTest: true` so they sit on the road instead of floating through buildings.
- **Session phases.** The 3D canvas only mounts in `playing`. Set `phase = playing` *after* the world is built, otherwise the first frame has no car and the loading screen never yields.
- **QA hooks.** `window.__controlsTest` plus `scripts/veilway-controls-qa.mjs` / `scripts/veilway-osm-qa.mjs`. Practice district is the offline golden path; Covent Garden (Floral Street → Bloomsbury Way) is the live OSM check.
- **Score vs path.** Driven polyline is sampled from the car; shortest is OSRM (fallback A*). The cream line vs dashed green overlay is the whole “how close were you” readout.
- **Auth/DB off.** High score is session-only. `localStorage` would not justify accounts.

## Stack

React 19 + TanStack Start + Tailwind v4 + Three.js. Auth and the database are **off**; nothing is saved across devices.

```
npm install
npm run dev      # 0.0.0.0:8080
npm run build
```

OSM/Overpass/OSRM are public endpoints. They can be slow or rate-limit; the Practice district always works offline.

## License notes

Map data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).
