# Dream Car Builder: modern remake

A browser remake of Dream Car Builder built with three.js.

- **Same UI:** main menu, garage with top and side views, ESC menu, map screen and driving HUD.
- **Garage editor with Blender-style controls.**
- **Driving world with modern graphics:** physical sky, cascaded shadows, ambient occlusion, bloom, leaf-card trees, grass, and procedural terrain and roads.
- **Node-beam physics:** frames bend and break, suspension and tires are simulated, and the drivetrain has traction control, ABS and ESC.

Everything (terrain, textures, models, sounds) is generated in code. There are no asset files.

## Run
```bash
npm install
npm run dev
```
Then open the printed URL (default http://localhost:5173).

## Publish on GitHub Pages
Pushing to `main` runs `.github/workflows/deploy.yml`, which builds the game and publishes it. One-time setup: on GitHub, open the repository's **Settings > Pages** and set **Source** to **GitHub Actions**. The game is then at `https://<user>.github.io/<repo>/`.

Single player and Sandbox work on GitHub Pages. Multiplayer needs the Node server (`npm run dev` or `npm run serve`), which a static host can't run.

## Tests
```bash
npm test
```
`npm test` runs the headless physics suite: settling, acceleration, cornering, braking, slope hold, crashes, and 60 s of random driving.

Other test scripts:
- `node test/world.test.mjs` generates every map and drives on it.
- `node test/drag.test.mjs buggy` measures straight-line stability on the San Angelo runway.
- `node test/symmetry.test.mjs` checks that a symmetric test car drives straight.

## Controls
The full list is in `D:\Vault\Claude\Projects\Dream Car Builder\Controls.md`.

**Garage:**
- Middle-drag orbits, Shift+middle-drag pans, the wheel zooms.
- Numpad 1/3/7 switch views.
- G/R/S move, rotate and scale. Follow with X/Y/Z to lock an axis, or type a number for an exact value.
- E extrudes, F fills, Shift+D duplicates, M merges, X deletes.
- N opens the properties sidebar. Ctrl+Z undoes.
- Space toggles the real view. Enter starts a race.

**Driving:**
- WASD or arrows drive, Space is the handbrake, Shift boosts.
- R respawns, Esc opens the map, G returns to the garage, V changes camera, C resets the camera.

## Layout
| Folder | Contents |
|---|---|
| `src/physics` | XPBD node-beam solver, tires, drivetrain |
| `src/car` | Design model, parts, preset cars |
| `src/world` | Map generators, terrain and road shader, sky, vegetation, props |
| `src/render` | Car renderer, part meshes, post-processing |
| `src/editor` | Garage |
| `src/drive` | Driving, HUD, map screen, races |
| `src/ui` | Menu, dialogs, styles |
