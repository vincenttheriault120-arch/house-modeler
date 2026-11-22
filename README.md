# House Modeler

A browser tool for modeling a house **step by step** in 2D and 3D: foundation, then walls, then floors, one level at a time. Every step keeps its own editable measurements, and the 3D model is always rebuilt from the steps, so changing a number never leaves the model out of sync.

**Live app:** https://vincenttheriault120-arch.github.io/house-modeler/

## Features (so far)

- 3D view with rotate / pan / zoom and a view cube
- **Foundation step:** walk the outline side by side (as dimensioned on a plan), set wall thickness, height, top elevation, footing and slab. Any shape made of square corners works (L-shapes, notches).
- Components list with sizes; click a piece in the list or in 3D to select it
- Steps can be renamed, assigned a level, hidden, reordered or deleted, with notes for specs
- **Projects:** the app opens on your projects. Work on several houses side by side, duplicate one to try a variant, or open a `.house.json` file as a new project. Each project keeps its own model and plans, and saves as you work.
- **Projects on your computer (Chrome and Edge):** pick a folder and each project becomes a real folder in it: `project.house.json` plus a `plans/` folder with your PDFs. Other folders in there are left alone. Projects can also stay in the browser, and you can copy them either way.
- **New project wizard:** name, units and where to save, then start **from your plans** (drop in the PDFs; a checklist shows which sheets Phase 1 uses) or **from scratch** (pick a rectangle, L or T footprint, overall size, storeys and basement or slab; the footprint becomes the first foundation).
- **Phase 1, the exterior drafted in one go:** start a project from your plans and Claude reads every sheet at once, then builds the whole outside of the house in white clay: each volume (original house, addition, upper storey), its roof (flat, shed, gable or hip), and every door, window and garage door, with the measurements written on all of them. Numbers read from your plans are **black**; numbers Claude had to work out (scaled or assumed) are **red**, with the reason. Any value can be typed over.
- **Check each drawing:** the left side has three steps only: Plans, Draft the exterior, Check each drawing. Pick a drawing (front, right, back, left elevation, ground and first floor plan, roof) and the model turns to that view, straight on like the drawing, with the matching PDF beside it (zoom, turn, pick another sheet). The list on the right holds only that view's measurements, grouped by part: press ✓ when it matches, type the plan's value when it doesn't, remove a part that isn't on the plans, or add a missing door or window. **Redraft** asks Claude again (and can be undone). **Export to Blender** exports the clay draft.
- **Phase 2, interior layout:** pick a storey (basement, ground floor, first floor) and draw over its floor plan, seen from above. The **Wall** tool draws interior walls by clicking each corner; it snaps to corners, wall faces and square angles, and shows the length as you go. The **Room** tool traces a room along the inside faces; each room gets a name, its area and its clear width × depth. Select a wall to type its exact length or thickness. **Door** places a door or plain opening on a wall (exact width, height, position, swing and hinge side); in 3D the wall is cut and a header sits above. **Stair** draws a straight stair by its bottom and top corners; it works out the risers from the storey heights and says whether the steps meet the code (rise 7 7/8" max, tread 8 1/4" min, width 2' 10" min). Under **Check room sizes**, each room's width and depth can be marked as matching the plan or not. A small 3D view shows the storey, and each storey gets its own **Mark as verified**.
- **Phases:** a bar across the top shows the five phases every project goes through: exterior, interior layout, structure, finishes, share. The foundation and floor-system steps, levels and components list now live in Phase 3, Structure.
- **Save to file** downloads the `.house.json` project file at any time
- **Export to Blender:** downloads a `.glb`. In Blender: File → Import → glTF 2.0. Units are metres, pieces are named and grouped by step.
- **Ask Claude:** a chat panel that can add and change steps for you ("make the garage a slab on grade, 18' 1\" by 39' 1 1/2\""). Every change can be undone with one click. Uses your own Anthropic API key, stored only in your browser (create one at console.anthropic.com; pay per use).
- **Floor step:** the floor system on top of a foundation: sill plate, rim joist, joists (size, spacing, direction), a dropped beam with steel posts, and the subfloor. It follows the foundation's outline and height and shows the finished ground-floor elevation. Untick *Show subfloors* to see the joists.
- **Plans:** add your 2D plan PDFs and view them in the app. A checklist shows which drawings are still missing (floor plans, the four elevations, a section); with an API key saved, Claude labels each PDF. They are stored with the project (in your browser, or in the project's folder on your computer), never in this repository.
- **Levels:** the key heights of the house (top of foundation, garage slab, each floor, roof ridge), relative to grade. Claude can read them from the elevations for you to review. A foundation can follow a level, so changing the level moves it and everything built on it; a floor can name the level it should finish at and you're warned when they disagree.
- **Suggest from plans:** Claude reads the plans you pick and proposes the foundation's outline and measurements. You see each value next to the current one, with where it came from and whether it was read from a dimension or estimated, edit it, and tick only what you want to apply.
- Imperial (ft-in, to 1/16") or metric (mm) display. All lengths are stored in millimetres; you can type either system in any field (`8' 6 1/2"`, `102"`, `2600 mm`, `2.6 m`).

## Roadmap

1. ✅ Project setup and live link
2. ✅ Foundation step (footprint, wall thickness, footing, elevations), save/load, export to Blender (glTF)
3. Walls and floor systems, one level at a time, with basic materials
4. Suggested measurements from existing 2D plans

## Development

```bash
npm install
npm run dev     # local dev server
npm test        # unit tests
npm run build   # production build into dist/
```

Every push to `main` is tested and deployed to GitHub Pages automatically.

House plans and project files are intentionally **not** stored in this repository.
