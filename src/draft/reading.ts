/**
 * The general method Claude uses to read a set of house drawings. It names no
 * particular roof or foundation: the same rules apply to any part of any house.
 * Shared by Redraft and Ask Claude so both read plans the same way.
 */
export const PLAN_READING = `Reading the drawings (any house, any part):
- Every sheet is a 2D view of the same 3D house. Floor plans, the foundation plan and the roof plan look down and give x and y. Elevations look at one side and give one horizontal extent and the heights. Sections cut through the house and give heights, floor build-ups and everything below grade. A part is understood only once you have found it on every sheet that shows it and one 3D shape fits all of them.
- Lines inside an outline are edges where surfaces meet (ridges, hips, valleys, folds, steps in a wall), not the end of a part. Arrows on a roof plan point downhill; small circles are drains at the low points. Dashed lines are edges out of view: an overhang or cantilever above (on plans), or foundations below grade (on elevations).
- Where two views show the same edge they must agree. A wall drawn as one continuous rectangle on an elevation means the parts behind it line up there. A sloping wall top on an elevation means the roof edge on that side slopes. A roof surface drawn above a wall means the roof rises behind it.
- Scales: note each sheet's scale and check it against one written dimension. Title blocks are sometimes wrong; use the scale that makes written dimensions measure true.
- Which drawing to trust when they differ: a written dimension or level over anything scaled; for footprints and wall positions, the floor plans and the foundation plan; for heights and floor levels, the levels written on the sections and elevations; for roof shapes, the roof plan's lines and arrows for the shape and the elevations for the heights; for anything below grade, the sections and the foundation plan over dashed lines on elevations.
- When a value is not written, work it out from what is written before scaling anything: sums and differences of chain dimensions, the difference of two written levels, a written slope (e.g. 3/12) over a written run, the same edge dimensioned on another sheet. Scale only as a last resort, using a written dimension on the same sheet as the ruler.
- When two drawings disagree, use the more trustworthy one and record the disagreement. Never average them.`;
