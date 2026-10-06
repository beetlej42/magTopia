# City pigeon flock

The city renderer adds at most one flock of five C-size pigeons (body length
0.40 world units). This is a client-side visual effect; population, turn timing,
saved city state and Agent APIs are unchanged. Existing cities receive the layer
when rendered with the new client.

Only completed, pure plaza designs qualify as resting places. Each footprint
cell of a larger plaza may offer a patch, but transfers choose another building.
Paving, lamps, planters and other rendered geometry must leave room for all five
perches. A city with no safe plaza has no flock; one safe plaza has a resting
flock. Mixed building sites, gardens, courtyards and construction sites are not
landing targets in this version.

The layer builds a conservative 0.5-unit height field from visible rendered
triangles/instances before sphere projection. The field allocates only road and
plaza cells. Buildings, vegetation, roads and railway geometry contribute to
obstruction heights, including overhangs; terrain elevation comes from the
existing construction-height sampler. Overhead structures block a column rather
than permitting flight underneath. Bridges are not flight corridors in v1.

Transfers search connected corridors, round corners with tangent-continuous
quadratic arcs, and validate the result at intervals of at most 0.08 horizontal
units with a 0.43-unit horizontal clearance envelope. Every bird's track is
checked, including the endpoint spread. Tight turns (radius below 0.55 units),
obstructions and routes shorter than 4 or longer than 160 units are rejected.
There is no unchecked fallback to a straight line or a sharp corner.

Birds climb and descend while moving forward; cruise altitude is 3.2 units above
graded ground. Takeoff is staggered by 0.22 seconds, and the flock flies single
file through corridors, spreading onto its five landing positions. Ground
movement uses short steps with alternating feet, head motion, pauses and pecks.
After 30–60 seconds the flock tries up to four randomly selected destinations;
if none is safe it waits another 30–60 seconds. The route search may reject a
destination even if a different, longer route could have worked.

Navigation is rebuilt with the city scene after construction/demolition refresh.
There are no per-frame geometry rebuilds, path searches or dynamic shadows.
Far view skips peck detail but keeps flight and walking coherent. Maximum bird
count stays five regardless of city size. Mobile frame time still needs device
validation; no 60 Hz claim is made by the unit tests.

## Inspection

- `city.userData.getPigeonDiagnostics()` reports count, eligible plaza patches,
  current state, source, destination and rejected route count.
- `city.userData.setPigeonDebug(true)` shows the active route centerline.
- `node --test test/pigeonCityLayer.test.js test/streetLifeCityLayer.test.js`
  checks real plaza assets, clear/blocked/disconnected routes, rounded turns,
  construction exclusion, singleton behavior and frozen-transform recovery.
- `node scripts/preview-pigeon-flight.mjs [output-dir]` renders a reproducible
  14-second sequence with generated plazas and houses. This is a test scene,
  not a capture of a player's live city. GIF loop reset is presentation-only.
