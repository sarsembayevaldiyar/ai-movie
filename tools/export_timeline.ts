// Exports every sync point of the picture to JSON for the soundtrack generator
// (tools/make_soundtrack.py), so sound and picture share one source of truth.
import {writeFileSync} from 'node:fs';
import {BEATS, TEXT, SCENES, FILM_SECONDS} from '../src/timeline';
import {regionalSchedule, internationalSchedule, constellationCount} from '../src/world/features';

const counter: number[] = [];
for (let t = TEXT.t3.in; t <= TEXT.t3.in + 5; t += 1 / 60) counter.push(constellationCount(t));
const out = {
  film: FILM_SECONDS,
  scenes: SCENES,
  beats: BEATS,
  text: TEXT,
  regional: regionalSchedule().map(({key, start, arrive}) => ({key, start, arrive})),
  international: internationalSchedule().map(({key, start, arrive}) => ({key, start, arrive})),
  counter: {start: TEXT.t3.in, fps: 60, values: counter},
  goals: [0, 1, 2].map((i) => TEXT.t6.in + 0.35 + i * 0.7),
};
writeFileSync(process.argv[2] ?? 'tools/timeline.json', JSON.stringify(out, null, 1));
console.log('timeline exported');
