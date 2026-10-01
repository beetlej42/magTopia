# Owl Tower — animated revision v4

1×1 postal landmark: narrow chamfered limestone shaft, projecting timber roost,
open arched flight holes, slate hip roof, envelope sign, mail slot and parcels.
Two perched owls belong to named independent groups (`OwlCourier`, `OwlKeeper`),
with independent body, head and wing pivots. The ivory courier rests for 20 seconds,
then takes a 12-second circuit with wingbeats and a short glide. It lands facing
inward, walks into the loft, turns around inside, then walks outward to its perch
over five seconds (37-second full cycle). The brown keeper occasionally turns its head. Animation uses the
existing city clock; static visualization and placement previews stay perched.
Birds are hidden and animation work skipped beyond the distance cutoff.

The authoritative source is `src/generators/owlTower.js`. The city, placement ghost
and CPU visualizer use the same factory. All authored geometry uses the shared
0.125 grid and material library. `sphereProjectionRoot` keeps the birds attached
to the tower on the globe. Openings are hollow geometry, not dark painted panes.

Review images: `front.png`, `back.png`, `top.png` (512px).

Reproduce with `renderBuildingVisualization({sourceSpec:owlTowerSpec(),site:{entrance:"north"}},{size:512,view:"front"})`.
Tests: `node --test test/owlTower.test.js` checks bounds in all orientations,
open flight holes, independent bird parts, daylight, compiler/preview/city
consistency, spherical parenting and deterministic images.

Revision 2 adds sparse wind-caught leaves and chalky bird-dropping streaks painted onto the actual stepped slate surface, without raised blocks or additional meshes.

Revision 3 adds different plumage, flight and head motion, city update forwarding,
and a slightly taller opening for ear clearance. Tests sample both birds against
the tower shell across the full cycle and verify seamless return and no mesh rebuilds.
Run `node scripts/preview-owl-tower.mjs` to render 330 fixed-camera frames at 15 fps.
The preview covers seconds 18–40, shortening the idle portion only.

Revision 4 removes the backwards landing. A continuous internal landing board
supports the walk-in, sheltered turn and walk-out. Collision tests cover all phases.
