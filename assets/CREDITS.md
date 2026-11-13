# Asset credits

All downloaded assets are CC0 unless noted.

- `sky/kloofendal_*`: "Kloofendal 48d Partly Cloudy (Pure Sky)" by Greg Zaal, Poly Haven, CC0.
  The `_sky_4k.jpg` backdrop is the upper hemisphere of the 4k HDR, encoded as
  `pow(radiance / 8, 1/2.2)` by `tools/assets/encode-sky.mjs`.
- `tex/asphalt_track_*`, `tex/concrete_wall_008_*`: Poly Haven, CC0.
- `tex/Grass005_*`: ambientCG (Lennart Demes), CC0.
- `sky/qwantani_late_*`: "Qwantani Late Afternoon (Pure Sky)", Poly Haven, CC0. Encoded the same way.
- `tex/aerial_beach_01_*`, `tex/snow_02_*`: Poly Haven, CC0.

## Car

- `car/CarConcept.glb`: "Car Concept" from Khronos glTF-Sample-Assets, © 2023 Darmstadt Graphics Group GmbH, CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/), based on a CC0 model by Unity Fan. The licence-plate logo is hidden in game (Khronos trademarks are excluded from the licence). Paint and glass materials are altered at load.
- `car/porsche911.glb` ("Coupe" in the menu): "(FREE) Porsche 911 Carrera 4S" by Karol Miklas (https://sketchfab.com/karolmiklas), CC-BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/), https://sketchfab.com/3d-models/free-porsche-911-carrera-4s-d01b254483794de3819786d93e0e1ebf. Compressed copy from pmndrs/examples. Paint, glass and wheels are altered at load; plate and logo materials hidden.
- `car/datsun240k.glb` ("Classic" in the menu): "(FREE) 1972 Datsun 240k GT" by Karol Miklas, CC-BY-SA 4.0, https://sketchfab.com/3d-models/free-1972-datsun-240k-gt-b2303a552b444e5b8637fdf5169b41cb. Compressed copy from pmndrs/examples. Same alterations.
- `tex/rock_boulder_cracked_*`, `tex/rock_face_03_*`: Poly Haven, CC0.
- `public/draco/`: Draco mesh decoder from three.js (Apache-2.0), needed to read the two compressed car files.

## Trees

- Generated at load with `@dgreenheck/ez-tree` (MIT).
