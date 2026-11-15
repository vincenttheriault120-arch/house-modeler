# House Modeler

A browser tool for modeling a house **step by step** in 2D and 3D: foundation, then walls, then floors, one level at a time. Every step keeps its own editable measurements, and the 3D model is always rebuilt from the steps, so changing a number never leaves the model out of sync.

**Live app:** https://vincenttheriault120-arch.github.io/house-modeler/

## Features (so far)

- 3D view with rotate / pan / zoom and a view cube
- **Foundation step:** walk the outline side by side (as dimensioned on a plan), set wall thickness, height, top elevation, footing and slab. Any shape made of square corners works (L-shapes, notches).
- Components list with sizes; click a piece in the list or in 3D to select it
- Steps can be renamed, assigned a level, hidden, reordered or deleted, with notes for specs
- Autosaves in your browser; **Save to file** / **Open…** for a `.house.json` project file
- **Export to Blender:** downloads a `.glb`. In Blender: File → Import → glTF 2.0. Units are metres, pieces are named and grouped by step.
- **Ask Claude:** a chat panel that can add and change steps for you ("make the garage a slab on grade, 18' 1\" by 39' 1 1/2\""). Every change can be undone with one click. Uses your own Anthropic API key, stored only in your browser (create one at console.anthropic.com; pay per use).
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
