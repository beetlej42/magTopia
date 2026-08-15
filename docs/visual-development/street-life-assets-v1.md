# Street Life assets · visual prototype v1

This package is intentionally isolated in the `Street Life Asset Lab`. It does not yet attach pedestrians or vehicles to the production city simulation.

## Art direction

- Pedestrians use a shared block-toy rig with a cylindrical head, curved hands, short limbs, matte materials, and a compact silhouette readable at city scale.
- Muggles and wizards share the same base population. Magic is communicated through low-frequency modules: capes, discreet wands, muted spark effects, and slightly more eccentric hats or colors.
- Clothing is retro British rather than costume-heavy: overcoats, cardigans, waistcoats, skirts, trousers, scarves, flat caps, and satchels.
- Vehicles use voxel body panels and softened color blocking. Wheels, lamps, and restrained magical glows are the only intentionally smooth forms.
- The road family starts with three readable silhouettes: hatchback, three-box saloon, and double-decker bus. A flying-car flag is a rare variation of a road car, not a separate futuristic vehicle.

## Modular contracts

Pedestrian layers:

1. Shared walk rig: body bounce, left/right arms, left/right legs.
2. Identity: skin tone, simple face, hair color.
3. Hair or hat: swept, bob, curls, flat cap, top hat, or bare.
4. Clothing: overcoat, cardigan, waistcoat, or skirt-coat plus a palette.
5. Optional gear: cape, scarf, satchel, or wand.

Vehicle layers:

1. Shared X-forward chassis and four-wheel motion contract.
2. Body type: hatchback, saloon, or bus.
3. Palette and trim.
4. Optional roof rack.
5. Rare flying override with hover, glow, and sparks.

## Intended city integration after approval

- Pedestrians will request random building-to-building trips, follow sidewalk edges, and use marked crossing links when they need to change blocks.
- Road vehicles will follow directional lane paths derived from the road graph.
- Flying cars will begin as ordinary road trips and occasionally switch to an elevated bypass segment before returning to the road network.
- Crowd and traffic simulation should use pooled instances or geometry batching at distance; the lab currently favors inspectable modular objects.

## Visual references

- `street-people-concept-v1.png`: modular pedestrian silhouette and palette study.
- `retro-voxel-vehicles-concept-v1.png`: vehicle family and flying-car restraint study.
